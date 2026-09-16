import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  loadGuiConfig,
  saveGuiConfig,
  guiConfigPath,
  legacyGuiConfigPath,
} from './config.ts';

async function withXdg<T>(fn: () => Promise<T>): Promise<T> {
  const xdg = await mkdtemp(join(tmpdir(), 'holt-home-'));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  }
}

test('gui config load/save under shared config.json', async () => {
  await withXdg(async () => {
    assert.deepEqual(await loadGuiConfig(), {});

    const saved = await saveGuiConfig({ lastLedger: '/tmp/ledger-a' });
    assert.equal(saved.lastLedger, '/tmp/ledger-a');

    const raw = await readFile(guiConfigPath(), 'utf8');
    assert.match(raw, /ledger-a/);
    assert.match(guiConfigPath(), /config\.json$/);

    const again = await loadGuiConfig();
    assert.equal(again.lastLedger, '/tmp/ledger-a');

    await saveGuiConfig({ lastLedger: '/tmp/ledger-b' });
    assert.equal((await loadGuiConfig()).lastLedger, '/tmp/ledger-b');
  });
});

test('gui config still reads legacy gui.json', async () => {
  await withXdg(async () => {
    const xdg = process.env.XDG_CONFIG_HOME!;
    await mkdir(join(xdg, 'holt'), { recursive: true });
    await writeFile(
      legacyGuiConfigPath(),
      `${JSON.stringify({ lastLedger: '/tmp/legacy' }, null, 2)}\n`,
      'utf8',
    );
    assert.equal((await loadGuiConfig()).lastLedger, '/tmp/legacy');
  });
});
