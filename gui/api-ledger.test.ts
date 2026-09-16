import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApiState, handleApi, restartLedgerWatch } from './api.ts';
import { inspectLedger } from '../src/commands.ts';

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
