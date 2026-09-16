import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  listHistory,
  listLedgerTasks,
  pushTask,
  reorderTask,
} from './ledger.ts';

test('push list reorder history on temp ledger', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-ledger-'));
  const a = await pushTask(root, {
    title: 'First',
    lane: 'personal',
    estimate_min: 15,
    where: 'top',
  });
  assert.equal(a.id, 'T-0001');
  assert.equal(a.stack_order, 10);

  const b = await pushTask(root, {
    title: 'Second',
    lane: 'work',
    where: 'top',
  });
  assert.equal(b.id, 'T-0002');
  assert.ok(b.stack_order < a.stack_order);

  const listed = await listLedgerTasks(root);
  assert.deepEqual(
    listed.map((t) => t.id),
    ['T-0002', 'T-0001'],
  );

  await reorderTask(root, 'T-0001', -10);
  const again = await listLedgerTasks(root);
  assert.equal(again[0].id, 'T-0001');
  assert.equal(again[0].stack_order, -10);

  const hist = await listHistory(root);
  assert.ok(hist.some((e) => e.event === 'created' && e.task_id === 'T-0001'));
  assert.ok(hist.some((e) => e.event === 'reordered' && e.task_id === 'T-0001'));

  const only = await listHistory(root, 'T-0002');
  assert.ok(only.every((e) => e.task_id === 'T-0002'));

  const raw = await readFile(join(root, 'tasks', 'T-0001.md'), 'utf8');
  assert.match(raw, /stack_order: -10/);
});
