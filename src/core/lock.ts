/**
 * Cross-process ledger lock (lockfile + retry) so CLI and GUI mutations
 * do not interleave mid write/history append.
 */
import { open, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const STALE_MS = 10_000;
const RETRIES = 40;
const BASE_DELAY_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryStealStale(lockPath: string): Promise<void> {
  try {
    const st = await stat(lockPath);
    if (Date.now() - st.mtimeMs > STALE_MS) {
      await unlink(lockPath).catch(() => {});
    }
  } catch {
    /* missing is fine */
  }
}

/**
 * Acquire exclusive `.holt.lock` under ledger root. Returns unlock fn.
 */
export async function acquireLedgerLock(root: string): Promise<() => Promise<void>> {
  const lockPath = join(resolve(root), '.holt.lock');
  for (let i = 0; i < RETRIES; i++) {
    try {
      const fh = await open(lockPath, 'wx');
      try {
        await fh.writeFile(`${process.pid}\n${Date.now()}\n`);
      } catch {
        await fh.close().catch(() => {});
        throw new Error('failed to write ledger lock');
      }
      return async () => {
        await fh.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw e;
      if (i === 10 || i === 25) await tryStealStale(lockPath);
      await sleep(BASE_DELAY_MS + Math.floor(Math.random() * BASE_DELAY_MS));
    }
  }
  throw new Error('ledger busy: 账本正在被占用（CLI 或另一窗口在写），请稍后再试');
}

export async function withLedgerLock<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const unlock = await acquireLedgerLock(root);
  try {
    return await fn();
  } finally {
    await unlock();
  }
}
