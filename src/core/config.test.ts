import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  loadHoltConfig,
  saveHoltConfig,
  holtConfigPath,
  holtConfigDir,
  legacyGuiConfigPath,
} from './config.ts';

async function withXdg<T>(fn: () => Promise<T>): Promise<T> {
  const xdg = await mkdtemp(join(tmpdir(), 'holt-xdg-'));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  }
}

test('shared config load/save under XDG_CONFIG_HOME', async () => {
  await withXdg(async () => {
    const xdg = process.env.XDG_CONFIG_HOME!;
    assert.equal(holtConfigDir(), join(xdg, 'holt'));
    assert.deepEqual(await loadHoltConfig(), {});

    const saved = await saveHoltConfig({ lastLedger: '/tmp/ledger-a' });
    assert.equal(saved.lastLedger, '/tmp/ledger-a');

    const raw = await readFile(holtConfigPath(), 'utf8');
    assert.match(raw, /ledger-a/);
    assert.match(holtConfigPath(), /config\.json$/);

    assert.equal((await loadHoltConfig()).lastLedger, '/tmp/ledger-a');
    await saveHoltConfig({ lastLedger: '/tmp/ledger-b' });
    assert.equal((await loadHoltConfig()).lastLedger, '/tmp/ledger-b');
  });
});

test('shared config falls back to legacy gui.json', async () => {
  await withXdg(async () => {
    const xdg = process.env.XDG_CONFIG_HOME!;
    await mkdir(join(xdg, 'holt'), { recursive: true });
    await writeFile(
      legacyGuiConfigPath(),
      `${JSON.stringify({ lastLedger: '/legacy/ledger' }, null, 2)}\n`,
      'utf8',
    );

    assert.equal((await loadHoltConfig()).lastLedger, '/legacy/ledger');

    await saveHoltConfig({ lastLedger: '/migrated/ledger' });
    const primary = JSON.parse(await readFile(holtConfigPath(), 'utf8')) as {
      lastLedger: string;
    };
    assert.equal(primary.lastLedger, '/migrated/ledger');
  });
});
