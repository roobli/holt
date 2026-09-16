import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pushTask } from './commands.ts';

const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const cliPath = join(rootDir, 'src', 'cli.ts');

function holt(args: string[], opts?: { env?: NodeJS.ProcessEnv }): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const env = { ...process.env, ...(opts?.env ?? {}) };
  // Avoid accidental interactive EDITOR during open-body tests unless set explicitly.
  if (!opts?.env?.EDITOR && !args.includes('--editor')) {
    delete env.EDITOR;
    delete env.VISUAL;
  }
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', cliPath, ...args],
    { encoding: 'utf8', env, cwd: rootDir },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test('cli ensure-ledger + inspect --json', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'holt-cli-ens-'));
  const ledger = join(parent, 'fresh');
  const ens = holt(['ensure-ledger', ledger]);
  assert.equal(ens.status, 0, ens.stderr);
  assert.match(ens.stdout, /ledger ready:/);
  await access(join(ledger, 'tasks'));
  await access(join(ledger, 'history.ndjson'));

  const insp = holt(['inspect', ledger, '--json']);
  assert.equal(insp.status, 0, insp.stderr);
  const info = JSON.parse(insp.stdout) as {
    ready: boolean;
    task_count: number;
    history_exists: boolean;
    root: string;
  };
  assert.equal(info.ready, true);
  assert.equal(info.task_count, 0);
  assert.equal(info.history_exists, true);
  assert.equal(info.root, ledger);
});

test('cli list/history --json stable machine output', async () => {
  const ledger = await mkdtemp(join(tmpdir(), 'holt-cli-json-'));
  holt(['ensure-ledger', ledger]);
  const a = await pushTask(ledger, {
    title: 'JSON',
    lane: 'work',
    estimate: '2h',
    project: 'p1',
    actor: 'test',
  });

  const list = holt(['list', ledger, '--json']);
  assert.equal(list.status, 0, list.stderr);
  const tasks = JSON.parse(list.stdout) as Array<{
    id: string;
    title: string;
    estimate?: string;
    estimate_min?: number;
  }>;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.id, a.id);
  assert.equal(tasks[0]!.estimate, '2h');
  assert.equal(tasks[0]!.estimate_min, 120);

  const hist = holt(['history', ledger, '--json', '--task', a.id]);
  assert.equal(hist.status, 0, hist.stderr);
  const events = JSON.parse(hist.stdout) as Array<{ event: string; task_id: string }>;
  assert.ok(events.some((e) => e.event === 'created' && e.task_id === a.id));
});

test('cli open-body opens via --editor and prints path', async () => {
  const ledger = await mkdtemp(join(tmpdir(), 'holt-cli-open-'));
  holt(['ensure-ledger', ledger]);
  const a = await pushTask(ledger, { title: 'Body', lane: 'work', actor: 'test' });
  const stamp = join(ledger, 'opened.txt');
  const editorScript = join(ledger, 'fake-editor.mjs');
  await writeFile(
    editorScript,
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(stamp)}, process.argv[2] ?? '');\n`,
    'utf8',
  );
  const res = holt(['open-body', ledger, a.id, '--editor', `node ${editorScript}`]);
  assert.equal(res.status, 0, res.stderr);
  const printed = res.stdout.trim();
  assert.ok(printed.endsWith(`${a.id}.md`));
  const stamped = await readFile(stamp, 'utf8');
  assert.equal(stamped, printed);
});

test('cli update done-guard refuses open blockers', async () => {
  const ledger = await mkdtemp(join(tmpdir(), 'holt-cli-done-'));
  holt(['ensure-ledger', ledger]);
  const a = await pushTask(ledger, { title: 'A', lane: 'work', actor: 'test' });
  const b = await pushTask(ledger, {
    title: 'B',
    lane: 'work',
    blocked_by: [a.id],
    actor: 'test',
  });
  const fail = holt(['update', ledger, b.id, '--status', 'done']);
  assert.notEqual(fail.status, 0);
  assert.match(fail.stderr, /无法标完成/);
});
