// 保育園見学のチェックリスト定義。
// 「0歳児クラスに入れて復職する」前提。見学の場でしか分からないこと（部屋の様子・
// 先生の雰囲気）と、その場で聞かないと分からないこと（おむつ・布団・呼び出し）だけを
// 残している。料金や行事の回数のように資料を読めば分かることは項目にせず、
// 「資料をもらう」の1項目にまとめる。
// 園ごとの状態(チェック・メモ)は nurseries.checklist (jsonb) に項目IDをキーとして保存する。

import type { NurseryChecklist, NurseryCheckGrade } from '@/types/app';

/** 一部の園にだけ出す項目の対象条件。園名にkeywordsのどれかを含む園が対象。 */
export interface NurseryCheckTarget {
  /** 項目に添えるバッジの文言 */
  label: string;
  keywords: string[];
}

export interface NurseryCheckItem {
  id: string;
  /** 見学時に見る観点。「聞く」グループはそのまま使える質問文にしている。 */
  title: string;
  /** 実際に園へ聞く・確認すること */
  point: string;
  /** 対象を絞る項目だけが持つ。未指定なら全園共通。 */
  target?: NurseryCheckTarget;
  /** その場の印象をA/B/Cで残す項目。評価を選ぶとチェック済みになる。 */
  graded?: boolean;
}

export interface NurseryCheckGroup {
  id: string;
  title: string;
  /** グループ全体への補足 */
  note?: string;
  items: NurseryCheckItem[];
}

// 仏教主義（浄土真宗）の保育理念のため、宗教行事の頻度を確認する園。
const WAKO_ONLY: NurseryCheckTarget = { label: '和光のみ', keywords: ['和光'] };

// 見学当日の流れ（園内を見る → 最後に質問する → 資料を受け取る）に沿った順番で並べる。
export const NURSERY_CHECK_GROUPS: NurseryCheckGroup[] = [
  {
    id: 'see',
    title: '見る（園内を回りながら）',
    note: 'A（良い）・B（ふつう）・C（気になる）から選ぶ。選ぶとチェック済みになる。',
    items: [
      {
        id: 'ratio',
        graded: true,
        title: '0歳児クラスの保育士の人数と部屋の様子',
        point: '国基準はおおむね0歳児3人に保育士1人。実際の教室で人数を目視する。',
      },
      {
        id: 'staff',
        graded: true,
        title: '先生同士のやり取りと表情',
        point: '笑顔よりも、やり取りにトゲやピリピリ感がないかを見る。余裕のなさは安全性に直結する。',
      },
      {
        id: 'hygiene',
        graded: true,
        title: '衛生と整理整頓',
        point: 'おむつ用ゴミ箱まわりのにおい、0歳児がハイハイする床の清潔さ。掲示物が破れたままなら人手不足のサイン。',
      },
    ],
  },
  {
    id: 'ask',
    title: '聞く（資料には載っていないこと）',
    items: [
      {
        id: 'diaper',
        title: '「使用済みおむつは園で処分していただけますか？」',
        point: '【最重要】毎日の持ち帰りは衛生面・精神面で大きな負担になる。',
      },
      {
        id: 'belongings',
        title: '「週末に持ち帰る荷物は、お昼寝布団など何がありますか？」',
        point: '重い布団の持ち帰り負担を確認。コット（簡易ベッド）やリース布団が使えると負担が激減する。',
      },
      {
        id: 'fever',
        title: '「お熱が出た場合、何度でお迎えの連絡が来ますか？」',
        point: '37.5度で即呼び出しか、機嫌や平熱も見てくれるか。解熱後の登園条件も一緒に。',
      },
      {
        id: 'narashi',
        title: '「慣らし保育の標準期間はどのくらいですか？」',
        point: '職場復帰スケジュールに直結するため、入園前に必ず確認しておく。',
      },
      {
        id: 'meal',
        title: '「ミルクは持参と園で用意のどちらですか？アレルギー対応の柔軟性は？」',
        point: '混合栄養（母乳＋ミルク）前提のため、対応の可否と柔軟さを確認する。',
      },
      {
        id: 'religion',
        title: '「法話などの宗教行事は、どの程度の頻度で、参加は必須ですか？」',
        point: '仏教主義（浄土真宗）の保育理念のため、家庭の価値観との適合を事前に確認する。',
        target: WAKO_ONLY,
      },
    ],
  },
  {
    id: 'get',
    title: 'もらう（あとで読めばいいこと）',
    note: '紙の資料がなければ、園の許可を得てスマホで撮影させてもらう。',
    items: [
      {
        id: 'documents',
        title: '入園のしおり一式をもらう',
        point: '持ち物リスト・年間行事予定表・一日のスケジュール・延長保育の料金表。平日行事の多さや延長の単価はここで読めば分かるので、見学の場では聞かない。',
      },
    ],
  },
];

/** A/B/Cの表示順と意味。ボタンの並びもこの順にする。 */
export const NURSERY_CHECK_GRADES: { id: NurseryCheckGrade; label: string }[] = [
  { id: 'A', label: '良い' },
  { id: 'B', label: 'ふつう' },
  { id: 'C', label: '気になる' },
];

const ALL_CHECK_ITEMS: NurseryCheckItem[] = NURSERY_CHECK_GROUPS.flatMap((g) => g.items);

/** その園でこの項目を確認するか。対象を絞っていない項目は全園で確認する。 */
export const isCheckItemFor = (item: NurseryCheckItem, nurseryName: string): boolean =>
  !item.target || item.target.keywords.some((keyword) => nurseryName.includes(keyword));

/** その園で確認する項目だけに絞ったグループ。項目が残らないグループは省く。 */
export const checkGroupsFor = (nurseryName: string): NurseryCheckGroup[] =>
  NURSERY_CHECK_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isCheckItemFor(item, nurseryName)),
  })).filter((group) => group.items.length > 0);

/** その園で確認する項目。並び順がそのまま見学当日の流れになる。 */
export const checkItemsFor = (nurseryName: string): NurseryCheckItem[] =>
  ALL_CHECK_ITEMS.filter((item) => isCheckItemFor(item, nurseryName));

/** その園の項目数。その園にだけ聞くこと（宗教行事など）がある分だけ増える。 */
export const checkTotalFor = (nurseryName: string): number => checkItemsFor(nurseryName).length;

/** 聞く順番（1始まり）。園ごとに項目が変わるので、その園の並びの中での番号を返す。 */
export const checkItemNumber = (itemId: string, nurseryName: string): number =>
  checkItemsFor(nurseryName).findIndex((item) => item.id === itemId) + 1;

/** チェック済みの項目数。定義から消えた項目やその園の対象外の項目は数えない。 */
export const countChecked = (checklist: NurseryChecklist, nurseryName: string): number =>
  checkItemsFor(nurseryName).filter((item) => checklist[item.id]?.checked).length;
