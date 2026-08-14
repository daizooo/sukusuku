import type {
  CareLog,
  DocumentItem,
  Gift,
  GrowthRecord,
  Nursery,
  Task,
  UserProfile,
} from '@/types/app';

// --- 初期ダミーデータ ---
// Supabase連携までの間、画面確認用に使用するプレースホルダー。
// 実データ移行後（Step 4後半）はここを撤去し、Supabaseからの取得に置き換える。

// 家族の新規作成時にSupabaseへ登録する定番ToDoのテンプレート（idはDB側で採番するため持たない）
// いずれも出生日を起点に日付が決まるため anchorType は 'birth_relative'。
type TaskTemplate = Omit<Task, 'id'>;

const birthRelative = (
  t: Omit<Task, 'id' | 'anchorType' | 'startDate' | 'startTime' | 'endTime'>,
): TaskTemplate => ({
  ...t,
  anchorType: 'birth_relative',
  startDate: null,
  startTime: null,
  endTime: null,
});

export const INITIAL_TODOS: TaskTemplate[] = [
  birthRelative({ category: '手続き', title: '出生届・マイナンバー提出', place: '城南まちづくりセンター', timing: '出生後すぐ', daysAfterBirth: 0, done: false, note: '戸籍謄本いつできるか聞く', belongings: '母子手帳、届出書、印鑑', label: 'パパ', remindMinutesBefore: 1440 }),
  birthRelative({ category: '手続き', title: '児童手当申請', place: 'マイナポータル', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '', belongings: 'キャッシュカード写し', label: 'パパ', remindMinutesBefore: null }),
  birthRelative({ category: '手続き', title: '出生報告 (夫会社)', place: 'メール', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '', belongings: '', label: 'パパ', remindMinutesBefore: null }),
  birthRelative({ category: '手続き', title: '名前報告 (妻会社)', place: '電話', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '', belongings: '母子手帳の出生届出済証明ページ', label: 'ママ', remindMinutesBefore: null }),
  birthRelative({ category: '手続き', title: '出産手当金・育休申請', place: '郵送', timing: '退院したら', daysAfterBirth: 5, done: false, note: '病院記入あり', belongings: '申請書、同意書', label: 'ママ', remindMinutesBefore: 1440 }),
  birthRelative({ category: '手続き', title: '妻の扶養申請', place: '郵送', timing: '戸籍ができたら', daysAfterBirth: 10, done: false, note: '', belongings: '住民票(全員)、夫給与明細(直近3ヶ月)、戸籍謄本', label: 'パパ', remindMinutesBefore: null }),
  birthRelative({ category: '手続き', title: '保育園見学・相談', place: '各保育園', timing: '生後1ヶ月〜', daysAfterBirth: 30, done: false, note: '', belongings: '', label: '家族', remindMinutesBefore: null }),
];

export const INITIAL_EVENTS: TaskTemplate[] = [
  birthRelative({ category: '健診', title: '産婦検診 (母体)', place: 'まつばせレディースクリニック', timing: '出生後2週間', daysAfterBirth: 14, done: false, note: '', belongings: '母子手帳', label: 'ママ', remindMinutesBefore: 1440 }),
  birthRelative({ category: '健診', title: '1ヶ月検診 (母体・赤ちゃん)', place: 'まつばせL.C / 北野小児科', timing: '出生1ヶ月', daysAfterBirth: 30, done: false, note: '', belongings: '母子手帳、乳幼児健診番号', label: '家族', remindMinutesBefore: 1440 }),
  birthRelative({ category: 'イベント', title: 'お宮参り', place: '-', timing: '1ヶ月〜', daysAfterBirth: 35, done: false, note: '', belongings: '', label: '家族', remindMinutesBefore: null }),
  birthRelative({ category: '健診', title: '予防接種①', place: '北野小児科', timing: '生後2ヶ月', daysAfterBirth: 60, done: false, note: '五種混合, 肺炎球菌, B型肝炎, ロタ', belongings: '母子手帳、予防接種番号', label: '家族', remindMinutesBefore: 1440 }),
];

export const createInitialLogs = (): CareLog[] => [
  { id: 1, type: 'milk', label: 'ミルク', amount: '100ml', time: new Date(new Date().setHours(8, 30, 0, 0)), note: 'よく飲んだ', user: 'パパ' },
  { id: 2, type: 'diaper', label: 'うんち', amount: '', time: new Date(new Date().setHours(10, 15, 0, 0)), note: '色・硬さ普通', user: 'ママ' },
  { id: 3, type: 'sleep', label: '睡眠', amount: '2時間', time: new Date(new Date().setHours(11, 0, 0, 0)), note: 'お昼寝', user: 'ママ' },
];

export const INITIAL_GIFTS: Gift[] = [
  { id: 1, from: '祖父母(夫)', item: 'お祝い金 10万円', date: '2026-08-15', returnStatus: '不要', returnItem: '-', note: 'ベビーベッド購入費用として' },
  { id: 2, from: '友人A', item: 'ベビー服(80サイズ)', date: '2026-09-01', returnStatus: '未完了', returnItem: 'カタログギフト3000円', note: '住所確認済' },
];

export const INITIAL_GROWTH_DATA: GrowthRecord[] = [
  { month: 0, height: 50.0, weight: 3.0 },
  { month: 1, height: 54.5, weight: 4.2 },
  { month: 2, height: 58.1, weight: 5.5 },
  { month: 3, height: 61.4, weight: 6.4 },
];

export const INITIAL_DOCUMENTS: DocumentItem[] = [
  { id: 1, title: '予防接種スケジュール表', date: '2026-08-20', type: 'image' },
  { id: 2, title: '出産手当金 申請控え', date: '2026-08-25', type: 'image' },
];

export const INITIAL_NURSERIES: Nursery[] = [
  { id: 1, name: '舞原保育園', distance: '車5分', status: '見学済', memo: '園庭が広く、のびのびしている。オムツのサブスクあり。', phone: '0964-28-2121' },
  { id: 2, name: 'くすのき保育園', distance: '車10分', status: '見学予約済', memo: '9/15 10:00 見学予定。妻の職場に近い。', phone: '0964-28-6163' },
  { id: 3, name: '和光保育園', distance: '徒歩15分', status: '未見学', memo: '近くて便利。見学の電話をする。', phone: '0964-28-4993' },
];

export const INITIAL_PROFILE: UserProfile = {
  babyName: '',
  birthDate: '',
  momName: '',
  momWorkplace: '',
  dadName: '',
  dadWorkplace: '',
  address: '',
};
