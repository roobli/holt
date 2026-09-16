import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyEstimateDualWrite,
  displayEstimate,
  estimateMinutesOf,
  parseEstimateToMinutes,
} from './estimate.ts';

test('parseEstimateToMinutes: m/h/d and bare minutes; 1d=8h', () => {
  assert.equal(parseEstimateToMinutes('45m'), 45);
  assert.equal(parseEstimateToMinutes('90'), 90);
  assert.equal(parseEstimateToMinutes('2h'), 120);
  assert.equal(parseEstimateToMinutes('1d'), 480);
  assert.equal(parseEstimateToMinutes(' 1.5 h '), 90);
  assert.equal(parseEstimateToMinutes('0.5d'), 240);
});

test('parseEstimateToMinutes rejects junk', () => {
  assert.throws(() => parseEstimateToMinutes(''), /估时格式/);
  assert.throws(() => parseEstimateToMinutes('2x'), /估时格式/);
  assert.throws(() => parseEstimateToMinutes('abc'), /估时格式/);
});

test('displayEstimate prefers raw estimate; falls back to Nm', () => {
  assert.equal(displayEstimate({ estimate: '2h', estimate_min: 120 }), '2h');
  assert.equal(displayEstimate({ estimate_min: 45 }), '45m');
  assert.equal(displayEstimate({}), undefined);
});

test('estimateMinutesOf + dual-write', () => {
  assert.equal(estimateMinutesOf({ estimate: '1d' }), 480);
  assert.equal(estimateMinutesOf({ estimate_min: 30 }), 30);
  const t: { estimate?: string; estimate_min?: number } = {};
  applyEstimateDualWrite(t, '2h');
  assert.equal(t.estimate, '2h');
  assert.equal(t.estimate_min, 120);
  applyEstimateDualWrite(t, null);
  assert.equal(t.estimate, undefined);
  assert.equal(t.estimate_min, undefined);
});
