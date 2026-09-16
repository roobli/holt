import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTaskMarkdown, nextTaskId } from './format-task.ts';
import { parseTaskMarkdown } from './parse-task.ts';
import type { HoltTaskMeta } from './types.ts';

test('formatTaskMarkdown round-trips with parseTaskMarkdown', () => {
  const meta: HoltTaskMeta = {
    id: 'T-0009',
    title: 'Round trip',
    status: 'open',
    lane: 'work',
    stack_order: 30,
    estimate: '2h',
    estimate_min: 120,
    blocked_by: ['T-0001', 'T-0003'],
    project: 'holt-mvp',
    created_at: '2026-09-16T10:00:00Z',
    updated_at: '2026-09-16T10:00:00Z',
  };
  const raw = formatTaskMarkdown(meta, 'Body line.\n');
  const parsed = parseTaskMarkdown(raw);
  assert.equal(parsed.meta.id, 'T-0009');
  assert.equal(parsed.meta.title, 'Round trip');
  assert.equal(parsed.meta.stack_order, 30);
  assert.equal(parsed.meta.estimate, '2h');
  assert.equal(parsed.meta.estimate_min, 120);
  assert.deepEqual(parsed.meta.blocked_by, ['T-0001', 'T-0003']);
  assert.equal(parsed.meta.project, 'holt-mvp');
  assert.match(parsed.body, /Body line/);
});

test('nextTaskId increments from existing', () => {
  assert.equal(nextTaskId([]), 'T-0001');
  assert.equal(nextTaskId(['T-0001', 'T-0003']), 'T-0004');
});
