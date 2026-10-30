// sukusuku スキーマに新しく作る表に、明示的な GRANT を付け忘れていないか確かめる。
// 実行: npm run check:table-grants
//
// sukusuku スキーマ（統合プロジェクト Persol）の新しい表には、Data API 用の権限が自動では付かない。
// 付け忘れると、その表だけ supabase-js から permission denied になる（本番に出してから気づく）。
// supabase/personal の 0006 より後の SQL で `create table sukusuku.表` をしたら、同じファイルに
// `grant ... on sukusuku.表 to ...`（authenticated か service_role 向け）を書く。
//
// 例（アプリから読み書きする表）:
//   grant select, insert, update, delete on sukusuku.表 to authenticated;
//   grant all on sukusuku.表 to service_role;
// 関数からだけ触る表は service_role だけでよい。
// 付けない理由がある表は、そのファイルに `-- grant-ignore: 表名 （理由）` と書けば除ける。

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'personal');

// この番号より後の SQL だけ見る。0001 が、移行した表の権限をまとめて明示している。
const AFTER = 6;

const errors = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const num = Number(file.match(/^(\d+)/)?.[1]);
  if (!Number.isFinite(num) || num <= AFTER) continue;

  const raw = readFileSync(join(dir, file), 'utf8');
  const ignored = new Set(
    [...raw.matchAll(/--\s*grant-ignore:\s*([a-z0-9_,\s]+)/gi)].flatMap((m) =>
      m[1].split(/[,\s]+/).filter(Boolean),
    ),
  );
  // コメントを除いて調べる（コメントの中の create table や grant に惑わされない）
  const sql = raw.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const tables = [
    ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?sukusuku\.("?)([a-z0-9_]+)\1/gi),
  ].map((m) => m[2]);

  for (const table of new Set(tables)) {
    if (ignored.has(table)) continue;
    const grant = new RegExp(
      `grant\\s+[^;]*?\\bon\\s+(?:table\\s+)?sukusuku\\."?${table}"?\\s+to\\s+[^;]*\\b(?:authenticated|service_role)\\b`,
      'i',
    );
    if (!grant.test(sql)) {
      errors.push(
        `supabase/personal/${file}: sukusuku.${table} に GRANT が無い。` +
          `\`grant select, insert, update, delete on sukusuku.${table} to authenticated;\` と ` +
          `\`grant all on sukusuku.${table} to service_role;\` を足す（理由があって付けないなら \`-- grant-ignore: ${table} （理由）\`）`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error('table grants check: NG');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log('table grants check: OK');
