// かぞく手帳: Zaim の入出金通知メールを読む（家計タブ。docs/kakei.md §9.5.1）
//
// 件名   {口座名}にて{入金|出金}がありました（{内容}）   内容の中にもかっこが入れ子で入る
// 本文   新着の{入金|出金} {月} 月 {日} 日（曜） ￥{金額。カンマあり} {口座名} {内容}
// 年は入っていないので、受信日時（日本時間）から決める。受信月より大きい月なら前の年。

export interface ZaimMail {
  direction: 'in' | 'out';
  accountName: string;
  occurredOn: string; // YYYY-MM-DD
  amount: number;
  description: string;
}

const SUBJECT_RE = /^\s*(.+?)にて(入金|出金)がありました\s*(?:（([\s\S]*)）)?\s*$/;
const BODY_RE = /新着の(入金|出金)\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^￥¥]*[￥¥]\s*([\d,]+)/;

const pad = (n: number): string => String(n).padStart(2, '0');

// 受信日時（ISO）から、日本時間の年・月
const jstYearMonth = (receivedAt: string): { year: number; month: number } | null => {
  const ms = Date.parse(receivedAt);
  if (Number.isNaN(ms)) return null;
  const jst = new Date(ms + 9 * 3600_000);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1 };
};

// 読めないときは null（「読めない」として残す）
export function parseZaimMail(subject: string, body: string, receivedAt: string): ZaimMail | null {
  const s = SUBJECT_RE.exec(subject.normalize('NFC'));
  const b = BODY_RE.exec(body.normalize('NFC'));
  const received = jstYearMonth(receivedAt);
  if (!s || !b || !received) return null;
  const direction = s[2] === '入金' ? 'in' : 'out';
  if ((b[1] === '入金' ? 'in' : 'out') !== direction) return null;

  const month = Number(b[2]);
  const day = Number(b[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = month > received.month ? received.year - 1 : received.year;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;

  const amount = Number(b[4].replace(/,/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  return {
    direction,
    accountName: s[1].trim(),
    occurredOn: `${year}-${pad(month)}-${pad(day)}`,
    amount,
    description: (s[3] ?? '').trim(),
  };
}
