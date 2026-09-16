import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  completeProject,
  ensureLedger,
  inspectLedgerDetailed,
  listTasks,
  moveTask,
  openTaskBody,
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

test('estimate dual-write on push/update', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-est-'));
  const a = await pushTask(root, {
    title: 'Est',
    lane: 'work',
    estimate: '2h',
    actor: 'test',
  });
  assert.equal(a.estimate, '2h');
  assert.equal(a.estimate_min, 120);
  const raw = await readFile(join(root, 'tasks', a.id + '.md'), 'utf8');
  assert.match(raw, /estimate: 2h/);
  assert.match(raw, /estimate_min: 120/);

  const updated = await updateTask(root, a.id, { estimate: '1d' }, 'test');
  assert.equal(updated.estimate, '1d');
  assert.equal(updated.estimate_min, 480);
});

test('blocked_by done guard refuses open blockers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-dep-'));
  const a = await pushTask(root, { title: 'Blocker', lane: 'work', actor: 'test' });
  const b = await pushTask(root, {
    title: 'Blocked',
    lane: 'work',
    blocked_by: [a.id],
    actor: 'test',
  });
  await assert.rejects(
    () => updateTask(root, b.id, { status: 'done' }, 'test'),
    /无法标完成/,
  );
  await updateTask(root, a.id, { status: 'done' }, 'test');
  const ok = await updateTask(root, b.id, { status: 'done' }, 'test');
  assert.equal(ok.status, 'done');
});

test('blocked_by rejects unknown and self', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-dep2-'));
  const a = await pushTask(root, { title: 'A', lane: 'work', actor: 'test' });
  await assert.rejects(
    () => updateTask(root, a.id, { blocked_by: ['T-9999'] }, 'test'),
    /未知任务/,
  );
  await assert.rejects(
    () => updateTask(root, a.id, { add_blocked_by: [a.id] }, 'test'),
    /不能依赖自身/,
  );
});

test('complete-project refuses open blockers (same as update done)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-proj-block-'));
  const a = await pushTask(root, {
    title: 'A',
    lane: 'work',
    project: 'holt-mvp',
    actor: 'test',
  });
  await pushTask(root, {
    title: 'B',
    lane: 'work',
    project: 'holt-mvp',
    blocked_by: [a.id],
    actor: 'test',
  });

  await assert.rejects(
    () => completeProject(root, 'holt-mvp', 'test'),
    /无法完成 project/,
  );

  const tasks = await listTasks(root);
  assert.equal(tasks.find((t) => t.id === a.id)!.status, 'open');
  assert.equal(tasks.find((t) => t.title === 'B')!.status, 'open');
});

test('complete-project all-or-nothing + history when unblocked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-proj-'));
  const a = await pushTask(root, {
    title: 'A',
    lane: 'work',
    project: 'holt-mvp',
    actor: 'test',
  });
  const b = await pushTask(root, {
    title: 'B',
    lane: 'work',
    project: 'holt-mvp',
    actor: 'test',
  });
  await pushTask(root, {
    title: 'Other',
    lane: 'work',
    project: 'other',
    actor: 'test',
  });

  const result = await completeProject(root, 'holt-mvp', 'test');
  assert.deepEqual(result.task_ids.sort(), [a.id, b.id].sort());

  const tasks = await listTasks(root);
  assert.equal(tasks.find((t) => t.id === a.id)!.status, 'done');
  assert.equal(tasks.find((t) => t.id === b.id)!.status, 'done');
  assert.equal(tasks.find((t) => t.title === 'Other')!.status, 'open');

  const hist = await readHistory(root);
  assert.ok(
    hist.some(
      (e) =>
        e.event === 'project_completed' &&
        e.task_id === '*' &&
        (e.data as { project?: string })?.project === 'holt-mvp',
    ),
  );
  assert.ok(
    hist.some(
      (e) =>
        e.event === 'updated' &&
        e.task_id === a.id &&
        (e.data as { via?: string })?.via === 'project_completed',
    ),
  );
});

test('complete-project fails whole batch on external open blocker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-proj2-'));
  const ext = await pushTask(root, { title: 'Ext', lane: 'work', actor: 'test' });
  const a = await pushTask(root, {
    title: 'A',
    lane: 'work',
    project: 'p1',
    blocked_by: [ext.id],
    actor: 'test',
  });
  await assert.rejects(
    () => completeProject(root, 'p1', 'test'),
    /无法完成 project/,
  );
  const tasks = await listTasks(root);
  assert.equal(tasks.find((t) => t.id === a.id)!.status, 'open');
  assert.equal(tasks.find((t) => t.id === ext.id)!.status, 'open');
});

test('openTaskBody resolves path and runs --editor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-open-'));
  await ensureLedger(root);
  const a = await pushTask(root, { title: 'Open', lane: 'work', actor: 'test' });
  const stamp = join(root, 'opened.txt');
  const editorScript = join(root, 'fake-editor.mjs');
  await writeFile(
    editorScript,
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(stamp)}, process.argv[2] ?? '');\n`,
  );
  const result = await openTaskBody(root, a.id, { editor: `node ${editorScript}` });
  assert.ok(result.path.endsWith(`${a.id}.md`));
  assert.equal(result.opened, true);
  assert.equal(result.via, 'editor');
  assert.equal(await readFile(stamp, 'utf8'), result.path);
});

test('inspectLedgerDetailed reports counts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holt-insp-'));
  await ensureLedger(root);
  await pushTask(root, { title: 'One', lane: 'work', actor: 'test' });
  const info = await inspectLedgerDetailed(root);
  assert.equal(info.ready, true);
  assert.equal(info.task_count, 1);
  assert.equal(info.history_exists, true);
});
