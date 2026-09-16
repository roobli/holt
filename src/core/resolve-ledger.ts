/**
 * Default ledger resolution (CLI + GUI aligned):
 * 1. Explicit path argument (if provided)
 * 2. HOLT_LEDGER env
 * 3. Shared config lastLedger (~/.config/holt/config.json)
 * 4. Fallback ./sample
 */
import { resolve } from 'node:path';
import { loadHoltConfig, saveHoltConfig } from './config.ts';

export type LedgerResolveSource = 'arg' | 'env' | 'config' | 'fallback';

export interface ResolvedLedger {
  /** Absolute ledger path */
  path: string;
  source: LedgerResolveSource;
  /** True when caller passed an explicit path argument */
  fromExplicit: boolean;
}

/**
 * Resolve which ledger directory to use.
 * @param explicit - positional [ledger] when the user supplied one; omit/null/'' to fall through
 */
export async function resolveLedger(
  explicit?: string | null,
): Promise<ResolvedLedger> {
  const arg = explicit?.trim();
  if (arg) {
    return { path: resolve(arg), source: 'arg', fromExplicit: true };
  }

  const env = process.env.HOLT_LEDGER?.trim();
  if (env) {
    return { path: resolve(env), source: 'env', fromExplicit: false };
  }

  const cfg = await loadHoltConfig();
  const last = cfg.lastLedger?.trim();
  if (last) {
    return { path: resolve(last), source: 'config', fromExplicit: false };
  }

  return { path: resolve('./sample'), source: 'fallback', fromExplicit: false };
}

/** Persist last opened ledger (absolute), same key GUI uses. */
export async function rememberLastLedger(ledgerPath: string): Promise<void> {
  await saveHoltConfig({ lastLedger: resolve(ledgerPath) });
}
