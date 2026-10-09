// 「他の端末での変更を画面へ届ける仕組み」（変更台帳 family_sync。docs/sync.md）の付け忘れを見つける。
// 実行: npm run check:family-sync
//
// 確かめること:
//  1. DB: family_id を持つ表を migration で作ったのに、台帳へ載せていない（attach_family_sync を呼んでいない）
//  2. 画面: 読み込みのAPIを使う画面（mobile のタブ、PWA の本体とタブ）が、読む表を useFamilyRefresh で
//     宣言していない、または宣言が足りない
//
// 画面の確かめ方: 画面が import した API 関数のうち、表を「読む」もの（.from('表').select(...) と、
// RPC_TABLES に書いた読む関数）が触る表を、useFamilyRefresh に宣言しているか。書き込みだけの関数は求めない。
// 足りすぎて困る表は、そのファイルに `// family-sync-ignore: 表名, 表名 （理由）` と書けば除ける。
// 台帳に載っていない表（push_subscriptions など）は、画面側の宣言を求めない。
// family_id を持たない表（親をたどって家族が決まる表）は、DB側の検査では見つけられない。
// 新しい表を足したときは attach_family_sync の第2引数に家族の取り方を渡す（0078 の例）。

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const errors = [];

// 台帳に載せない表（家族で共有しない・本人だけのもの）。0078 の family_sync_missing() と同じ。
const NOT_SHARED = new Set([
  'family_sync',
  'users',
  'push_subscriptions',
  'member_invites',
  'stock_expiry_deliveries',
  'temperature_reminder_deliveries',
]);

// 画面の読み込みで使う DB関数（rpc）が読む表。関数の中身は画面のコードからは見えないので、ここに書く。
// 書き込みの関数（save_money_record、lottery_* など）は、画面が読み込みに使わないので書かない。
const RPC_TABLES = {
  money_bootstrap: [
    'household_products', 'money_budgets', 'money_categories', 'money_holdings', 'money_items',
    'money_records', 'money_recurring', 'money_securities', 'money_stores', 'money_wallet_balances',
    'money_wallets', 'special_items', 'special_plans',
  ],
  money_latest_holding_values: ['money_holding_values'],
};

// 端末内の控え（SQLite）ごしに読むもの。
const MODULE_TABLES = { 'offline/careLogs': ['care_logs'] };

// migration ファイルの外で本番から落とした表（コードにはまだ名前が残っている）。
const DROPPED_OUTSIDE_MIGRATIONS = new Set(['family_profiles']);

// --- 1. DB ---
const migrationDir = 'supabase/migrations';
const migrations = readdirSync(join(root, migrationDir))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, text: read(`${migrationDir}/${name}`) }));

const tracked = new Set();
for (const { text } of migrations) {
  if (!text.includes('attach_family_sync')) continue;
  for (const match of text.matchAll(/'public\.([a-z0-9_]+)'/g)) tracked.add(match[1]);
}

const withFamilyId = new Set();
for (const { text } of migrations) {
  for (const match of text.matchAll(
    /create table(?: if not exists)?\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\n\)\s*;/gi,
  )) {
    if (/\bfamily_id\b/.test(match[2])) withFamilyId.add(match[1]);
  }
}
const dropped = new Set(DROPPED_OUTSIDE_MIGRATIONS);
for (const { text } of migrations) {
  for (const match of text.matchAll(/drop table(?: if exists)?\s+(?:public\.)?([a-z0-9_]+)/gi)) {
    dropped.add(match[1]);
  }
}
for (const table of [...withFamilyId].sort()) {
  if (NOT_SHARED.has(table) || tracked.has(table) || dropped.has(table)) continue;
  errors.push(
    `DB: ${table} は family_id を持つが、変更台帳へ載っていない。migration の中で ` +
      `select public.attach_family_sync('public.${table}'); を呼ぶ（共有しない表なら NOT_SHARED と 0078 の family_sync_missing に足す）`,
  );
}

// --- 2. 画面 ---
const apps = [
  {
    name: 'mobile',
    apiDir: 'mobile/src/lib/api',
    files: () =>
      readdirSync(join(root, 'mobile/app/(tabs)'))
        .filter((name) => name.endsWith('.tsx'))
        .map((name) => `mobile/app/(tabs)/${name}`),
  },
  {
    name: 'PWA',
    apiDir: 'src/lib/api',
    files: () => [
      'src/components/sukusuku/SukusukuApp.tsx',
      ...readdirSync(join(root, 'src/components/sukusuku/tabs'))
        .filter((name) => name.endsWith('.tsx'))
        .map((name) => `src/components/sukusuku/tabs/${name}`),
    ],
  },
];

/** コードの塊（関数の本体）が「読む」表。.from('表').select(...) と、RPC_TABLES の関数。 */
const readTablesOf = (code) => {
  const tables = new Set();
  for (const match of code.matchAll(/\.from\('([a-z0-9_]+)'\)\s*\.select\(/g)) tables.add(match[1]);
  for (const match of code.matchAll(/\.rpc\('([a-z0-9_]+)'/g)) {
    for (const table of RPC_TABLES[match[1]] ?? []) tables.add(table);
  }
  return tables;
};

/** モジュールの先頭レベルの関数・定数ごとの本体を切り出す（次の先頭レベルの宣言の手前まで）。 */
const topLevelBlocks = (text) => {
  const heads = [
    ...text.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*[:=])/gm),
  ];
  const blocks = new Map();
  heads.forEach((head, index) => {
    const name = head[1] ?? head[2];
    const end = index + 1 < heads.length ? heads[index + 1].index : text.length;
    blocks.set(name, text.slice(head.index, end));
  });
  return blocks;
};

/** 画面が import した名前（関数）が読む表のうち、台帳に載っているもの。 */
const tablesOfImports = (app, moduleName, names) => {
  if (MODULE_TABLES[moduleName]) return MODULE_TABLES[moduleName];
  const path = `${app.apiDir}/${moduleName}.ts`;
  if (!existsSync(join(root, path))) return [];
  const blocks = topLevelBlocks(read(path));
  const tables = new Set();
  const visit = (name, depth) => {
    const block = blocks.get(name);
    if (!block) return;
    for (const table of readTablesOf(block)) tables.add(table);
    // 同じファイルの別の関数を呼んでいれば、そちらが読む表も数える（2段まで）。
    if (depth >= 2) return;
    for (const other of blocks.keys()) {
      if (other !== name && new RegExp(`\\b${other}\\b`).test(block)) visit(other, depth + 1);
    }
  };
  for (const name of names) visit(name, 0);
  return [...tables];
};

/** useFamilyRefresh の第1引数（配列そのもの、または同じファイルの定数）から表名を集める。 */
const declaredTables = (text) => {
  const declared = new Set();
  let calls = 0;
  for (const match of text.matchAll(/useFamilyRefresh\(\s*(\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_]*)/g)) {
    calls += 1;
    let list = match[1];
    if (!list.startsWith('[')) {
      const def = text.match(new RegExp(`const ${list}\\s*(?::[^=]+)?=\\s*(\\[[^\\]]*\\])`));
      if (!def) {
        errors.push(`画面: ${list} の定義が見つからない（useFamilyRefresh には配列か、同じファイルの定数を渡す）`);
        continue;
      }
      list = def[1];
    }
    for (const name of list.matchAll(/'([a-z0-9_]+)'/g)) declared.add(name[1]);
  }
  return { declared, calls };
};

for (const app of apps) {
  for (const file of app.files()) {
    const text = read(file);
    const ignored = new Set();
    for (const match of text.matchAll(/family-sync-ignore:\s*([a-z0-9_,\s]+)/g)) {
      for (const name of match[1].split(',')) if (name.trim()) ignored.add(name.trim());
    }

    const required = new Set();
    for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/(api|offline)\/([A-Za-z0-9]+)'/g)) {
      const names = match[1]
        .split(',')
        .map((name) => name.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      const moduleName = match[2] === 'offline' ? `offline/${match[3]}` : match[3];
      for (const table of tablesOfImports(app, moduleName, names)) {
        if (tracked.has(table) && !ignored.has(table)) required.add(table);
      }
    }
    if (required.size === 0) continue;

    const { declared, calls } = declaredTables(text);
    if (calls === 0) {
      errors.push(
        `画面: ${file} は ${[...required].sort().join(', ')} を読むが、useFamilyRefresh が無い。` +
          `他の端末での変更が、アプリを開き直すまで出ない`,
      );
      continue;
    }
    const missing = [...required].filter((table) => !declared.has(table)).sort();
    if (missing.length > 0) {
      errors.push(
        `画面: ${file} の useFamilyRefresh に、読む表 ${missing.join(', ')} が宣言されていない`,
      );
    }
    for (const table of declared) {
      if (!tracked.has(table)) {
        errors.push(`画面: ${file} が宣言した ${table} は、変更台帳に載っていない表（宣言しても読み直されない）`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`check-family-sync: ${errors.length} 件\n` + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log(`check-family-sync: ok（台帳の表 ${tracked.size}、family_id を持つ表 ${withFamilyId.size}）`);
