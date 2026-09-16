/**
 * Local Stack GUI: Vite UI + /api filesystem ledger (shared commands).
 * Usage: node --experimental-strip-types gui/dev.ts [ledger]
 * Default ledger: CLI arg → ~/.config/holt/gui.json lastLedger → ./sample
 */
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createApiState, handleApi, restartLedgerWatch } from './api.ts';
import { loadGuiConfig, saveGuiConfig } from './config.ts';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '..');
const port = Number(process.env.HOLT_GUI_PORT ?? 5174);

async function resolveDefaultLedger(): Promise<string> {
  if (process.argv[2]) return resolve(process.argv[2]);
  const cfg = await loadGuiConfig();
  if (cfg.lastLedger) return resolve(cfg.lastLedger);
  return resolve(repoRoot, 'sample');
}

async function main(): Promise<void> {
  const ledgerArg = await resolveDefaultLedger();
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
