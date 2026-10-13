import type { Contract, ContractAmountCycle, ContractDraft, ContractKind, MemberRelation } from '@/types/app';

// 契約（docs/contracts.md）の、画面に依らない計算と文言。
// PWA版の `src/lib/contractUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
// 日付は 'YYYY-MM-DD' の文字で受け取る（今日はアプリ側の日本時間の日付）。

export const CONTRACT_KINDS: ContractKind[] = ['rent', 'insurance', 'subscription', 'other'];

export const KIND_LABEL: Record<ContractKind, string> = {
  rent: '賃貸',
  insurance: '保険',
  subscription: 'サブスク',
  other: 'その他',
};

export const CYCLE_LABEL: Record<ContractAmountCycle, string> = {
  monthly: '月',
  yearly: '年',
  once: '1回',
};

export const CYCLES: ContractAmountCycle[] = ['monthly', 'yearly', 'once'];

/** 更新日の何日前にお知らせするかの選択肢（既定は 30・7・1。DB の notify_days の既定と同じ）。 */
export const NOTIFY_DAY_OPTIONS = [60, 30, 14, 7, 3, 1];
export const DEFAULT_NOTIFY_DAYS = [30, 7, 1];

/** 自由項目の入力欄の下に常に出す注意書き。持たない方針を、案内で守る。 */
export const FIELD_WARNING = '証券番号・口座・カード番号・パスワードは入れないでください';

const parse = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** to までの日数（to - from）。過ぎていれば負。 */
export const daysBetween = (from: string, to: string): number =>
  Math.round((parse(to) - parse(from)) / 86_400_000);

export type RenewalTone = 'alert' | 'warn' | 'plain';

export interface RenewalBadge {
  text: string;
  tone: RenewalTone;
  /** 更新日を過ぎているか。一覧では先頭に出す。 */
  overdue: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/**
 * 更新日のバッジ。30日以内=橙、7日以内か過ぎている=赤、それ以外は灰。
 * 更新日が無い契約は null（バッジを出さない）。
 */
export const renewalBadge = (renewsOn: string | null, today: string): RenewalBadge | null => {
  if (!renewsOn) return null;
  const days = daysBetween(today, renewsOn);
  if (days < 0) return { text: `更新日を${-days}日過ぎています`, tone: 'alert', overdue: true };
  if (days === 0) return { text: '今日が更新日です', tone: 'alert', overdue: false };
  const tone: RenewalTone = days <= 7 ? 'alert' : days <= 30 ? 'warn' : 'plain';
  return { text: `更新まで ${days}日（${monthDay(renewsOn)}）`, tone, overdue: false };
};

/** 月数を足す。月末は、その月の最後の日に丸める（1/31 + 1か月 = 2/28）。 */
export const addMonths = (date: string, months: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
};

/** 「更新した」。更新日を契約期間ぶん進める。今日より先になるまで進める（長く放置した契約でも一度で済む）。 */
export const advanceRenewal = (renewsOn: string, termMonths: number, today: string): string => {
  let next = addMonths(renewsOn, termMonths);
  // 無限ループを避けるため、上限を置く（1か月刻みでも約80年分）。
  for (let i = 0; i < 1000 && daysBetween(today, next) < 0; i += 1) next = addMonths(next, termMonths);
  return next;
};

/**
 * その他タブの「契約」の行に添える、いちばん急ぐ更新日。
 * 更新日を過ぎた契約があればそれ、無ければ最も近い更新日（90日先まで）。無ければ null（バッジを出さない）。
 */
export const nearestRenewal = (
  contracts: Pick<Contract, 'renewsOn' | 'title'>[],
  today: string,
): { text: string; tone: RenewalTone } | null => {
  const first = sortContracts(contracts.filter((contract) => contract.renewsOn !== null))[0];
  if (!first || first.renewsOn === null) return null;
  const days = daysBetween(today, first.renewsOn);
  if (days < 0) return { text: '更新日を過ぎた契約があります', tone: 'alert' };
  if (days > 90) return null;
  return { text: `更新まで ${days}日（${first.title}）`, tone: days <= 7 ? 'alert' : days <= 30 ? 'warn' : 'plain' };
};

/** 年間の金額。月払い×12、年払いはそのまま、1回払い・金額なしは 0。 */
export const annualAmount = (contract: Pick<Contract, 'amount' | 'amountCycle'>): number => {
  if (contract.amount === null || contract.amountCycle === null) return 0;
  if (contract.amountCycle === 'monthly') return contract.amount * 12;
  if (contract.amountCycle === 'yearly') return contract.amount;
  return 0;
};

/** 見えている契約の年間の目安の合計。 */
export const annualTotal = (contracts: Pick<Contract, 'amount' | 'amountCycle'>[]): number =>
  contracts.reduce((sum, contract) => sum + annualAmount(contract), 0);

/** 並び。更新日を過ぎたものが先、次に更新日の近い順、更新日が無いものは末尾（同じなら名称順）。 */
export const sortContracts = <T extends Pick<Contract, 'renewsOn' | 'title'>>(contracts: T[]): T[] =>
  [...contracts].sort((a, b) => {
    if (a.renewsOn === b.renewsOn) return a.title.localeCompare(b.title, 'ja');
    if (a.renewsOn === null) return 1;
    if (b.renewsOn === null) return -1;
    return a.renewsOn < b.renewsOn ? -1 : 1;
  });

type ContractMember = { id: string; displayName: string; relation: MemberRelation };

/** 見せる相手として選べる家族。夫婦だけ（子は選ばせない）。 */
export const visibleCandidates = <T extends { relation: MemberRelation }>(members: T[]): T[] =>
  members.filter((member) => member.relation !== 'child');

/** 新しい契約の見せる相手の初期値。夫婦と、作った本人。 */
export const defaultVisibleMemberIds = (members: ContractMember[], myMemberId: string | null): string[] => {
  const ids = visibleCandidates(members).map((member) => member.id);
  return myMemberId && !ids.includes(myMemberId) ? [...ids, myMemberId] : ids;
};

/**
 * 見せる相手が限られているときの添え書き。夫婦の全員に見せていれば null（印を出さない）。
 * 自分だけなら「自分だけ」、それ以外は見せる相手の名前を「・」でつなぐ。
 */
export const visibilityLabel = (
  visibleMemberIds: string[],
  members: ContractMember[],
  myMemberId: string | null,
): string | null => {
  const couple = visibleCandidates(members);
  if (couple.length > 0 && couple.every((member) => visibleMemberIds.includes(member.id))) return null;
  if (myMemberId !== null && visibleMemberIds.length === 1 && visibleMemberIds[0] === myMemberId) return '自分だけ';
  const names = members.filter((member) => visibleMemberIds.includes(member.id)).map((member) => member.displayName);
  return names.length > 0 ? names.join('・') : null;
};

/** 金額の表示。「¥98,000」。 */
export const formatYen = (value: number): string => `¥${value.toLocaleString('ja-JP')}`;

/** 一覧の2行目に出す「月 ¥98,000」。金額が無ければ null。 */
export const amountText = (contract: Pick<Contract, 'amount' | 'amountCycle'>): string | null =>
  contract.amount === null || contract.amountCycle === null
    ? null
    : `${CYCLE_LABEL[contract.amountCycle]} ${formatYen(contract.amount)}`;

/** 空の入力。契約者は作った本人、見せる相手は夫婦（defaultVisibleMemberIds）。 */
export const emptyContractDraft = (myMemberId: string | null, visibleMemberIds: string[]): ContractDraft => ({
  kind: 'rent',
  title: '',
  company: '',
  contractorId: myMemberId,
  startedOn: null,
  renewsOn: null,
  termMonths: null,
  amount: null,
  amountCycle: null,
  notifyDays: DEFAULT_NOTIFY_DAYS,
  memo: '',
  visibleMemberIds,
  fields: [],
});

/** 入力の誤り。無ければ null。 */
export const draftError = (draft: ContractDraft): string | null => {
  if (draft.title.trim() === '') return '名称を入力してください';
  if (draft.visibleMemberIds.length === 0) return '見せる相手を1人以上選んでください';
  if ((draft.amount === null) !== (draft.amountCycle === null)) return '金額と周期はセットで入力してください';
  if (draft.termMonths !== null && draft.termMonths <= 0) return '契約期間は1か月以上にしてください';
  return null;
};

/** 数字の入力欄の文字を整数にする。空や数字でないものは null。 */
export const parseCount = (text: string): number | null => {
  const digits = text.replace(/[^0-9]/g, '');
  if (digits === '') return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
};
