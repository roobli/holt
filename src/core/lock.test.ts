import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withLedgerLock } from './lock.ts';
import { ensureLedger, listLedgerTasks, pushTask } from './ledger.ts';

test('withLedgerLock serializes concurrent writers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-lock-'));
  await ensureLedger(root);

  const titles = Array.from({ length: 8 }, (_, i) => `T${i}`);
  await Promise.all(
    titles.map((title) =>
      pushTask(root, { title, lane: 'work', where: 'bottom', actor: 'test' }),
    ),
  );

  const tasks = await listLedgerTasks(root);
  assert.equal(tasks.length, 8);
  const ids = new Set(tasks.map((t) => t.id));
  assert.equal(ids.size, 8);

  const hist = await readFile(join(root, 'history.ndjson'), 'utf8');
  const lines = hist.split(/\n/).filter(Boolean);
  assert.equal(lines.length, 8);
});

test('withLedgerLock runs critical section', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-lock2-'));
  await ensureLedger(root);
  let saw = 0;
  await withLedgerLock(root, async () => {
    saw = 1;
  });
  assert.equal(saw, 1);
});
