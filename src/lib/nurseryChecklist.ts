// 保育園見学のチェックリスト定義。
// 「0歳児クラスに入れて復職する」前提で、見学当日の動き（防災→見る→聞く→もらう）に
// 沿って並べている。項目は全園一律ではなく、園ごとの事情（浸水想定区域か、宗教行事が
// あるか）に当てはまる園にだけ出す項目がある。
// 園ごとの状態(チェック・メモ)は nurseries.checklist (jsonb) に項目IDをキーとして保存する。

import type { NurseryChecklist } from '@/types/app';

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
}

export interface NurseryCheckGroup {
  id: string;
  title: string;
  /** グループ全体への補足 */
  note?: string;
  items: NurseryCheckItem[];
}

// 浸水想定区域にかかる園。園そのものと通園ルートの両方を見る必要がある。
const FLOOD_RISK: NurseryCheckTarget = { label: 'くすのき・和光', keywords: ['くすのき', '和光'] };
// 仏教主義（浄土真宗）の保育理念のため、宗教行事の頻度を確認する園。
const WAKO_ONLY: NurseryCheckTarget = { label: '和光のみ', keywords: ['和光'] };

// 見学当日の流れに沿った順番で並べる。防災は聞き逃すと取り返しがつかないので先頭。
export const NURSERY_CHECK_GROUPS: NurseryCheckGroup[] = [
  {
    id: 'disaster',
    title: '防災（見学時の最優先事項）',
    note: '浸水想定区域にかかる園で必ず聞く。他の園でも参考として聞いておくとよい。',
    items: [
      {
        id: 'flood-closure',
        title: '「大雨・洪水警報が出たとき、どの段階で休園になりますか？」',
        point: '何段階目の警戒レベルで休園かを具体的に。くすのき(洪水2〜3m・高潮0.5〜1m)、和光(洪水0.5〜1m)。',
        target: FLOOD_RISK,
      },
      {
        id: 'flood-drill',
        title: '浸水を想定した避難訓練を実施しているか',
        point: '年間の回数と、浸水想定を含む内容か。バルコニー等への垂直避難が訓練済みか想定のみかで実効性が変わる。',
        target: FLOOD_RISK,
      },
      {
        id: 'flood-space',
        title: '避難スペースに0歳児クラスの人数が収まるか',
        point: '避難バルコニー等の広さを目視。0歳児は自力で歩けないので、抱える・おんぶする保育士の人数も確認。',
        target: FLOOD_RISK,
      },
      {
        id: 'flood-route',
        title: '通園ルート沿いに冠水しやすい道路・橋はないか',
        point: '園だけでなく「たどり着く道」の弱点も見る。大雨時に迂回が必要になる箇所を把握しておく。',
        target: FLOOD_RISK,
      },
    ],
  },
  {
    id: 'see',
    title: '見るポイント（目で確認）',
    items: [
      {
        id: 'staff',
        title: '保育士の表情とコミュニケーション',
        point: '笑顔よりも、先生同士のやり取りにトゲやピリピリ感がないかを最重視。余裕のなさは安全性に直結する。',
      },
      {
        id: 'parking',
        title: '駐車場と朝の動線',
        point: '停めやすさと台数を、雨の日の朝ラッシュ前提で見る。ベビーカー置き場や荷物セットのスペースも。',
      },
      {
        id: 'hygiene',
        title: '衛生管理と整理整頓',
        point: 'おむつ用ゴミ箱まわりのにおい、0歳児がハイハイする床の清潔さ。掲示物が破れたままなら人手不足のサイン。',
      },
      {
        id: 'ratio',
        title: '0歳児クラスの保育士の配置人数',
        point: '国基準はおおむね0歳児3人に保育士1人。実際の教室で人数を目視して確認する。',
      },
    ],
  },
  {
    id: 'ask',
    title: '聞くポイント（そのまま使える質問）',
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
        id: 'parking-peak',
        title: '「朝の送迎時、駐車場が一番混み合うのは何時頃ですか？」',
        point: '毎日の通勤前のタイムロスをリアルに想定するための質問。',
      },
      {
        id: 'fever',
        title: '「お熱が出た場合、何度でお迎えの連絡が来ますか？」',
        point: '37.5度で即呼び出しなのか、少し様子を見てくれるのか。園のスタンスを確認する。',
      },
      {
        id: 'parents',
        title: '「保護者が参加する平日の行事は、年間でどのくらいありますか？」',
        point: '親の有給消化に直結する。共働きへの配慮があるかの判断材料になる。',
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
    title: 'もらう・記録するポイント',
    note: '紙の資料がない場合や手作り指定のバッグ等は、園の許可を得てスマホで撮影させてもらうのが確実。',
    items: [
      {
        id: 'items-list',
        title: '入園時の「持ち物リスト」',
        point: '食事用エプロンや毎日のタオルの枚数、服装の細かいルール（フード禁止等）。日々の洗濯・準備の負担に直結する。',
      },
      {
        id: 'brochure',
        title: '入園のしおり・パンフレット／年間行事予定表／一日のスケジュール表',
        point: '園の基本ルール、平日行事の多さ、お弁当の頻度、休日の生活リズムの参考に。',
      },
      {
        id: 'extended-fee',
        title: '延長保育の実費単価一覧',
        point: '30分あたりの単価は園ごとに違う（例: 18:00〜18:30は200円、18:30〜19:00は100円）。横並びで比べられるよう書面でもらう。',
      },
      {
        id: 'tenure',
        title: '職員の平均勤続年数・離職率',
        point: '口頭では数字が出ないことがあるため、資料に記載があれば入手する。保育の質・定着率の代理指標として有効。',
      },
    ],
  },
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

/** その園の項目数。園ごとに違う（浸水想定区域・宗教行事の有無で増える）。 */
export const checkTotalFor = (nurseryName: string): number => checkItemsFor(nurseryName).length;

/** 聞く順番（1始まり）。園ごとに項目が変わるので、その園の並びの中での番号を返す。 */
export const checkItemNumber = (itemId: string, nurseryName: string): number =>
  checkItemsFor(nurseryName).findIndex((item) => item.id === itemId) + 1;

/** チェック済みの項目数。定義から消えた項目やその園の対象外の項目は数えない。 */
export const countChecked = (checklist: NurseryChecklist, nurseryName: string): number =>
  checkItemsFor(nurseryName).filter((item) => checklist[item.id]?.checked).length;
