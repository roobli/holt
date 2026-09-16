import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appendEvent, readEvents } from './history.ts';

test('appendEvent then readEvents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'holt-'));
  const path = join(dir, 'history.ndjson');
  await appendEvent(path, {
    time: '2026-09-16T06:00:00Z',
    event: 'created',
    task_id: 'T-0001',
    actor: 'test',
    data: { title: 'x' },
  });
  const events = await readEvents(path);
  assert.equal(events.length, 1);
  assert.equal(events[0].task_id, 'T-0001');
  const raw = await readFile(path, 'utf8');
  assert.ok(raw.endsWith('\n'));
});
