// 実行: npm run test:security-prices
import assert from 'node:assert/strict';

import {
  addDays,
  alphaVantageNotice,
  parseFrankfurter,
  parseFundCsv,
  parseGlobalQuote,
  parseTimeSeries,
  todayJst,
} from './securityPrices.ts';

// GLOBAL_QUOTE（2026-10-08に取った応答の形。値は作りもの）
assert.deepEqual(
  parseGlobalQuote({
    'Global Quote': { '01. symbol': 'ABC', '05. price': '220.5100', '07. latest trading day': '2026-10-07' },
  }),
  [{ on: '2026-10-07', value: 220.51 }],
);
assert.deepEqual(parseGlobalQuote({ 'Global Quote': {} }), []);
assert.deepEqual(parseGlobalQuote({ Note: '回数の上限' }), []);

// TIME_SERIES_DAILY・WEEKLY は古い順に
const daily = {
  'Meta Data': {},
  'Time Series (Daily)': {
    '2026-10-07': { '4. close': '220.51' },
    '2026-10-06': { '4. close': '221.29' },
  },
};
assert.deepEqual(parseTimeSeries(daily), [
  { on: '2026-10-06', value: 221.29 },
  { on: '2026-10-07', value: 220.51 },
]);
assert.deepEqual(parseTimeSeries({ 'Weekly Time Series': { '2026-10-02': { '4. close': '10' } } }), [
  { on: '2026-10-02', value: 10 },
]);
assert.deepEqual(parseTimeSeries({ Information: 'premium' }), []);
// 分割・配当を調整した値（TIME_SERIES_WEEKLY_ADJUSTED）
assert.deepEqual(
  parseTimeSeries(
    { 'Weekly Adjusted Time Series': { '2026-04-24': { '4. close': '125.00', '5. adjusted close': '24.80' } } },
    '5. adjusted close',
  ),
  [{ on: '2026-04-24', value: 24.8 }],
);

assert.equal(alphaVantageNotice(daily), null);
assert.equal(alphaVantageNotice({ Information: 'premium' }), 'premium');
assert.equal(alphaVantageNotice({ Note: 'limit' }), 'limit');

// 投資信託協会の基準価額CSV（見出し・空行・欠けた行は飛ばす）
const csv = '年月日,基準価額(円),純資産総額（百万円）,分配金,決算期\r\n2018年10月31日,10000,10,,\r\n2018年11月1日,10077,10,,\r\n2018年11月02日,,10,,\r\n\r\n';
assert.deepEqual(parseFundCsv(csv), [
  { on: '2018-10-31', value: 10000 },
  { on: '2018-11-01', value: 10077 },
]);

// Frankfurter
assert.deepEqual(parseFrankfurter({ amount: 1, base: 'USD', date: '2026-10-07', rates: { JPY: 158.23 } }), [
  { on: '2026-10-07', value: 158.23 },
]);
assert.deepEqual(
  parseFrankfurter({
    base: 'USD',
    start_date: '2025-10-01',
    rates: { '2025-10-02': { JPY: 146.78 }, '2025-10-01': { JPY: 147.11 } },
  }),
  [
    { on: '2025-10-01', value: 147.11 },
    { on: '2025-10-02', value: 146.78 },
  ],
);

// 日付
assert.equal(todayJst(Date.UTC(2026, 9, 7, 22, 5)), '2026-10-08');
assert.equal(todayJst(Date.UTC(2026, 9, 7, 14, 59)), '2026-10-07');
assert.equal(addDays('2026-10-08', -365), '2025-10-08');
assert.equal(addDays('2024-02-28', 1), '2024-02-29');

console.log('securityPrices: ok');
