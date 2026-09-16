import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseTaskMarkdown, stackSort } from './parse-task.ts';
import type { HoltTaskMeta } from './types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('parses sample task frontmatter', () => {
  const raw = readFileSync(join(root, 'sample/tasks/T-0001.md'), 'utf8');
  const { meta, body } = parseTaskMarkdown(raw);
  assert.equal(meta.id, 'T-0001');
  assert.equal(meta.status, 'doing');
  assert.equal(meta.stack_order, 10);
  assert.match(body, /Initial repo/);
});

test('stackSort by stack_order then id', () => {
  const tasks = [
    { id: 'T-0002', stack_order: 20 },
    { id: 'T-0001', stack_order: 10 },
    { id: 'T-0003', stack_order: 10 },
  ] as HoltTaskMeta[];
  assert.deepEqual(stackSort(tasks).map((t) => t.id), ['T-0001', 'T-0003', 'T-0002']);
});
