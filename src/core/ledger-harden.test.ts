import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ensureLedger,
  inspectLedger,
  listLedgerTasks,
  pushTask,
  writeTaskFile,
} from './ledger.ts';
import type { HoltTaskMeta } from './types.ts';

test('ensureLedger creates tasks/ and empty history.ndjson', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-ensure-'));
  const paths = await ensureLedger(root);
  await access(paths.tasksDir);
  await access(paths.historyPath);
  const raw = await readFile(paths.historyPath, 'utf8');
  assert.equal(raw, '');
  const status = await inspectLedger(root);
  assert.equal(status.exists, true);
  assert.equal(status.ready, true);
});

test('inspectLedger reports missing and not-ready', async () => {
  const missing = join(tmpdir(), `holt-missing-${Date.now()}-${Math.random()}`);
  const a = await inspectLedger(missing);
  assert.equal(a.exists, false);
  assert.equal(a.ready, false);

  const root = await mkdtemp(join(tmpdir(), 'holt-empty-'));
  const b = await inspectLedger(root);
  assert.equal(b.exists, true);
  assert.equal(b.ready, false);
});

test('writeTaskFile is atomic (no leftover .tmp on success)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-atomic-'));
  await ensureLedger(root);
  const now = new Date().toISOString();
  const meta: HoltTaskMeta = {
    id: 'T-0001',
    title: 'Atomic',
    status: 'open',
    lane: 'personal',
    stack_order: 10,
    created_at: now,
    updated_at: now,
  };
  await writeTaskFile(root, meta, 'body\n');
  const names = await readdir(join(root, 'tasks'));
  assert.deepEqual(names, ['T-0001.md']);
  const raw = await readFile(join(root, 'tasks', 'T-0001.md'), 'utf8');
  assert.match(raw, /title: Atomic/);
  assert.match(raw, /body/);
});

test('push after ensureLedger works on fresh path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-fresh-'));
  await ensureLedger(root);
  const t = await pushTask(root, { title: 'Hi', lane: 'personal', where: 'top' });
  assert.equal(t.id, 'T-0001');
  const list = await listLedgerTasks(root);
  assert.equal(list.length, 1);
});
