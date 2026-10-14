// 通知の上で打ち込まれた体温を読む（notificationActions.ts）。
//
// 通知の入力欄は数字のキーボードにできず、ふつうの文字のキーボードで打つことになる。
// 全角・「℃」付き・小数点の打ち忘れ（368）でも、体温として読めるものは読む。
// 範囲（30〜43℃）の確認は呼ぶ側がする。

/** 打ち込まれた文字を体温（0.1℃単位）にする。読めなければ null。 */
export function parseCelsiusText(text: string): number | null {
  let value = text
    .normalize('NFKC')
    .replace(/[,、。]/g, '.')
    .replace(/[\s°℃度cC]/g, '');
  // 小数点を打ち忘れた「368」は 36.8 として読む
  if (/^\d{3}$/.test(value)) value = `${value.slice(0, 2)}.${value.slice(2)}`;
  if (!/^\d{2}(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 10) / 10;
}
