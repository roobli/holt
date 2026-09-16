import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendEvent, readEvents } from './history.ts';
import { formatTaskMarkdown, nextTaskId } from './format-task.ts';
import { parseTaskMarkdown, stackSort } from './parse-task.ts';
import type { HoltEvent, HoltStatus, HoltTaskMeta } from './types.ts';

export interface LedgerPaths {
  root: string;
  tasksDir: string;
  historyPath: string;
}

export function ledgerPaths(root: string): LedgerPaths {
  return {
    root,
    tasksDir: join(root, 'tasks'),
    historyPath: join(root, 'history.ndjson'),
  };
}

export async function ensureLedger(root: string): Promise<LedgerPaths> {
  const paths = ledgerPaths(root);
  await mkdir(paths.tasksDir, { recursive: true });
  return paths;
}

export async function listLedgerTasks(root: string): Promise<HoltTaskMeta[]> {
  const { tasksDir } = ledgerPaths(root);
  let names: string[];
  try {
    names = await readdir(tasksDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const tasks: HoltTaskMeta[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const raw = await readFile(join(tasksDir, name), 'utf8');
    const { meta } = parseTaskMarkdown(raw);
    tasks.push(meta);
  }
  return stackSort(tasks);
}

export async function readTaskFile(
  root: string,
  id: string,
): Promise<{ meta: HoltTaskMeta; body: string; path: string }> {
  const path = join(ledgerPaths(root).tasksDir, `${id}.md`);
  const raw = await readFile(path, 'utf8');
  const parsed = parseTaskMarkdown(raw);
  return { ...parsed, path };
}

export async function writeTaskFile(
  root: string,
  meta: HoltTaskMeta,
  body: string,
): Promise<string> {
  const paths = await ensureLedger(root);
  const path = join(paths.tasksDir, `${meta.id}.md`);
  await writeFile(path, formatTaskMarkdown(meta, body), 'utf8');
  return path;
}

export interface PushOptions {
  title: string;
  lane: string;
  estimate_min?: number;
  where?: 'top' | 'bottom';
  status?: HoltStatus;
  actor?: string;
  body?: string;
}

export async function pushTask(
  root: string,
  opts: PushOptions,
): Promise<HoltTaskMeta> {
  const paths = await ensureLedger(root);
  const existing = await listLedgerTasks(root);
  const id = nextTaskId(existing.map((t) => t.id));
  const where = opts.where ?? 'top';
  let stack_order: number;
  if (existing.length === 0) {
    stack_order = 10;
  } else if (where === 'top') {
    stack_order = Math.min(...existing.map((t) => t.stack_order)) - 10;
  } else {
    stack_order = Math.max(...existing.map((t) => t.stack_order)) + 10;
  }
  const now = new Date().toISOString();
  const meta: HoltTaskMeta = {
    id,
    title: opts.title,
    status: opts.status ?? 'open',
    lane: opts.lane,
    stack_order,
    estimate_min: opts.estimate_min,
    created_at: now,
    updated_at: now,
  };
  await writeTaskFile(root, meta, opts.body ?? '');
  await appendEvent(paths.historyPath, {
    time: now,
    event: 'created',
    task_id: id,
    actor: opts.actor ?? 'cli',
    data: {
      title: meta.title,
      stack_order: meta.stack_order,
      lane: meta.lane,
      status: meta.status,
      ...(meta.estimate_min != null ? { estimate_min: meta.estimate_min } : {}),
    },
  });
  return meta;
}

export async function reorderTask(
  root: string,
  id: string,
  toOrder: number,
  actor = 'cli',
): Promise<HoltTaskMeta> {
  const paths = ledgerPaths(root);
  const { meta, body } = await readTaskFile(root, id);
  const from = meta.stack_order;
  if (from === toOrder) return meta;
  const now = new Date().toISOString();
  meta.stack_order = toOrder;
  meta.updated_at = now;
  await writeTaskFile(root, meta, body);
  await appendEvent(paths.historyPath, {
    time: now,
    event: 'reordered',
    task_id: id,
    actor,
    data: { from, to: toOrder },
  });
  return meta;
}

export async function listHistory(
  root: string,
  taskId?: string,
): Promise<HoltEvent[]> {
  const events = await readEvents(ledgerPaths(root).historyPath);
  if (!taskId) return events;
  return events.filter((e) => e.task_id === taskId);
}
