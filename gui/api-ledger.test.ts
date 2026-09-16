import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApiState, handleApi, restartLedgerWatch } from './api.ts';
import { inspectLedger, pushTask } from '../src/commands.ts';

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no port'));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
      });
    });
  });
}

async function withApi(
  fn: (port: number, state: ReturnType<typeof createApiState>, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'holt-api-'));
  const state = createApiState(root);
  // create empty ledger via ensure path
  const { port, close } = await listen(async (req, res) => {
    const handled = await handleApi(state, req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end('no');
    }
  });
  try {
    const created = await fetch(`http://127.0.0.1:${port}/api/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: root, create: true }),
    });
    assert.equal(created.status, 200);
    await fn(port, state, root);
  } finally {
    state.watcher?.close();
    await close();
  }
}

test('POST /api/ledger validates and can create empty ledger', async () => {
  const missing = join(await mkdtemp(join(tmpdir(), 'holt-api-parent-')), 'child');
  const state = createApiState(await mkdtemp(join(tmpdir(), 'holt-api-default-')));
  restartLedgerWatch(state);

  const { port, close } = await listen(async (req, res) => {
    const handled = await handleApi(state, req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end('no');
    }
  });

  try {
    const fail = await fetch(`http://127.0.0.1:${port}/api/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: missing }),
    });
    assert.equal(fail.status, 400);
    const failBody = (await fail.json()) as { error: string; createable?: boolean };
    assert.match(failBody.error, /does not exist/);
    assert.equal(failBody.createable, true);

    const ok = await fetch(`http://127.0.0.1:${port}/api/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: missing, create: true }),
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { root: string; ready: boolean; created: boolean };
    assert.equal(body.ready, true);
    assert.equal(body.created, true);
    await access(join(missing, 'tasks'));
    await access(join(missing, 'history.ndjson'));

    const status = await inspectLedger(missing);
    assert.equal(status.ready, true);

    const get = await fetch(`http://127.0.0.1:${port}/api/ledger`);
    const ledger = (await get.json()) as { root: string; ready: boolean };
    assert.equal(ledger.root, body.root);
    assert.equal(ledger.ready, true);
  } finally {
    state.watcher?.close();
    await close();
  }
});

test('POST /api/update estimate dual-writes minutes (GUI Detail wiring)', async () => {
  await withApi(async (port, _state, root) => {
    const task = await pushTask(root, {
      title: 'Est',
      lane: 'work',
      estimate: '45m',
      actor: 'test',
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, estimate: '2h' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      task: { estimate?: string; estimate_min?: number };
    };
    assert.equal(body.task.estimate, '2h');
    assert.equal(body.task.estimate_min, 120);
  });
});

test('POST /api/update done guard refuses open blockers (GUI Detail)', async () => {
  await withApi(async (port, _state, root) => {
    const a = await pushTask(root, { title: 'Blocker', lane: 'work', actor: 'test' });
    const b = await pushTask(root, {
      title: 'Blocked',
      lane: 'work',
      blocked_by: [a.id],
      actor: 'test',
    });

    const fail = await fetch(`http://127.0.0.1:${port}/api/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: b.id, status: 'done' }),
    });
    assert.ok(fail.status >= 400);
    const failBody = (await fail.json()) as { error: string };
    assert.match(failBody.error, /无法标完成/);

    const okA = await fetch(`http://127.0.0.1:${port}/api/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, status: 'done' }),
    });
    assert.equal(okA.status, 200);

    const okB = await fetch(`http://127.0.0.1:${port}/api/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: b.id, status: 'done' }),
    });
    assert.equal(okB.status, 200);
    const body = (await okB.json()) as { task: { status: string } };
    assert.equal(body.task.status, 'done');
  });
});

test('POST /api/complete-project all-or-nothing (GUI button wiring)', async () => {
  await withApi(async (port, _state, root) => {
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

    const fail = await fetch(`http://127.0.0.1:${port}/api/complete-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'holt-mvp' }),
    });
    assert.ok(fail.status >= 400);
    const failBody = (await fail.json()) as { error: string };
    assert.match(failBody.error, /无法完成 project/);

    // clear blocker path: mark A done then complete
    await fetch(`http://127.0.0.1:${port}/api/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, status: 'done' }),
    });

    // B still open, no open blockers now — complete remaining
    const ok = await fetch(`http://127.0.0.1:${port}/api/complete-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'holt-mvp' }),
    });
    assert.equal(ok.status, 200);
    const result = (await ok.json()) as { project: string; task_ids: string[] };
    assert.equal(result.project, 'holt-mvp');
    assert.equal(result.task_ids.length, 1);
  });
});
