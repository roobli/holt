import { access, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { appendEvent, readEvents } from './history.ts';
import { formatTaskMarkdown, nextTaskId } from './format-task.ts';
import { parseTaskMarkdown, stackSort } from './parse-task.ts';
import { withLedgerLock } from './lock.ts';
import type { HoltEvent, HoltStatus, HoltTaskMeta } from './types.ts';

export interface LedgerPaths {
  root: string;
  tasksDir: string;
  historyPath: string;
}

export interface LedgerStatus extends LedgerPaths {
  /** Absolute resolved root */
  root: string;
  /** Root directory exists */
  exists: boolean;
  /** Usable ledger: tasks/ present */
  ready: boolean;
}

export function ledgerPaths(root: string): LedgerPaths {
  const abs = resolve(root);
  return {
    root: abs,
    tasksDir: join(abs, 'tasks'),
    historyPath: join(abs, 'history.ndjson'),
  };
}

/** Inspect whether path is a usable ledger (does not create). */
export async function inspectLedger(root: string): Promise<LedgerStatus> {
  const paths = ledgerPaths(root);
  let exists = false;
  let ready = false;
  try {
    await access(paths.root);
    exists = true;
  } catch {
    /* */
  }
  if (exists) {
    try {
      await access(paths.tasksDir);
      ready = true;
    } catch {
      /* */
    }
  }
  return { ...paths, exists, ready };
}

/**
 * Ensure tasks/ exists and history.ndjson is present (empty ok).
 * Creates parent dirs as needed.
 */
export async function ensureLedger(root: string): Promise<LedgerPaths> {
  const paths = ledgerPaths(root);
  await mkdir(paths.tasksDir, { recursive: true });
  try {
    await access(paths.historyPath);
  } catch {
    await writeFile(paths.historyPath, '', 'utf8');
  }
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
    if (name.endsWith('.tmp')) continue;
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

/** Atomic replace: write temp beside target, then rename. */
export async function writeTaskFile(
  root: string,
  meta: HoltTaskMeta,
  body: string,
): Promise<string> {
  const paths = await ensureLedger(root);
  const path = join(paths.tasksDir, `${meta.id}.md`);
  const tmp = join(
    paths.tasksDir,
    `.${meta.id}.${process.pid}.${Date.now()}.tmp`,
  );
  const content = formatTaskMarkdown(meta, body);
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
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
  return withLedgerLock(root, async () => {
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
  });
}

export async function reorderTask(
  root: string,
  id: string,
  toOrder: number,
  actor = 'cli',
): Promise<HoltTaskMeta> {
  return withLedgerLock(root, async () => {
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
  });
}

/**
 * Run a multi-step mutation under one ledger lock (e.g. move / rebalance).
 * Nested withLedgerLock in push/reorder would deadlock — use unlocked helpers inside.
 */
export async function mutateLedger<T>(
  root: string,
  fn: (unlocked: {
    writeTaskFile: typeof writeTaskFile;
    appendEvent: typeof appendEvent;
    readTaskFile: typeof readTaskFile;
    listLedgerTasks: typeof listLedgerTasks;
    ledgerPaths: typeof ledgerPaths;
    ensureLedger: typeof ensureLedger;
  }) => Promise<T>,
): Promise<T> {
  return withLedgerLock(root, () =>
    fn({
      writeTaskFile,
      appendEvent,
      readTaskFile,
      listLedgerTasks,
      ledgerPaths,
      ensureLedger,
    }),
  );
}

/** Unlocked reorder for use inside mutateLedger. */
export async function reorderTaskUnlocked(
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
