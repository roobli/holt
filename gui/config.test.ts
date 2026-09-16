import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Test config helpers against a temp HOME
test('gui config load/save under HOME', async () => {
  const home = await mkdtemp(join(tmpdir(), 'holt-home-'));
  process.env.HOME = home;

  const { loadGuiConfig, saveGuiConfig, guiConfigPath } = await import('./config.ts');
  assert.deepEqual(await loadGuiConfig(), {});

  const saved = await saveGuiConfig({ lastLedger: '/tmp/ledger-a' });
  assert.equal(saved.lastLedger, '/tmp/ledger-a');

  const raw = await readFile(guiConfigPath(), 'utf8');
  assert.match(raw, /ledger-a/);

  const again = await loadGuiConfig();
  assert.equal(again.lastLedger, '/tmp/ledger-a');

  await saveGuiConfig({ lastLedger: '/tmp/ledger-b' });
  assert.equal((await loadGuiConfig()).lastLedger, '/tmp/ledger-b');
});
