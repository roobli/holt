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

test('cli ledger resolution: arg > HOLT_LEDGER > config lastLedger > sample', async () => {
  const xdg = await mkdtemp(join(tmpdir(), 'holt-cli-res-'));
  const ledgerA = await mkdtemp(join(tmpdir(), 'holt-cli-a-'));
  const ledgerB = await mkdtemp(join(tmpdir(), 'holt-cli-b-'));
  const ledgerC = await mkdtemp(join(tmpdir(), 'holt-cli-c-'));
  holt(['ensure-ledger', ledgerA], { env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' } });
  holt(['ensure-ledger', ledgerB], { env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' } });
  holt(['ensure-ledger', ledgerC], { env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' } });

  // seed config lastLedger = A
  await pushTask(ledgerA, { title: 'in-A', lane: 'work', actor: 'test' });
  const seed = holt(['list', ledgerA, '--json'], {
    env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' },
  });
  assert.equal(seed.status, 0, seed.stderr);

  // no arg, no env → config A
  const fromCfg = holt(['list', '--json'], {
    env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' },
  });
  assert.equal(fromCfg.status, 0, fromCfg.stderr);
  const cfgTasks = JSON.parse(fromCfg.stdout) as Array<{ title: string }>;
  assert.equal(cfgTasks[0]?.title, 'in-A');

  // env beats config
  await pushTask(ledgerB, { title: 'in-B', lane: 'work', actor: 'test' });
  const fromEnv = holt(['list', '--json'], {
    env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: ledgerB },
  });
  assert.equal(fromEnv.status, 0, fromEnv.stderr);
  const envTasks = JSON.parse(fromEnv.stdout) as Array<{ title: string }>;
  assert.equal(envTasks[0]?.title, 'in-B');

  // explicit arg beats env
  await pushTask(ledgerC, { title: 'in-C', lane: 'work', actor: 'test' });
  const fromArg = holt(['list', ledgerC, '--json'], {
    env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: ledgerB },
  });
  assert.equal(fromArg.status, 0, fromArg.stderr);
  const argTasks = JSON.parse(fromArg.stdout) as Array<{ title: string }>;
  assert.equal(argTasks[0]?.title, 'in-C');

  // successful explicit path updates lastLedger (config now C)
  const after = holt(['list', '--json'], {
    env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' },
  });
  assert.equal(after.status, 0, after.stderr);
  const afterTasks = JSON.parse(after.stdout) as Array<{ title: string }>;
  assert.equal(afterTasks[0]?.title, 'in-C');
});

test('cli does not update lastLedger when using env-only resolve', async () => {
  const xdg = await mkdtemp(join(tmpdir(), 'holt-cli-norem-'));
  const ledgerA = await mkdtemp(join(tmpdir(), 'holt-cli-na-'));
  const ledgerB = await mkdtemp(join(tmpdir(), 'holt-cli-nb-'));
  holt(['ensure-ledger', ledgerA], { env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' } });
  holt(['ensure-ledger', ledgerB], { env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' } });
  await pushTask(ledgerA, { title: 'stay-A', lane: 'work', actor: 'test' });
  await pushTask(ledgerB, { title: 'env-B', lane: 'work', actor: 'test' });

  // set config to A via explicit list
  assert.equal(
    holt(['list', ledgerA, '--json'], { env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' } }).status,
    0,
  );

  // operate via env B — should not overwrite lastLedger
  assert.equal(
    holt(['list', '--json'], { env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: ledgerB } }).status,
    0,
  );

  const back = holt(['list', '--json'], {
    env: { XDG_CONFIG_HOME: xdg, HOLT_LEDGER: '' },
  });
  assert.equal(back.status, 0, back.stderr);
  const tasks = JSON.parse(back.stdout) as Array<{ title: string }>;
  assert.equal(tasks[0]?.title, 'stay-A');
});
