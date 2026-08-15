import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables, TablesInsert } from '@/types/supabase';
import type {
  BreastSide,
  CareLog,
  DiaperKind,
  FeedingMethod,
  LogType,
  PoopColor,
  PoopConsistency,
} from '@/types/app';
import { addDays, startOfDay } from '@/lib/dateUtils';

type CareLogRow = Tables<'care_logs'>;
type SupabaseDb = SupabaseClient<Database>;

// DBには種別ごとの表示名を持たないため、typeから導出する
export const LOG_TYPE_LABEL: Record<LogType, string> = {
  milk: 'ミルク',
  diaper: 'おむつ',
  sleep: '睡眠',
};

// 記録の種類ごとの項目は care_logs.details (jsonb) に入れる。
// 想定外の値が入っていても表示を壊さないよう、読み出しは1項目ずつ検証する。
type DetailsRecord = Record<string, unknown>;

const toDetails = (value: Json): DetailsRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as DetailsRecord) : {};

const readEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

  if (row.type === 'sleep') {
    const startedAt = readDate(details.startedAt) ?? new Date(row.logged_at);
    return {
      ...base,
      type: 'sleep',
      startedAt,
      // endedAt が null なのは計測中のときだけ。details を持たない過去の記録は
      // 起床時刻が分からないため、計測中と取り違えないよう開始時刻を入れておく。
      endedAt: isLegacy ? startedAt : readDate(details.endedAt),
    };
  }

  return {
    ...base,
    type: 'milk',
    method: readEnum<FeedingMethod>(details.method, ['breast', 'formula']) ?? 'formula',
    amountMl: readNumber(details.amountMl),
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
    set('leftMinutes', log.leftMinutes);
    set('rightMinutes', log.rightMinutes);
    set('lastSide', log.lastSide);
  } else if (log.type === 'diaper') {
    set('kind', log.kind);
    set('poopColor', log.poopColor);
    set('poopConsistency', log.poopConsistency);
  } else {
    set('startedAt', log.startedAt.toISOString());
    // 計測中であることを表すため、endedAt は null のまま入れる。
    details.endedAt = log.endedAt ? log.endedAt.toISOString() : null;
  }

  return details as Json;
};

/** 一覧に出す短い要約。details を持たない過去の記録との互換のため amount にも残す。 */
const careLogToAmount = (log: CareLog): string => {
  if (log.type === 'milk') {
    if (log.method === 'formula') return log.amountMl ? `${log.amountMl}ml` : '';
    const parts = [
      log.leftMinutes ? `左${log.leftMinutes}分` : '',
      log.rightMinutes ? `右${log.rightMinutes}分` : '',
    ].filter(Boolean);
    return parts.join(' ');
  }
  if (log.type === 'diaper') return '';
  if (!log.endedAt) return '';
  const minutes = Math.max(0, Math.round((log.endedAt.getTime() - log.startedAt.getTime()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}時間${minutes % 60}分` : `${minutes}分`;
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

/** 計測中の睡眠（起床時刻が未確定のもの）を1件だけ取り出す。表示中の日に関わらず探す。 */
export async function findActiveSleepCareLog(
  supabase: SupabaseDb,
  familyId: string,
): Promise<CareLog | null> {
  const { data, error } = await supabase
    .from('care_logs')
    .select('*')
    .eq('family_id', familyId)
    .eq('type', 'sleep')
    // ->> で取り出すと JSON の null も SQL の NULL として扱われる（-> のままだと一致しない）
    .is('details->>endedAt', null)
    .not('details->>startedAt', 'is', null)
    .order('logged_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? rowToCareLog(row) : null;
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
