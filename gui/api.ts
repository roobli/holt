/**
 * Tiny local HTTP API over shared ledger commands (filesystem).
 * Used by gui/dev.ts as /api/* middleware.
 */
import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  completeProject,
  listTasks,
  moveTask,
  pushTask,
  readHistory,
  readTaskFile,
  reorderTask,
  reorderToIndex,
  updateTask,
  inspectLedger,
  ensureLedger,
  type UpdateTaskPatch,
} from '../src/commands.ts';
import { saveGuiConfig } from './config.ts';

const ACTOR = 'gui';
const WATCH_DEBOUNCE_MS = 120;

export interface GuiApiState {
  /** Absolute ledger root */
  ledgerRoot: string;
  watcher: FSWatcher | null;
  sseClients: Set<ServerResponse>;
  watchTimer: ReturnType<typeof setTimeout> | null;
  watchGen: number;
}

export function createApiState(defaultLedger: string): GuiApiState {
  return {
    ledgerRoot: resolve(defaultLedger),
    watcher: null,
    sseClients: new Set(),
    watchTimer: null,
    watchGen: 0,
  };
}

function shouldIgnoreWatchName(name: string | null): boolean {
  if (!name) return false;
  if (name === '.holt.lock') return true;
  if (name.endsWith('.tmp')) return true;
  if (name.startsWith('.')) return true;
  return false;
}

function broadcastLedgerChange(state: GuiApiState): void {
  const payload = `data: ${JSON.stringify({ type: 'change', root: state.ledgerRoot })}\n\n`;
  for (const res of state.sseClients) {
    try {
      res.write(payload);
    } catch {
      state.sseClients.delete(res);
    }
  }
}

function scheduleBroadcast(state: GuiApiState): void {
  if (state.watchTimer) clearTimeout(state.watchTimer);
  state.watchTimer = setTimeout(() => {
    state.watchTimer = null;
    broadcastLedgerChange(state);
  }, WATCH_DEBOUNCE_MS);
}

/** Start or restart fs.watch on current ledger root. */
export function restartLedgerWatch(state: GuiApiState): void {
  state.watcher?.close();
  state.watcher = null;
  state.watchGen += 1;
  const gen = state.watchGen;
  const root = state.ledgerRoot;

  void inspectLedger(root).then((status) => {
    if (gen !== state.watchGen) return;
    if (!status.exists) return;
    try {
      state.watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (shouldIgnoreWatchName(filename)) return;
        scheduleBroadcast(state);
      });
      state.watcher.on('error', () => {
        /* ledger may vanish mid-session */
      });
    } catch {
      /* path not watchable yet */
    }
  });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendError(res: ServerResponse, err: unknown, fallback = 400): void {
  const message = err instanceof Error ? err.message : String(err);
  let status = fallback;
  if (message.startsWith('unknown task') || message.includes('ENOENT')) status = 404;
  if (message.startsWith('ledger busy')) status = 409;
  sendJson(res, status, { error: message });
}

function openLocalPath(path: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [path], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', path], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [path], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function applyLedgerPath(
  state: GuiApiState,
  rawPath: string,
  create: boolean,
): Promise<{ status: Awaited<ReturnType<typeof inspectLedger>>; created: boolean }> {
  const abs = resolve(rawPath);
  let status = await inspectLedger(abs);
  let created = false;

  if (!status.ready) {
    if (!create) {
      const err = new Error(
        status.exists
          ? `not a ledger (missing tasks/): ${abs}`
          : `ledger path does not exist: ${abs}`,
      );
      (err as Error & { code?: string }).code = status.exists ? 'NOT_LEDGER' : 'ENOENT';
      throw err;
    }
    await ensureLedger(abs);
    created = true;
    status = await inspectLedger(abs);
  }

  state.ledgerRoot = abs;
  await saveGuiConfig({ lastLedger: abs });
  restartLedgerWatch(state);
  return { status, created };
}

export async function handleApi(
  state: GuiApiState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api')) return false;

  const method = req.method ?? 'GET';
  const path = url.pathname;

  try {
    if (method === 'GET' && path === '/api/health') {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === 'GET' && path === '/api/ledger') {
      const status = await inspectLedger(state.ledgerRoot);
      sendJson(res, 200, {
        ...status,
        watching: state.watcher != null,
        clients: state.sseClients.size,
      });
      return true;
    }

    if (method === 'POST' && path === '/api/ledger') {
      const body = (await readBody(req)) as { path?: string; create?: boolean };
      if (!body.path || typeof body.path !== 'string') {
        sendJson(res, 400, { error: 'path required' });
        return true;
      }
      try {
        const { status, created } = await applyLedgerPath(
          state,
          body.path,
          Boolean(body.create),
        );
        sendJson(res, 200, { ...status, created });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err instanceof Error && 'code' in err
            ? String((err as Error & { code?: string }).code ?? '')
            : '';
        sendJson(res, 400, {
          error: message,
          code: code || undefined,
          createable: true,
        });
      }
      return true;
    }

    if (method === 'GET' && path === '/api/watch') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'hello', root: state.ledgerRoot })}\n\n`);
      state.sseClients.add(res);
      req.on('close', () => {
        state.sseClients.delete(res);
      });
      return true;
    }

    if (method === 'GET' && path === '/api/tasks') {
      const status = await inspectLedger(state.ledgerRoot);
      if (!status.ready) {
        sendJson(res, 400, {
          error: status.exists
            ? `not a ledger (missing tasks/): ${status.root}`
            : `ledger path does not exist: ${status.root}`,
          code: status.exists ? 'NOT_LEDGER' : 'ENOENT',
          createable: true,
        });
        return true;
      }
      const tasks = await listTasks(state.ledgerRoot);
      sendJson(res, 200, { tasks });
      return true;
    }

    if (method === 'POST' && path === '/api/push') {
      const body = (await readBody(req)) as {
        title?: string;
        lane?: string;
        estimate?: string;
        estimate_min?: number;
        project?: string;
        blocked_by?: string[];
        where?: 'top' | 'bottom';
      };
      if (!body.title || !body.lane) {
        sendJson(res, 400, { error: 'title and lane required' });
        return true;
      }
      const meta = await pushTask(state.ledgerRoot, {
        title: body.title,
        lane: body.lane,
        estimate: body.estimate,
        estimate_min: body.estimate_min,
        project: body.project,
        blocked_by: body.blocked_by,
        where: body.where ?? 'top',
        actor: ACTOR,
      });
      sendJson(res, 200, { task: meta });
      return true;
    }

    if (method === 'POST' && path === '/api/reorder') {
      const body = (await readBody(req)) as { id?: string; to?: number };
      if (!body.id || body.to == null || !Number.isFinite(body.to)) {
        sendJson(res, 400, { error: 'id and to required' });
        return true;
      }
      const meta = await reorderTask(state.ledgerRoot, body.id, body.to, ACTOR);
      sendJson(res, 200, { task: meta });
      return true;
    }

    if (method === 'POST' && path === '/api/reorder-index') {
      const body = (await readBody(req)) as { id?: string; toIndex?: number };
      if (!body.id || body.toIndex == null || !Number.isFinite(body.toIndex)) {
        sendJson(res, 400, { error: 'id and toIndex required' });
        return true;
      }
      const meta = await reorderToIndex(
        state.ledgerRoot,
        body.id,
        Math.trunc(body.toIndex),
        ACTOR,
      );
      sendJson(res, 200, { task: meta });
      return true;
    }

    if (method === 'POST' && path === '/api/move') {
      const body = (await readBody(req)) as { id?: string; dir?: 'up' | 'down' };
      if (!body.id || (body.dir !== 'up' && body.dir !== 'down')) {
        sendJson(res, 400, { error: 'id and dir (up|down) required' });
        return true;
      }
      const meta = await moveTask(state.ledgerRoot, body.id, body.dir, ACTOR);
      sendJson(res, 200, { task: meta });
      return true;
    }

    if (method === 'POST' && path === '/api/update') {
      const body = (await readBody(req)) as UpdateTaskPatch & { id?: string };
      if (!body.id) {
        sendJson(res, 400, { error: 'id required' });
        return true;
      }
      const { id, ...patch } = body;
      const meta = await updateTask(state.ledgerRoot, id, patch, ACTOR);
      sendJson(res, 200, { task: meta });
      return true;
    }

    if (method === 'POST' && path === '/api/complete-project') {
      const body = (await readBody(req)) as { project?: string };
      if (!body.project || typeof body.project !== 'string') {
        sendJson(res, 400, { error: 'project required' });
        return true;
      }
      const result = await completeProject(state.ledgerRoot, body.project, ACTOR);
      sendJson(res, 200, result);
      return true;
    }

    if (method === 'GET' && path === '/api/history') {
      const taskId = url.searchParams.get('task') ?? undefined;
      const events = await readHistory(state.ledgerRoot, taskId ?? undefined);
      sendJson(res, 200, { events });
      return true;
    }

    const taskMatch = /^\/api\/tasks\/([^/]+)$/.exec(path);
    if (method === 'GET' && taskMatch) {
      const id = decodeURIComponent(taskMatch[1]!);
      const { meta, body, path: filePath } = await readTaskFile(state.ledgerRoot, id);
      sendJson(res, 200, { task: meta, body, path: filePath });
      return true;
    }

    if (method === 'POST' && path === '/api/open') {
      const body = (await readBody(req)) as { id?: string };
      if (!body.id) {
        sendJson(res, 400, { error: 'id required' });
        return true;
      }
      const { path: filePath } = await readTaskFile(state.ledgerRoot, body.id);
      try {
        openLocalPath(filePath);
      } catch {
        /* ignore spawn errors — path still returned */
      }
      sendJson(res, 200, { path: filePath, opened: true });
      return true;
    }

    sendJson(res, 404, { error: `unknown api route ${method} ${path}` });
    return true;
  } catch (err) {
    sendError(res, err, 500);
    return true;
  }
}

