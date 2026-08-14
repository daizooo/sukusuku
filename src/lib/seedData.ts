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
  { category: '手続き', title: '夫の勤務先へマイナンバー提出', place: 'WEB', timing: 'マイナンバーが届いたら', daysAfterBirth: 20, done: false, note: '', belongings: 'マイナンバー(夫)', assignee: 'パパ', notification: false },
  { category: '手続き', title: 'マイナンバーと健康保険証の紐づけ', place: 'マイナポータル', timing: '健康保険証が届いたら', daysAfterBirth: 25, done: false, note: '', belongings: 'マイナンバー(夫)、健康保険証', assignee: '二人で', notification: false },
  { category: '手続き', title: 'ひまわりカード申請', place: 'WEB', timing: '健康保険証が届いたら', daysAfterBirth: 25, done: false, note: '', belongings: '健康保険証', assignee: '二人で', notification: false },
  { category: '手続き', title: '保育園申請案内の確認', place: '郵送', timing: '9月〜', daysAfterBirth: 30, done: false, note: '就労証明書の依頼をする', belongings: '', assignee: '二人で', notification: true },
  { category: '手続き', title: '保育園入園申請', place: 'WEB', timing: '10月〜', daysAfterBirth: 70, done: false, note: '', belongings: '就労証明書ほか', assignee: '二人で', notification: true },
];

export const INITIAL_EVENTS: TaskTemplate[] = [
  { category: '健診', title: '産婦検診 (母体)', place: 'まつばせレディースクリニック', timing: '出生後2週間', daysAfterBirth: 14, done: false, note: '', belongings: '母子手帳', assignee: 'ママ', notification: true },
  { category: '健診', title: '1ヶ月検診 (母体・赤ちゃん)', place: 'まつばせL.C / 北野小児科', timing: '出生1ヶ月', daysAfterBirth: 30, done: false, note: '', belongings: '母子手帳、乳幼児健診番号', assignee: '二人で', notification: true },
  { category: 'イベント', title: 'お宮参り', place: '-', timing: '1ヶ月〜', daysAfterBirth: 35, done: false, note: '', belongings: '', assignee: '二人で', notification: false },
  { category: '健診', title: '予防接種①', place: '北野小児科', timing: '生後2ヶ月', daysAfterBirth: 60, done: false, note: '五種混合, 肺炎球菌, B型肝炎, ロタ', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種予約', place: '北野小児科', timing: '1ヶ月健診が終わったら', daysAfterBirth: 30, done: false, note: 'RSワクチン接種済を伝える', belongings: '母子手帳', assignee: '二人で', notification: true },
  { category: '健診', title: '3ヶ月健診', place: '北野小児科', timing: '生後3ヶ月', daysAfterBirth: 90, done: false, note: '', belongings: '母子手帳', assignee: '未定', notification: true },
  { category: 'イベント', title: 'お食い初め', place: '-', timing: '生後100日', daysAfterBirth: 100, done: false, note: '', belongings: '', assignee: '二人で', notification: false },
  { category: '健診', title: '予防接種②', place: '北野小児科', timing: '生後3ヶ月〜4ヶ月になる前日', daysAfterBirth: 119, done: false, note: '五種混合②, 小児用肺炎球菌②, B型肝炎②, ロタウイルス②', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種③', place: '北野小児科', timing: '生後4ヶ月', daysAfterBirth: 120, done: false, note: '五種混合③, 小児用肺炎球菌③, ロタウイルス③(ワクチン次第)', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: 'インフルエンザ予防接種', place: '北野小児科', timing: '生後6ヶ月〜', daysAfterBirth: 180, done: false, note: '流行次第で任意', belongings: '母子手帳', assignee: '未定', notification: false },
  { category: '健診', title: '7ヶ月健診', place: '北野小児科', timing: '生後7ヶ月〜8ヶ月', daysAfterBirth: 210, done: false, note: '', belongings: '母子手帳', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種④', place: '北野小児科', timing: '生後7ヶ月〜8ヶ月', daysAfterBirth: 210, done: false, note: 'BCG, B型肝炎③', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種(1歳)', place: '北野小児科', timing: '1歳', daysAfterBirth: 365, done: false, note: 'MR(麻しん風しん), 水痘(水ぼうそう), 小児用肺炎球菌④, 五種混合④, おたふくかぜ(任意だが必須)', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種(1歳6ヶ月)', place: '北野小児科', timing: '1歳6ヶ月', daysAfterBirth: 545, done: false, note: '水痘(水ぼうそう)②', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種(3歳)①', place: '', timing: '3歳', daysAfterBirth: 1095, done: false, note: '日本脳炎①', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種(3歳)②', place: '', timing: '3歳', daysAfterBirth: 1125, done: false, note: '日本脳炎②', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種(4歳)', place: '', timing: '4歳', daysAfterBirth: 1460, done: false, note: '日本脳炎③', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種(就学前)', place: '', timing: '小学校入学前の1年間', daysAfterBirth: 2190, done: false, note: 'MR(麻しん風しん)②, おたふくかぜ②', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種(9歳)', place: '', timing: '9歳', daysAfterBirth: 3285, done: false, note: '日本脳炎④', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
  { category: '健診', title: '予防接種(11歳)', place: '', timing: '11歳', daysAfterBirth: 4015, done: false, note: '2種混合', belongings: '母子手帳、予防接種番号', assignee: '未定', notification: true },
];

export const INITIAL_PROFILE: UserProfile = {
  babyName: '',
  birthDate: '',
  momName: '',
  momWorkplace: '',
  dadName: '',
  dadWorkplace: '',
  address: '',
  hospitalName: '福田病院',
  hospitalPhone: '096-322-2995',
  pediatricName: '北野小児科',
  pediatricPhone: '096-352-8990',
  papaCompanyPhone: '096-368-4222',
  papaContactPhone: '080-2742-0550',
  mamaCompanyPhone: '',
  mamaContactPhone: '090-9575-3278',
  customFields: [],
};
