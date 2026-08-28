import type { CareLog, PumpedBatch } from '@/types/app';
import type { SupabaseDb } from '@/lib/supabase';
import {
  deleteCareLog,
  insertCareLog,
  listCareLogsInRange,
  listPumpedBatches,
  updateCareLog,
  type NewCareLogInput,
} from '@/lib/api/careLogs';
import { getLocalDb, readKv, writeKv } from '@/lib/offline/db';

// 記録の読み書きを、端末内の控え（src/lib/offline/db.ts）ごしに行う層。
//
// 読み  : まず控えを返して画面を埋め、そのあとSupabaseから取り直して控えを更新する。
// 書き  : 先に控えへ入れて画面へ反映し、outboxに積んでから送る。送れなければ積まれたまま残り、
//         次にアプリを開いたときや電波が戻ったときに送られる。
//
// 授乳中に電波が悪くて記録できないのがいちばん困る形の失敗なので、
// 記録は「圏外でも付けられて、後から送られる」を満たす形にしている
// （docs/native-app-rewrite.md §6）。

const PUMPED_BATCHES_KEY = 'pumpedBatches';

/** まだSupabaseへ送れていない記録に付ける、この端末の中だけのid。 */
const localId = (): string =>
  `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const isLocalCareLogId = (id: string): boolean => id.startsWith('local-');

// --- 控えの読み書き ---

interface CareLogRow {
  payload: string;
  pending: number;
}

/** 控えに入れるときの形。Date はJSONに乗らないのでISO8601にする。 */
const serialize = (log: CareLog): string =>
  JSON.stringify({ ...log, time: log.time.toISOString() });

const deserialize = (payload: string): CareLog | null => {
  try {
    const parsed = JSON.parse(payload) as CareLog & { time: string };
    return { ...parsed, time: new Date(parsed.time) };
  } catch {
    // 壊れた控えは無いものとして扱う（次の取得で書き直される）。
    return null;
  }
};

/** 控えにある記録。新しい順。 */
export async function readCachedLogsInRange(
  familyId: string,
  from: Date,
  to: Date,
): Promise<CareLog[]> {
  const db = await getLocalDb();
  const rows = await db.getAllAsync<CareLogRow>(
    `SELECT payload, pending FROM care_logs
     WHERE family_id = ? AND logged_at >= ? AND logged_at < ?
     ORDER BY logged_at DESC`,
    familyId,
    from.toISOString(),
    to.toISOString(),
  );
  return rows.map((row) => deserialize(row.payload)).filter((log): log is CareLog => log !== null);
}

/**
 * 取り直した記録で、その期間の控えを置き換える。
 * まだ送れていない記録（pending）はサーバーにまだ無いので、置き換えでも消さない。
 */
export async function replaceCachedRange(
  familyId: string,
  from: Date,
  to: Date,
  logs: CareLog[],
): Promise<void> {
  const db = await getLocalDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM care_logs
       WHERE family_id = ? AND logged_at >= ? AND logged_at < ? AND pending = 0`,
      familyId,
      from.toISOString(),
      to.toISOString(),
    );
    for (const log of logs) {
      await db.runAsync(
        `INSERT INTO care_logs (id, family_id, type, logged_at, payload, pending)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           logged_at = excluded.logged_at, payload = excluded.payload, pending = 0`,
        log.id,
        familyId,
        log.type,
        log.time.toISOString(),
        serialize(log),
      );
    }
  });
}

type CachedPumpedBatch = {
  id: string;
  time: string;
  amountMl: number;
  usedBy: string | null;
  /** 丸ごと捨てた日時。捨てていなければ null。控えを作った頃には無かったので、無い場合もある。 */
  discardedAt?: string | null;
};

export const readCachedPumpedBatches = async (): Promise<PumpedBatch[]> => {
  const cached = await readKv<CachedPumpedBatch[]>(PUMPED_BATCHES_KEY);
  return (cached ?? []).map((batch) => ({
    ...batch,
    time: new Date(batch.time),
    discardedAt: batch.discardedAt ? new Date(batch.discardedAt) : null,
  }));
};

export const writeCachedPumpedBatches = (batches: PumpedBatch[]): Promise<void> =>
  writeKv(
    PUMPED_BATCHES_KEY,
    batches.map((batch) => ({
      ...batch,
      time: batch.time.toISOString(),
      discardedAt: batch.discardedAt?.toISOString() ?? null,
    })),
  );

// --- 書き込み（控えへ入れて outbox に積む）---

type OutboxKind = 'insert' | 'update' | 'delete';

const enqueue = async (
  kind: OutboxKind,
  familyId: string,
  logId: string,
  payload: string,
): Promise<void> => {
  const db = await getLocalDb();
  await db.runAsync(
    'INSERT INTO outbox (kind, log_id, family_id, payload, created_at) VALUES (?, ?, ?, ?, ?)',
    kind,
    logId,
    familyId,
    payload,
    new Date().toISOString(),
  );
};

/** 記録を足す。控えにはすぐ入り、送るのは後（圏外でもここまでは通る）。 */
export async function queueInsertCareLog(
  familyId: string,
  userId: string,
  input: NewCareLogInput,
): Promise<CareLog> {
  const log = { ...input, id: localId(), createdBy: userId } as CareLog;
  const db = await getLocalDb();
  const payload = serialize(log);
  // 控えだけ入って送る予定が残らない（またはその逆）状態にならないよう、まとめて入れる。
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO care_logs (id, family_id, type, logged_at, payload, pending)
       VALUES (?, ?, ?, ?, ?, 1)`,
      log.id,
      familyId,
      log.type,
      log.time.toISOString(),
      payload,
    );
    await enqueue('insert', familyId, log.id, payload);
  });
  return log;
}

/** 記録を書き換える。まだ送れていない記録なら、積んである中身を差し替えるだけで足りる。 */
export async function queueUpdateCareLog(familyId: string, log: CareLog): Promise<void> {
  const db = await getLocalDb();
  const payload = serialize(log);
  await db.runAsync(
    'UPDATE care_logs SET logged_at = ?, payload = ? WHERE id = ?',
    log.time.toISOString(),
    payload,
    log.id,
  );
  if (isLocalCareLogId(log.id)) {
    await db.runAsync('UPDATE outbox SET payload = ? WHERE log_id = ?', payload, log.id);
    return;
  }
  await enqueue('update', familyId, log.id, payload);
}

/** 記録を消す。まだ送れていない記録なら、積んであるぶんごと取り下げる。 */
export async function queueDeleteCareLog(familyId: string, id: string): Promise<void> {
  const db = await getLocalDb();
  await db.runAsync('DELETE FROM care_logs WHERE id = ?', id);
  if (isLocalCareLogId(id)) {
    await db.runAsync('DELETE FROM outbox WHERE log_id = ?', id);
    return;
  }
  await enqueue('delete', familyId, id, '');
}

/** まだ送れていない書き込みの数。画面に出して、送り残しに気づけるようにする。 */
export async function countUnsentCareLogs(familyId: string): Promise<number> {
  const db = await getLocalDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM outbox WHERE family_id = ?',
    familyId,
  );
  return row?.count ?? 0;
}

// --- 送信 ---

interface OutboxRow {
  seq: number;
  kind: OutboxKind;
  log_id: string;
  payload: string;
}

/**
 * 積んである書き込みを古い順に送る。1つでも送れなければそこで止めて、残りは積んだままにする
 * （順番を入れ替えると、追加より先に変更を送ってしまうことがあるため）。
 *
 * @returns 全部送り切れたか
 */
export async function flushCareLogOutbox(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
): Promise<boolean> {
  const db = await getLocalDb();
  const entries = await db.getAllAsync<OutboxRow>(
    'SELECT seq, kind, log_id, payload FROM outbox WHERE family_id = ? ORDER BY seq',
    familyId,
  );
  if (entries.length === 0) return true;

  // 端末の中だけのid -> Supabaseが採番したid。追加を送ったあとの変更・削除で読み替える。
  const idMap = new Map<string, string>();

  for (const entry of entries) {
    const logId = idMap.get(entry.log_id) ?? entry.log_id;
    try {
      if (entry.kind === 'delete') {
        await deleteCareLog(supabase, logId);
      } else {
        const log = deserialize(entry.payload);
        // 中身が読めない積み残しは送りようがないので、捨てて先へ進む。
        if (log) {
          if (entry.kind === 'insert') {
            const saved = await insertCareLog(supabase, familyId, userId, log);
            idMap.set(entry.log_id, saved.id);
            await replaceLocalId(familyId, entry.log_id, saved);
          } else {
            await updateCareLog(supabase, { ...log, id: logId });
          }
        }
      }
    } catch {
      // 圏外・サーバー側の不調。送れた分だけ消して、残りは次の機会に送る。
      return false;
    }
    await db.runAsync('DELETE FROM outbox WHERE seq = ?', entry.seq);
  }
  return true;
}

/** 追加が通った記録を、端末の中だけのidからSupabaseのidへ差し替える。 */
async function replaceLocalId(familyId: string, oldId: string, saved: CareLog): Promise<void> {
  const db = await getLocalDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM care_logs WHERE id = ?', oldId);
    await db.runAsync(
      `INSERT INTO care_logs (id, family_id, type, logged_at, payload, pending)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         logged_at = excluded.logged_at, payload = excluded.payload, pending = 0`,
      saved.id,
      familyId,
      saved.type,
      saved.time.toISOString(),
      serialize(saved),
    );
  });
}

/**
 * 積み残しを送ってから、その期間の記録を取り直して控えを更新する。
 * @returns 画面に出す記録（新しい順）と、送り残しがあるか
 */
export async function syncCareLogsInRange(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
  from: Date,
  to: Date,
): Promise<{ logs: CareLog[]; pumpedBatches: PumpedBatch[]; hasUnsent: boolean }> {
  const sent = await flushCareLogOutbox(supabase, familyId, userId);
  const [logs, pumpedBatches] = await Promise.all([
    listCareLogsInRange(supabase, familyId, from, to),
    listPumpedBatches(supabase, familyId),
  ]);
  await Promise.all([
    replaceCachedRange(familyId, from, to, logs),
    writeCachedPumpedBatches(pumpedBatches),
  ]);
  // 送れていない記録はサーバーにまだ無いので、取り直した分と混ぜて返す。
  const cached = await readCachedLogsInRange(familyId, from, to);
  return { logs: cached, pumpedBatches, hasUnsent: !sent };
}
