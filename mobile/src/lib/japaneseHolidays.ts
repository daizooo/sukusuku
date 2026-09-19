// 予定タブに出す日本の祝日。
//
// 病院・役所・保育園はどれも祝日に閉まる。予定を入れるときに
// 「その日は開いているか」をカレンダーの上で確かめられるようにするためのもの。
//
// 祝日は予定(tasks)としては持たない。家族が入れた予定と同じ並びに混ざると、
// 消せない予定が並ぶことになるため、カレンダーの表示にだけ足す。
//
// 数え方は「国民の祝日に関する法律」のいまの形（ハッピーマンデー・振替休日・
// 国民の休日が入ったもの）に合わせる。過去にだけあった祝日や、
// 東京オリンピックの年のような一度きりの移動は入れない。

const MONDAY_HOLIDAYS: { month: number; nth: number; name: string }[] = [
  { month: 1, nth: 2, name: '成人の日' },
  { month: 7, nth: 3, name: '海の日' },
  { month: 9, nth: 3, name: '敬老の日' },
  { month: 10, nth: 2, name: 'スポーツの日' },
];

const FIXED_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: '元日' },
  { month: 2, day: 11, name: '建国記念の日' },
  { month: 2, day: 23, name: '天皇誕生日' },
  { month: 4, day: 29, name: '昭和の日' },
  { month: 5, day: 3, name: '憲法記念日' },
  { month: 5, day: 4, name: 'みどりの日' },
  { month: 5, day: 5, name: 'こどもの日' },
  { month: 8, day: 11, name: '山の日' },
  { month: 11, day: 3, name: '文化の日' },
  { month: 11, day: 23, name: '勤労感謝の日' },
];

/** その月の第n月曜日の日にち。 */
const nthMondayDate = (year: number, month: number, nth: number): number => {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  return 1 + ((8 - firstWeekday) % 7) + (nth - 1) * 7;
};

// 春分・秋分は天文の計算で決まるため、年ごとに1日ずれる。
// 1980〜2099年の範囲で使われている近似式をそのまま使う。
const vernalEquinoxDate = (year: number): number =>
  Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
const autumnalEquinoxDate = (year: number): number =>
  Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));

/** 'YYYY-MM-DD'。日付の比較にだけ使うので、時刻もタイムゾーンも持たない。 */
const toKey = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const keyOf = (date: Date): string =>
  toKey(date.getFullYear(), date.getMonth() + 1, date.getDate());

const shiftKey = (key: string, days: number): string => {
  const [year, month, day] = key.split('-').map(Number);
  return keyOf(new Date(new Date(year, month - 1, day).getTime() + days * MS_PER_DAY));
};

/** その年の祝日。'YYYY-MM-DD' から名前を引く。 */
const buildYear = (year: number): Map<string, string> => {
  const holidays = new Map<string, string>();
  for (const { month, day, name } of FIXED_HOLIDAYS) holidays.set(toKey(year, month, day), name);
  for (const { month, nth, name } of MONDAY_HOLIDAYS) {
    holidays.set(toKey(year, month, nthMondayDate(year, month, nth)), name);
  }
  holidays.set(toKey(year, 3, vernalEquinoxDate(year)), '春分の日');
  holidays.set(toKey(year, 9, autumnalEquinoxDate(year)), '秋分の日');

  // 国民の休日。前後を祝日に挟まれた平日は休みになる
  // （敬老の日と秋分の日が1日あいた年の9月22日など）。
  const sandwiched: string[] = [];
  for (const key of holidays.keys()) {
    const between = shiftKey(key, 1);
    if (holidays.has(between) || !holidays.has(shiftKey(between, 1))) continue;
    // 日曜は振替休日のもとになる日なので、こちらでは拾わない。
    const [y, m, d] = between.split('-').map(Number);
    if (new Date(y, m - 1, d).getDay() === 0) continue;
    sandwiched.push(between);
  }
  for (const key of sandwiched) holidays.set(key, '国民の休日');

  // 振替休日。日曜と重なった祝日は、次の祝日でない日に振り替わる。
  const substitutes: string[] = [];
  for (const [key, name] of holidays) {
    if (name === '国民の休日') continue;
    const [y, m, d] = key.split('-').map(Number);
    if (new Date(y, m - 1, d).getDay() !== 0) continue;
    let next = shiftKey(key, 1);
    while (holidays.has(next)) next = shiftKey(next, 1);
    substitutes.push(next);
  }
  for (const key of substitutes) holidays.set(key, '振替休日');

  return holidays;
};

// 同じ月を何度も描き直すので、一度数えた年は取っておく。
const cache = new Map<number, Map<string, string>>();

const holidaysOfYear = (year: number): Map<string, string> => {
  const cached = cache.get(year);
  if (cached) return cached;
  const built = buildYear(year);
  cache.set(year, built);
  return built;
};

/** その日が祝日なら名前を返す。祝日でなければ null。 */
export const getHolidayName = (date: Date): string | null =>
  holidaysOfYear(date.getFullYear()).get(keyOf(date)) ?? null;

/** 日曜と同じ赤で出す日か（祝日・振替休日・国民の休日）。 */
export const isHoliday = (date: Date): boolean => getHolidayName(date) !== null;
