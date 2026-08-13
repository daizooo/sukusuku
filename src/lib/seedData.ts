import type { Task, UserProfile } from '@/types/app';

// 家族の新規作成時にSupabaseへ登録する定番ToDoのテンプレート（idはDB側で採番するため持たない）
// スケジュール(tasks)のみ、初回セットアップ時の定番項目としてこのテンプレートを使用する。
// それ以外のデータ(育児記録・お祝い・成長記録・書類・保活メモ)はSupabaseから取得する実データのみを扱う。
type TaskTemplate = Omit<Task, 'id'>;

export const INITIAL_TODOS: TaskTemplate[] = [
  { category: '手続き', title: '出生届・マイナンバー提出', place: '城南まちづくりセンター', timing: '出生後すぐ', daysAfterBirth: 0, done: false, note: '戸籍謄本いつできるか聞く', belongings: '母子手帳、届出書、印鑑', assignee: 'パパ', notification: true },
  { category: '手続き', title: '児童手当申請', place: 'マイナポータル', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '', belongings: 'キャッシュカード写し', assignee: 'パパ', notification: false },
  { category: '手続き', title: '出生報告 (夫会社)', place: 'メール', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '', belongings: '', assignee: 'パパ', notification: false },
  { category: '手続き', title: '名前報告 (妻会社)', place: '電話', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '', belongings: '母子手帳の出生届出済証明ページ', assignee: 'ママ', notification: false },
  { category: '手続き', title: '出産手当金・育休申請', place: '郵送', timing: '退院したら', daysAfterBirth: 5, done: false, note: '病院記入あり', belongings: '申請書、同意書', assignee: 'ママ', notification: true },
  { category: '手続き', title: '妻の扶養申請', place: '郵送', timing: '戸籍ができたら', daysAfterBirth: 10, done: false, note: '', belongings: '住民票(全員)、夫給与明細(直近3ヶ月)、戸籍謄本', assignee: 'パパ', notification: false },
  { category: '手続き', title: '保育園見学・相談', place: '各保育園', timing: '生後1ヶ月〜', daysAfterBirth: 30, done: false, note: '', belongings: '', assignee: '二人で', notification: false },
];

export const INITIAL_EVENTS: TaskTemplate[] = [
  { category: '健診', title: '産婦検診 (母体)', place: 'まつばせレディースクリニック', timing: '出生後2週間', daysAfterBirth: 14, done: false, note: '', belongings: '母子手帳', assignee: 'ママ', notification: true },
  { category: '健診', title: '1ヶ月検診 (母体・赤ちゃん)', place: 'まつばせL.C / 北野小児科', timing: '出生1ヶ月', daysAfterBirth: 30, done: false, note: '', belongings: '母子手帳、乳幼児健診番号', assignee: '二人で', notification: true },
  { category: 'イベント', title: 'お宮参り', place: '-', timing: '1ヶ月〜', daysAfterBirth: 35, done: false, note: '', belongings: '', assignee: '二人で', notification: false },
  { category: '健診', title: '予防接種①', place: '北野小児科', timing: '生後2ヶ月', daysAfterBirth: 60, done: false, note: '五種混合, 肺炎球菌, B型肝炎, ロタ', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
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
