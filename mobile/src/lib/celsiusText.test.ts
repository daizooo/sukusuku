// 通知の上で打ち込まれた体温の読み方のテスト。
// 実行: npm run test:celsius-text
import assert from 'node:assert/strict';

import { parseCelsiusText } from './celsiusText.ts';

assert.equal(parseCelsiusText('36.8'), 36.8);
assert.equal(parseCelsiusText(' 37 '), 37);
assert.equal(parseCelsiusText('３６．８'), 36.8);
assert.equal(parseCelsiusText('36,8'), 36.8);
assert.equal(parseCelsiusText('36.8℃'), 36.8);
assert.equal(parseCelsiusText('36.8度'), 36.8);
assert.equal(parseCelsiusText('368'), 36.8);
assert.equal(parseCelsiusText('36.85'), 36.9);

assert.equal(parseCelsiusText(''), null);
assert.equal(parseCelsiusText('abc'), null);
assert.equal(parseCelsiusText('3'), null);
assert.equal(parseCelsiusText('3680'), null);
assert.equal(parseCelsiusText('36.8.1'), null);

console.log('celsiusText: ok');
