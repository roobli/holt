import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { resolveLedger, rememberLastLedger } from './resolve-ledger.ts';

async function withIsolatedConfig<T>(fn: () => Promise<T>): Promise<T> {
  const xdg = await mkdtemp(join(tmpdir(), 'holt-res-'));
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const prevHolt = process.env.HOLT_LEDGER;
  process.env.XDG_CONFIG_HOME = xdg;
  delete process.env.HOLT_LEDGER;
  try {
    return await fn();
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    if (prevHolt === undefined) delete process.env.HOLT_LEDGER;
    else process.env.HOLT_LEDGER = prevHolt;
  }
}

test('resolveLedger order: arg > env > config > ./sample', async () => {
  await withIsolatedConfig(async () => {
    const fallback = await resolveLedger(null);
    assert.equal(fallback.source, 'fallback');
    assert.equal(fallback.fromExplicit, false);
    assert.equal(fallback.path, resolve('./sample'));

    await rememberLastLedger('/cfg/ledger');
    const fromCfg = await resolveLedger('');
    assert.equal(fromCfg.source, 'config');
    assert.equal(fromCfg.path, resolve('/cfg/ledger'));
    assert.equal(fromCfg.fromExplicit, false);

    process.env.HOLT_LEDGER = '/env/ledger';
    const fromEnv = await resolveLedger(null);
    assert.equal(fromEnv.source, 'env');
    assert.equal(fromEnv.path, resolve('/env/ledger'));

    const fromArg = await resolveLedger('/arg/ledger');
    assert.equal(fromArg.source, 'arg');
    assert.equal(fromArg.fromExplicit, true);
    assert.equal(fromArg.path, resolve('/arg/ledger'));

    process.env.HOLT_LEDGER = '   ';
    const skipEmptyEnv = await resolveLedger(null);
    assert.equal(skipEmptyEnv.source, 'config');
  });
});

test('resolveLedger reads legacy gui.json via shared config', async () => {
  await withIsolatedConfig(async () => {
    const xdg = process.env.XDG_CONFIG_HOME!;
    await mkdir(join(xdg, 'holt'), { recursive: true });
    await writeFile(
      join(xdg, 'holt', 'gui.json'),
      `${JSON.stringify({ lastLedger: '/from/gui' }, null, 2)}\n`,
      'utf8',
    );

    const r = await resolveLedger(null);
    assert.equal(r.source, 'config');
    assert.equal(r.path, resolve('/from/gui'));
  });
});
