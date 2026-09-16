import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  listTasks,
  moveTask,
  pushTask,
  readHistory,
  reorderToIndex,
  updateTask,
} from './commands.ts';

test('commands: push move reorderToIndex update history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-cmd-'));
  await pushTask(root, { title: 'A', lane: 'personal', where: 'top', actor: 'test' });
  await pushTask(root, { title: 'B', lane: 'work', where: 'top', actor: 'test' });
  await pushTask(root, { title: 'C', lane: 'work', where: 'bottom', actor: 'test' });

  let tasks = await listTasks(root);
  assert.deepEqual(
    tasks.map((t) => t.title),
    ['B', 'A', 'C'],
  );

  await moveTask(root, tasks[0]!.id, 'down', 'test');
  tasks = await listTasks(root);
  assert.deepEqual(
    tasks.map((t) => t.title),
    ['A', 'B', 'C'],
  );

  const b = tasks.find((t) => t.title === 'B')!;
  await reorderToIndex(root, b.id, 0, 'test');
  tasks = await listTasks(root);
  assert.equal(tasks[0]!.title, 'B');

  await updateTask(root, tasks[0]!.id, { status: 'doing' }, 'test');
  tasks = await listTasks(root);
  assert.equal(tasks[0]!.status, 'doing');

  const hist = await readHistory(root, tasks[0]!.id);
  assert.ok(hist.some((e) => e.event === 'updated' && e.actor === 'test'));
  assert.ok(hist.every((e) => e.task_id === tasks[0]!.id));
});
