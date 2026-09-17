import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables, TablesInsert } from '@/types/supabase';
import type {
  BreastSide,
  CareLog,
  DiaperKind,
  FeedingMethod,
  LogType,
  MilkLog,
  PoopColor,
  PoopConsistency,
  PumpedBatch,
  TemperatureLog,
} from '@/types/app';
import { addDays, startOfDay } from '@/lib/dateUtils';

type CareLogRow = Tables<'care_logs'>;
type SupabaseDb = SupabaseClient<Database>;

// DBには種別ごとの表示名を持たないため、typeから導出する
export const LOG_TYPE_LABEL: Record<LogType, string> = {
  milk: 'ミルク',
  diaper: 'おむつ',
  pumping: '搾乳',
  temperature: '体温',
};

// 記録タブから睡眠の記録を取り止めたあとも、すでに保存されている type = 'sleep' の行は
// DBに残っている。アプリ側では扱わないので、取得の時点で除いておく。
const ACTIVE_LOG_TYPES: LogType[] = ['milk', 'diaper', 'pumping', 'temperature'];

// 記録の種類ごとの項目は care_logs.details (jsonb) に入れる。
// 想定外の値が入っていても表示を壊さないよう、読み出しは1項目ずつ検証する。
type DetailsRecord = Record<string, unknown>;

const toDetails = (value: Json): DetailsRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as DetailsRecord) : {};

const readEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : undefined;

// 日時は details にISO文字列で入れる。読めない値が入っていても表示を壊さないよう、
// 日付として成立するものだけを取る。
const readDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const rowToCareLog = (row: CareLogRow): CareLog => {
  const details = toDetails(row.details);
  // details が入る前に記録された分。種類別の項目がないので、表示は amount の文字列で行う。
  const isLegacy = Object.keys(details).length === 0;
  const base = {
    id: row.id,
    time: new Date(row.logged_at),
    note: row.note ?? '',
    createdBy: row.created_by,
    ...(isLegacy ? { legacyAmount: row.amount ?? '' } : {}),
  };

  if (row.type === 'diaper') {
    return {
      ...base,
      type: 'diaper',
      kind: readEnum<DiaperKind>(details.kind, ['pee', 'poop', 'both']) ?? 'pee',
      poopColor: readEnum<PoopColor>(details.poopColor, [
        'yellow',
        'green',
        'brown',
        'white',
        'red',
        'black',
      ]),
      poopConsistency: readEnum<PoopConsistency>(details.poopConsistency, ['loose', 'normal', 'hard']),
    };
  }

  if (row.type === 'pumping') {
    return {
      ...base,
      type: 'pumping',
      amountMl: readNumber(details.amountMl) ?? 0,
      discardedAt: readDate(details.discardedAt),
    };
  }

  if (row.type === 'temperature') {
    return {
      ...base,
      type: 'temperature',
      celsius: readNumber(details.celsius) ?? 0,
    };
  }

  return {
    ...base,
    type: 'milk',
    method: readEnum<FeedingMethod>(details.method, ['breast', 'pumped', 'formula']) ?? 'formula',
    amountMl: readNumber(details.amountMl),
    pumpedFrom: readStringArray(details.pumpedFrom),
    discardedMl: readNumber(details.discardedMl),
    leftMinutes: readNumber(details.leftMinutes),
    rightMinutes: readNumber(details.rightMinutes),
    lastSide: readEnum<BreastSide>(details.lastSide, ['left', 'right']),
  };
};

/** 種類ごとの項目を details に詰める。undefined の項目は入れない。 */
const careLogToDetails = (log: CareLog): Json => {
  const details: DetailsRecord = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) details[key] = value;
  };

  if (log.type === 'milk') {
    set('method', log.method);
    set('amountMl', log.amountMl);
    set('pumpedFrom', log.pumpedFrom);
    set('discardedMl', log.discardedMl);
    set('leftMinutes', log.leftMinutes);
    set('rightMinutes', log.rightMinutes);
    set('lastSide', log.lastSide);
  } else if (log.type === 'diaper') {
    set('kind', log.kind);
    set('poopColor', log.poopColor);
    set('poopConsistency', log.poopConsistency);
  } else if (log.type === 'temperature') {
    set('celsius', log.celsius);
  } else {
    set('amountMl', log.amountMl);
    // 丸ごと捨てた搾乳。捨てていなければキー自体を持たせない。
    set('discardedAt', log.discardedAt?.toISOString());
  }

  return details as Json;
};

/** 一覧に出す短い要約。details を持たない過去の記録との互換のため amount にも残す。 */
const careLogToAmount = (log: CareLog): string => {
  if (log.type === 'milk') {
    if (log.method !== 'breast') return log.amountMl ? `${log.amountMl}ml` : '';
    const parts = [
      log.leftMinutes ? `左${log.leftMinutes}分` : '',
      log.rightMinutes ? `右${log.rightMinutes}分` : '',
    ].filter(Boolean);
    return parts.join(' ');
  }
  if (log.type === 'diaper') return '';
  if (log.type === 'temperature') return `${log.celsius.toFixed(1)}℃`;
  return log.amountMl ? `${log.amountMl}ml` : '';
};

// 指定した期間（from 以上 to 未満）の記録を取得する。
// 記録は日数が経つほど増えていくため、全件ではなく表示する範囲だけを取りに行く。
// カレンダーの日表示・週表示もこれを使う（1日=20件前後、1週=150件前後）。
export async function listCareLogsInRange(
  supabase: SupabaseDb,
  familyId: string,
  from: Date,
  to: Date,
): Promise<CareLog[]> {
  const { data, error } = await supabase
    .from('care_logs')
    .select('*')
    .eq('family_id', familyId)
    .in('type', ACTIVE_LOG_TYPES)
    .gte('logged_at', from.toISOString())
    .lt('logged_at', to.toISOString())
    .order('logged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToCareLog);
}

/** 指定した1日分（ローカルタイムの 0:00 〜 翌0:00）の記録。 */
export async function listCareLogsByDate(
  supabase: SupabaseDb,
  familyId: string,
  date: Date,
): Promise<CareLog[]> {
  const from = startOfDay(date);
  return listCareLogsInRange(supabase, familyId, from, addDays(from, 1));
}

/**
 * 直近の授乳(ミルク)の記録を新しい順に取る。「次の授乳の目安」を出すのに使う。
 *
 * 夜中の授乳は前の日の記録になるため、記録タブの1日分(listCareLogsByDate)では
 * 前回の授乳を取りこぼす。最近の間隔の平均も出すので、数件まとめて取る。
 */
export async function listRecentMilkLogs(
  supabase: SupabaseDb,
  familyId: string,
  limit = 10,
): Promise<MilkLog[]> {
  const { data, error } = await supabase
    .from('care_logs')
    .select('*')
    .eq('family_id', familyId)
    .eq('type', 'milk')
    .order('logged_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToCareLog).filter((log): log is MilkLog => log.type === 'milk');
}

/**
 * 搾乳ストックの一覧。ためた搾乳1件ずつに「どの授乳で飲ませたか」を添えて返す。
 *
 * どの搾乳を飲ませるかは記録するときに選ぶので、残量ではなく1パックずつ持つ必要がある。
 * 使ったかどうかは飲ませた側（method: 'pumped' のミルクの記録）の pumpedFrom が持ち、
 * 搾乳の記録そのものは書き換えない。授乳の記録を消せば、その搾乳はストックに戻る。
 * 飲ませずに丸ごと捨てた分だけは、飲ませた側の記録が無いので搾乳の記録自身が印を持つ。
 *
 * 表示中の日だけでは求まらないため全期間ぶんを数えるが、どちらも1日に数件しか増えず
 * 必要な列も少ないので、2本の軽い問い合わせで足りる。並びは古い順（先に搾ったものから使う）。
 */
/**
 * 直近の体温の記録を新しい順に取る。平熱を出すのに使う（careLogUtils の getTemperatureBaseline）。
 *
 * 平熱はその子自身の記録の平均なので、表示中の日だけでは求まらない。
 * 記録タブの1日分(listCareLogsByDate)とは別に、日付にとらわれず取る。
 * 発熱した日の値は平熱から外すため、外れるぶんを見込んで少し多めに取る。
 */
export async function listRecentTemperatureLogs(
  supabase: SupabaseDb,
  familyId: string,
  limit = 60,
): Promise<TemperatureLog[]> {
  const { data, error } = await supabase
    .from('care_logs')
    .select('*')
    .eq('family_id', familyId)
    .eq('type', 'temperature')
    .order('logged_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? [])
    .map(rowToCareLog)
    .filter((log): log is TemperatureLog => log.type === 'temperature');
}

export async function listPumpedBatches(supabase: SupabaseDb, familyId: string): Promise<PumpedBatch[]> {
  const [pumped, fed] = await Promise.all([
    supabase
      .from('care_logs')
      .select('id, logged_at, details')
      .eq('family_id', familyId)
      .eq('type', 'pumping')
      .order('logged_at', { ascending: true }),
    supabase
      .from('care_logs')
      .select('id, details')
      .eq('family_id', familyId)
      .eq('type', 'milk')
      .eq('details->>method', 'pumped'),
  ]);
  if (pumped.error) throw pumped.error;
  if (fed.error) throw fed.error;

  // 搾乳のid -> それを飲ませた授乳の記録のid。
  const usedBy = new Map<string, string>();
  for (const row of fed.data ?? []) {
    for (const pumpingId of readStringArray(toDetails(row.details).pumpedFrom) ?? []) {
      // 同じ搾乳が2つの記録から参照されていても、ストックから外れることは変わらない。
      if (!usedBy.has(pumpingId)) usedBy.set(pumpingId, row.id);
    }
  }

  return (pumped.data ?? []).map((row) => ({
    id: row.id,
    time: new Date(row.logged_at),
    amountMl: readNumber(toDetails(row.details).amountMl) ?? 0,
    usedBy: usedBy.get(row.id) ?? null,
    discardedAt: readDate(toDetails(row.details).discardedAt) ?? null,
  }));
}

// 共用体のまま各要素から取り除く（Omit をそのまま使うと種類ごとの項目が消えてしまう）
type OmitFromUnion<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 保存する記録。id はDB側で採番するため持たない。 */
export type NewCareLogInput = OmitFromUnion<CareLog, 'id' | 'createdBy' | 'legacyAmount'>;

export async function insertCareLog(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
  input: NewCareLogInput,
): Promise<CareLog> {
  const log = { ...input, id: '', createdBy: userId } as CareLog;
  const row: TablesInsert<'care_logs'> = {
    family_id: familyId,
    type: input.type,
    amount: careLogToAmount(log),
    details: careLogToDetails(log),
    note: input.note,
    logged_at: input.time.toISOString(),
    created_by: userId,
  };
  const { data, error } = await supabase.from('care_logs').insert(row).select('*').single();
  if (error) throw error;
  return rowToCareLog(data);
}

export async function updateCareLog(supabase: SupabaseDb, log: CareLog): Promise<void> {
  const { error } = await supabase
    .from('care_logs')
    .update({
      amount: careLogToAmount(log),
      details: careLogToDetails(log),
      note: log.note,
      logged_at: log.time.toISOString(),
    })
    .eq('id', log.id);
  if (error) throw error;
}

export async function deleteCareLog(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('care_logs').delete().eq('id', id);
  if (error) throw error;
}
