// 保育園見学のチェックリスト定義。
// 「0歳児クラスに入れて復職する」前提で、入園後の生活に直結する10項目に絞っている。
// 項目は全園共通なのでここに定義だけを置き、園ごとの状態(チェック・メモ)は
// nurseries.checklist (jsonb) に項目IDをキーとして保存する。

import type { NurseryChecklist } from '@/types/app';

export interface NurseryCheckItem {
  id: string;
  /** 見学時に見る観点 */
  title: string;
  /** 実際に園へ聞く・確認すること */
  point: string;
}

export interface NurseryCheckGroup {
  id: string;
  title: string;
  items: NurseryCheckItem[];
}

// 見学当日の流れ（到着 → 園内を回る → 最後の質問タイム）に沿った順番で並べる。
// その場で目に入るものから先に確認し、園長・主任に時間をもらって聞くことは最後にまとめる。
export const NURSERY_CHECK_GROUPS: NurseryCheckGroup[] = [
  {
    id: 'arrival',
    title: '到着〜玄関で',
    items: [
      {
        id: 'parking',
        title: 'ベビーカー・抱っこ紐・自転車の置き場',
        point: '置いたまま通勤できるか。雨の日に困らないか。',
      },
      {
        id: 'belongings',
        title: '荷物の持ち込みとセット作業',
        point: '荷物は玄関で預かってもらえるか。布団は持参かレンタル（コット）か。',
      },
    ],
  },
  {
    id: 'tour',
    title: '園内を見ながら（0歳児クラス）',
    items: [
      {
        id: 'sids',
        title: '睡眠中（SIDS対策）の見守り',
        point: 'センサー任せになっていないか。5分おきの目視・触診まで徹底しているか。',
      },
      {
        id: 'diaper',
        title: 'おむつのサブスク・持ち帰り',
        point: '1枚ずつ記名が必要か。使用済みおむつは園で捨てられるか、サブスクはあるか。',
      },
      {
        id: 'meal',
        title: '離乳食・アレルギー・ミルクの柔軟さ',
        point: 'ミルクの銘柄指定や冷凍母乳の可否。未導入食材のルールが厳しすぎないか。',
      },
      {
        id: 'staff',
        title: '先生の勤続年数と雰囲気',
        point: '先生同士が笑顔で話しているか。ベテランと若手のバランス、離職の多さ。',
      },
    ],
  },
  {
    id: 'questions',
    title: '最後の質問タイムで',
    items: [
      {
        id: 'fever',
        title: '37.5度の呼び出し・解熱後のルール',
        point: '呼び出しは機嫌や平熱も見てくれるか。解熱後24時間は登園不可などの条件があるか。',
      },
      {
        id: 'contact',
        title: '連絡帳の形式と写真配信',
        point: '連絡アプリ（コドモン等）か手書きか。日中の写真を送ってもらえるか。',
      },
      {
        id: 'parents',
        title: '保護者会・平日行事の多さ',
        point: '平日行事や保護者会の頻度。オンライン参加や土日開催があるか。',
      },
      {
        id: 'director',
        title: '園長・主任の保護者への姿勢',
        point: '質問に対して、良い面だけでなく園の弱点やリスクも話してくれるか。',
      },
    ],
  },
];

export const NURSERY_CHECK_ITEMS: NurseryCheckItem[] = NURSERY_CHECK_GROUPS.flatMap((g) => g.items);

export const NURSERY_CHECK_TOTAL = NURSERY_CHECK_ITEMS.length;

/** 聞く順番（1始まり）。定義の並び順がそのまま当日の流れになる。 */
export const checkItemNumber = (itemId: string): number =>
  NURSERY_CHECK_ITEMS.findIndex((item) => item.id === itemId) + 1;

/** チェック済みの項目数。定義から消えた項目IDが残っていても数えない。 */
export const countChecked = (checklist: NurseryChecklist): number =>
  NURSERY_CHECK_ITEMS.filter((item) => checklist[item.id]?.checked).length;
