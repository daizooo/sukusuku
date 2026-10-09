// 家族の変更台帳（family_sync。supabase/migrations/0078_family_sync.sql）の時刻を扱う、画面に依らない部分。
// PWA 版（src/lib/familySyncStamps.ts）と同じ内容。実行するテスト: npm run test:family-sync-mobile
//
// 台帳の changed は {表名: 最後に変わった時刻(ISO8601)}。時刻はサーバーが付けるので、
// 端末の時計とは比べない（前に見た時刻と「同じか違うか」だけを見る）。

export type Stamps = Record<string, string>;

/** 台帳の changed（JSON）を、表名→時刻の入れ物にする。形が違うものは無いものとして扱う。 */
export const toStamps = (value: unknown): Stamps => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const stamps: Stamps = {};
  for (const [table, stamp] of Object.entries(value)) {
    if (typeof stamp === 'string') stamps[table] = stamp;
  }
  return stamps;
};

/** 台帳のうち、指定した表の分だけを取り出す。 */
export const pickStamps = (tables: readonly string[], stamps: Stamps): Stamps => {
  const picked: Stamps = {};
  for (const table of tables) {
    const stamp = stamps[table];
    if (stamp !== undefined) picked[table] = stamp;
  }
  return picked;
};

/** 指定した表のうち、前と時刻が変わったものがあるか（一度も変わっていない表は時刻なしどうしで同じ）。 */
export const hasChanged = (tables: readonly string[], before: Stamps, after: Stamps): boolean =>
  tables.some((table) => (before[table] ?? '') !== (after[table] ?? ''));
