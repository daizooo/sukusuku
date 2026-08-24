import * as SQLite from 'expo-sqlite';

// 端末内に控えるためのSQLite。
//
// ネイティブにしただけでは圏外で使えない（docs/native-app-rewrite.md §6）。
// データはSupabaseにあるので、端末側に控えを持って初めて圏外で開ける。
// あわせて、起動直後にサーバーの返事を待たずに画面を埋める役目も持つ（同 §3）。
//
// 持つのは次の3つだけ。
// - care_logs : 表示した範囲の記録の控え。まだ送れていない記録も同じ表に入れる
// - outbox    : 送れていない書き込み（追加・変更・削除）を順番に並べたもの
// - kv        : 1件ものの控え（搾乳ストックなど）

const DATABASE_NAME = 'sukusuku.db';

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS care_logs (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  type TEXT NOT NULL,
  -- 並べ替えと期間の絞り込みに使う。ISO8601（UTC）。
  logged_at TEXT NOT NULL,
  -- CareLog をそのままJSONにしたもの（time は ISO8601）。
  payload TEXT NOT NULL,
  -- 1 のあいだは、この端末でしか存在しない記録（まだSupabaseへ送れていない）。
  pending INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS care_logs_family_logged_at
  ON care_logs (family_id, logged_at);

CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'insert' | 'update' | 'delete'
  kind TEXT NOT NULL,
  log_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  -- 送るときの中身。delete では使わない。
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** 端末内の控えを開く。1つの接続をアプリ全体で使い回す。 */
export function getLocalDb(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME)
      .then(async (db) => {
        await db.execAsync(SCHEMA);
        return db;
      })
      .catch((error) => {
        // 次に呼ばれたときに開き直せるよう、失敗した約束は残さない。
        databasePromise = null;
        throw error;
      });
  }
  return databasePromise;
}

export async function readKv<T>(key: string): Promise<T | null> {
  const db = await getLocalDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    // 壊れた控えは無いものとして扱う（次の取得で書き直される）。
    return null;
  }
}

export async function writeKv(key: string, value: unknown): Promise<void> {
  const db = await getLocalDb();
  await db.runAsync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}
