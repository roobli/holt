/**
 * Tiny local HTTP API over shared ledger commands (filesystem).
 * Used by gui/dev.ts as /api/* middleware.
 */
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listTasks,
  moveTask,
  pushTask,
  readHistory,
  readTaskFile,
  reorderTask,
  reorderToIndex,
  updateTask,
  ledgerPaths,
  type UpdateTaskPatch,
} from '../src/commands.ts';

const ACTOR = 'gui';

export interface GuiApiState {
  /** Absolute ledger root */
  ledgerRoot: string;
}

export function createApiState(defaultLedger: string): GuiApiState {
  return { ledgerRoot: resolve(defaultLedger) };
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
  const status =
    message.startsWith('unknown task') || message.includes('ENOENT') ? 404 : fallback;
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
      sendJson(res, 200, {
        root: state.ledgerRoot,
        tasksDir: ledgerPaths(state.ledgerRoot).tasksDir,
        historyPath: ledgerPaths(state.ledgerRoot).historyPath,
      });
      return true;
    }

    if (method === 'POST' && path === '/api/ledger') {
      const body = (await readBody(req)) as { path?: string };
      if (!body.path || typeof body.path !== 'string') {
        sendJson(res, 400, { error: 'path required' });
        return true;
      }
      state.ledgerRoot = resolve(body.path);
      sendJson(res, 200, { root: state.ledgerRoot });
      return true;
    }

    if (method === 'GET' && path === '/api/tasks') {
      const tasks = await listTasks(state.ledgerRoot);
      sendJson(res, 200, { tasks });
      return true;
    }

    if (method === 'POST' && path === '/api/push') {
      const body = (await readBody(req)) as {
        title?: string;
        lane?: string;
        estimate_min?: number;
        where?: 'top' | 'bottom';
      };
      if (!body.title || !body.lane) {
        sendJson(res, 400, { error: 'title and lane required' });
        return true;
      }
      const meta = await pushTask(state.ledgerRoot, {
        title: body.title,
        lane: body.lane,
        estimate_min: body.estimate_min,
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
