// 画面の位置（開いているタブ・開く入力画面）をURLに載せるための決まりごと。
//
// 目的は2つ。
// 1. 画面を更新しても、見ていたタブのまま戻ってこられるようにする
//    （URLに残っていない状態は、読み込み直すたびにホームへ戻ってしまう）。
// 2. 通知をタップしたときに、その用件の画面へ直接開けるようにする
//    （検温のお知らせなら体温の入力画面、というように）。
//
// URLの組み立て側（public/sw.js）と読み取り側（src/app/page.tsx）で
// 食い違わないよう、キーと値の解釈をここに1つだけ置く。

import type { LogType, TabId } from '@/types/app';

/** 開いているタブ。'home' は既定なのでURLには載せない。 */
export const TAB_PARAM = 'tab';

/** 記録タブで開く入力画面の種類。開いたら消す（更新のたびに開き直さないため）。 */
export const OPEN_LOG_PARAM = 'open';

const TAB_IDS: TabId[] = ['home', 'schedule', 'log', 'nursery', 'info'];
const LOG_TYPES: LogType[] = ['milk', 'diaper', 'pumping', 'temperature'];

const firstValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** URLのtabを解釈する。知らない値なら null（呼び出し側で既定のタブにする）。 */
export const parseTabId = (value: string | string[] | undefined): TabId | null => {
  const found = TAB_IDS.find((id) => id === firstValue(value));
  return found ?? null;
};

/** URLのopenを解釈する。知らない値なら null（入力画面は開かない）。 */
export const parseLogType = (value: string | string[] | undefined): LogType | null => {
  const found = LOG_TYPES.find((type) => type === firstValue(value));
  return found ?? null;
};
