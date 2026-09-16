/**
 * Local Stack GUI: Vite UI + /api filesystem ledger (shared commands).
 * Usage: node --experimental-strip-types gui/dev.ts [ledger]
 * Default ledger: arg → HOLT_LEDGER → ~/.config/holt/config.json lastLedger → ./sample
 * (fallback ./sample is the repo sample dir, not cwd)
 */
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createApiState, handleApi, restartLedgerWatch } from './api.ts';
import { saveGuiConfig } from './config.ts';
import { resolveLedger } from '../src/core/resolve-ledger.ts';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '..');
const port = Number(process.env.HOLT_GUI_PORT ?? 5174);

async function resolveGuiDefaultLedger(): Promise<string> {
  const argvLedger = process.argv[2]?.trim() || null;
  if (argvLedger) return (await resolveLedger(argvLedger)).path;
  const r = await resolveLedger(null);
  if (r.source === 'fallback') return resolve(repoRoot, 'sample');
  return r.path;
}

async function main(): Promise<void> {
  const ledgerArg = await resolveGuiDefaultLedger();
  const apiState = createApiState(ledgerArg);
  await saveGuiConfig({ lastLedger: apiState.ledgerRoot });
  restartLedgerWatch(apiState);

  const vite = await createViteServer({
    configFile: resolve(root, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'spa',
  });

  const server = createServer(async (req, res) => {
    try {
      if (await handleApi(apiState, req, res)) return;
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : String(err));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`holt local GUI  http://127.0.0.1:${port}`);
    console.log(`ledger          ${apiState.ledgerRoot}`);
    console.log(`watch           fs.watch → SSE /api/watch (debounced)`);
    console.log(`(same files as: pnpm holt list ${apiState.ledgerRoot})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
