import type { NurseryInput } from '@/lib/api/nurseries';
import type { Task, UserProfile } from '@/types/app';

// 家族の新規作成時にSupabaseへ登録する定番項目のテンプレート（idはDB側で採番するため持たない）
// スケジュール(tasks)と保活メモ(nurseries)のみ、初回セットアップ時の定番項目としてこのテンプレートを使用する。
// それ以外のデータ(育児記録・お祝い・成長記録・書類)はSupabaseから取得する実データのみを扱う。
// ToDo・イベントはいずれも出生日を起点に時期が決まるため anchorType は 'birth_relative'。
type TaskTemplate = Omit<Task, 'id'>;
// 主体(owner)は下のasTasks/asEventsで参加者から自動的に決めるため、
// 定番項目そのものには持たせない。
type TaskTemplateBase = Omit<TaskTemplate, 'kind' | 'owner'>;

const birthRelative = (
  t: Omit<
    TaskTemplateBase,
    'anchorType' | 'startDate' | 'startTime' | 'endTime' | 'isPrivate' | 'recurrence'
  >,
): TaskTemplateBase => ({
  ...t,
  anchorType: 'birth_relative',
  startDate: null,
  startTime: null,
  endTime: null,
  // 定番の項目は家族全員で共有するものなので、共有設定(自分だけ)にはしない。
  isPrivate: false,
  // 定番の項目に繰り返しは無い。
  recurrence: null,
});

// 参加者がちょうど1人のときだけ、その人を主体(owner)とみなす
// （定番項目は基本1人だけが担当のため、これで大半が埋まる）。
const ownerFromParticipants = (participants: TaskTemplateBase['participants']) =>
  participants.length === 1 ? participants[0] : null;

// 手続き系はタスク、健診・行事系は予定として登録する。
const asTasks = (list: TaskTemplateBase[]): TaskTemplate[] =>
  list.map((t) => ({ ...t, kind: 'task', owner: ownerFromParticipants(t.participants) }));
const asEvents = (list: TaskTemplateBase[]): TaskTemplate[] =>
  list.map((t) => ({ ...t, kind: 'event', owner: ownerFromParticipants(t.participants) }));

export const INITIAL_TODOS: TaskTemplate[] = asTasks([
  birthRelative({ title: '出生届・マイナンバー提出', place: '城南まちづくりセンター', timing: '出生後すぐ', daysAfterBirth: 0, done: false, note: '戸籍謄本いつできるか聞く\n持ち物: 母子手帳、届出書、印鑑', participants: ['大造'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '児童手当申請', place: 'マイナポータル', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '持ち物: キャッシュカード写し', participants: ['大造'], remindMinutesBefore: null }),
  birthRelative({ title: '出生報告 (夫会社)', place: 'メール', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '', participants: ['大造'], remindMinutesBefore: null }),
  birthRelative({ title: '名前報告 (妻会社)', place: '電話', timing: '出生後2週間以内', daysAfterBirth: 14, done: false, note: '持ち物: 母子手帳の出生届出済証明ページ', participants: ['いづみ'], remindMinutesBefore: null }),
  birthRelative({ title: '出産手当金・育休申請', place: '郵送', timing: '退院したら', daysAfterBirth: 5, done: false, note: '病院記入あり\n持ち物: 申請書、同意書', participants: ['いづみ'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '妻の扶養申請', place: '郵送', timing: '戸籍ができたら', daysAfterBirth: 10, done: false, note: '持ち物: 住民票(全員)、夫給与明細(直近3ヶ月)、戸籍謄本', participants: ['大造'], remindMinutesBefore: null }),
  birthRelative({ title: '保育園見学・相談', place: '各保育園', timing: '生後1ヶ月〜', daysAfterBirth: 30, done: false, note: '', participants: ['岳'], remindMinutesBefore: null }),
  birthRelative({ title: '夫の勤務先へマイナンバー提出', place: 'WEB', timing: 'マイナンバーが届いたら', daysAfterBirth: 20, done: false, note: '持ち物: マイナンバー(夫)', participants: ['大造'], remindMinutesBefore: null }),
  birthRelative({ title: 'マイナンバーと健康保険証の紐づけ', place: 'マイナポータル', timing: '健康保険証が届いたら', daysAfterBirth: 25, done: false, note: '持ち物: マイナンバー(夫)、健康保険証', participants: ['岳'], remindMinutesBefore: null }),
  birthRelative({ title: 'ひまわりカード申請', place: 'WEB', timing: '健康保険証が届いたら', daysAfterBirth: 25, done: false, note: '持ち物: 健康保険証', participants: ['岳'], remindMinutesBefore: null }),
  birthRelative({ title: '保育園申請案内の確認', place: '郵送', timing: '9月〜', daysAfterBirth: 30, done: false, note: '就労証明書の依頼をする', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '保育園入園申請', place: 'WEB', timing: '10月〜', daysAfterBirth: 70, done: false, note: '持ち物: 就労証明書ほか', participants: ['岳'], remindMinutesBefore: 1440 }),
]);

export const INITIAL_EVENTS: TaskTemplate[] = asEvents([
  birthRelative({ title: '産婦検診 (母体)', place: 'まつばせレディースクリニック', timing: '出生後2週間', daysAfterBirth: 14, done: false, note: '持ち物: 母子手帳', participants: ['いづみ'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '1ヶ月検診 (母体・赤ちゃん)', place: 'まつばせL.C / 北野小児科', timing: '出生1ヶ月', daysAfterBirth: 30, done: false, note: '持ち物: 母子手帳、乳幼児健診番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: 'お宮参り', place: '-', timing: '1ヶ月〜', daysAfterBirth: 35, done: false, note: '', participants: ['岳'], remindMinutesBefore: null }),
  birthRelative({ title: '予防接種①', place: '北野小児科', timing: '生後2ヶ月', daysAfterBirth: 60, done: false, note: '五種混合, 肺炎球菌, B型肝炎, ロタ\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種予約', place: '北野小児科', timing: '1ヶ月健診が終わったら', daysAfterBirth: 30, done: false, note: 'RSワクチン接種済を伝える\n持ち物: 母子手帳', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '3ヶ月健診', place: '北野小児科', timing: '生後3ヶ月', daysAfterBirth: 90, done: false, note: '持ち物: 母子手帳', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: 'お食い初め', place: '-', timing: '生後100日', daysAfterBirth: 100, done: false, note: '', participants: ['岳'], remindMinutesBefore: null }),
  birthRelative({ title: '予防接種②', place: '北野小児科', timing: '生後3ヶ月〜4ヶ月になる前日', daysAfterBirth: 119, done: false, note: '五種混合②, 小児用肺炎球菌②, B型肝炎②, ロタウイルス②\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種③', place: '北野小児科', timing: '生後4ヶ月', daysAfterBirth: 120, done: false, note: '五種混合③, 小児用肺炎球菌③, ロタウイルス③(ワクチン次第)\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: 'インフルエンザ予防接種', place: '北野小児科', timing: '生後6ヶ月〜', daysAfterBirth: 180, done: false, note: '流行次第で任意\n持ち物: 母子手帳', participants: ['岳'], remindMinutesBefore: null }),
  birthRelative({ title: '7ヶ月健診', place: '北野小児科', timing: '生後7ヶ月〜8ヶ月', daysAfterBirth: 210, done: false, note: '持ち物: 母子手帳', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種④', place: '北野小児科', timing: '生後7ヶ月〜8ヶ月', daysAfterBirth: 210, done: false, note: 'BCG, B型肝炎③\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種(1歳)', place: '北野小児科', timing: '1歳', daysAfterBirth: 365, done: false, note: 'MR(麻しん風しん), 水痘(水ぼうそう), 小児用肺炎球菌④, 五種混合④, おたふくかぜ(任意だが必須)\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種(1歳6ヶ月)', place: '北野小児科', timing: '1歳6ヶ月', daysAfterBirth: 545, done: false, note: '水痘(水ぼうそう)②\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種(3歳)①', place: '', timing: '3歳', daysAfterBirth: 1095, done: false, note: '日本脳炎①\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種(3歳)②', place: '', timing: '3歳', daysAfterBirth: 1125, done: false, note: '日本脳炎②\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種(4歳)', place: '', timing: '4歳', daysAfterBirth: 1460, done: false, note: '日本脳炎③\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種(就学前)', place: '', timing: '小学校入学前の1年間', daysAfterBirth: 2190, done: false, note: 'MR(麻しん風しん)②, おたふくかぜ②\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種(9歳)', place: '', timing: '9歳', daysAfterBirth: 3285, done: false, note: '日本脳炎④\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
  birthRelative({ title: '予防接種(11歳)', place: '', timing: '11歳', daysAfterBirth: 4015, done: false, note: '2種混合\n持ち物: 母子手帳、予防接種番号', participants: ['岳'], remindMinutesBefore: 1440 }),
]);

// 見学候補の保育園。熊本市南区（城南町）の3園を初期登録する。
// 住所・電話番号は公開情報をもとにした初期値なので、電話をかける前に園のサイト等で確認する。
export const INITIAL_NURSERIES: NurseryInput[] = [
  {
    name: '舞原保育園',
    address: '熊本市南区城南町舞原291-7',
    status: '未見学',
    phone: '0964-28-2121',
    visitDate: null,
    visitTime: null,
    memo: '',
    checklist: {},
  },
  {
    name: 'くすのき保育園',
    address: '熊本市南区城南町六田475-2',
    status: '未見学',
    phone: '0964-28-6163',
    visitDate: null,
    visitTime: null,
    memo: '',
    checklist: {},
  },
  {
    name: '和光こども園',
    address: '熊本市南区城南町隈庄736',
    status: '未見学',
    phone: '0964-28-4993',
    visitDate: null,
    visitTime: null,
    memo: '',
    checklist: {},
  },
];

export const INITIAL_PROFILE: UserProfile = {
  childFields: [
    { id: 'baby-name', label: 'お名前', values: [''], key: 'babyName' },
    { id: 'birth-date', label: 'お誕生日', values: [''], key: 'birthDate' },
  ],
  familyFields: [
    { id: 'mom-name', label: 'ママのお名前', values: [''] },
    { id: 'mom-workplace', label: 'ママの勤務先', values: [''] },
    { id: 'dad-name', label: 'パパのお名前', values: [''] },
    { id: 'dad-workplace', label: 'パパの勤務先', values: [''] },
    { id: 'address', label: 'ご住所', values: [''] },
  ],
  emergencyFields: [
    { id: 'hospital-name', label: '産院名', values: ['福田病院'] },
    { id: 'hospital-phone', label: '産院 電話番号', values: ['096-322-2995'], key: 'hospitalPhone' },
    { id: 'pediatric-name', label: '小児科名', values: ['北野小児科'] },
    { id: 'pediatric-phone', label: '小児科 電話番号', values: ['096-352-8990'], key: 'pediatricPhone' },
    { id: 'papa-company-phone', label: 'パパ会社 電話番号', values: ['096-368-4222'], key: 'papaCompanyPhone' },
    { id: 'papa-contact-phone', label: 'パパ連絡先（携帯）', values: ['080-2742-0550'], key: 'papaContactPhone' },
    { id: 'mama-company-phone', label: 'ママ会社 電話番号', values: [''], key: 'mamaCompanyPhone' },
    { id: 'mama-contact-phone', label: 'ママ連絡先（携帯）', values: ['090-9575-3278'], key: 'mamaContactPhone' },
  ],
  customFields: [],
};
