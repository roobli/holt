/**
 * Shared ledger commands — CLI and local GUI adapters call these only.
 * Write rules live in src/core/ledger.ts; this module is the stable surface.
 */
import {
  listLedgerTasks,
  listHistory,
  pushTask as pushTaskCore,
  reorderTask as reorderTaskCore,
  readTaskFile,
  writeTaskFile,
  ensureLedger,
  ledgerPaths,
  type PushOptions,
  type LedgerPaths,
} from './core/ledger.ts';
import { appendEvent } from './core/history.ts';
import type { HoltEvent, HoltStatus, HoltTaskMeta } from './core/types.ts';

export type { HoltEvent, HoltStatus, HoltTaskMeta, PushOptions, LedgerPaths };
export { readTaskFile, writeTaskFile, ensureLedger, ledgerPaths };

export const listTasks = listLedgerTasks;
export const readHistory = listHistory;

/** Push with actor defaulting to cli (GUI passes actor: 'gui'). */
export async function pushTask(
  root: string,
  opts: PushOptions & { actor?: string },
): Promise<HoltTaskMeta> {
  return pushTaskCore(root, { ...opts, actor: opts.actor ?? 'cli' });
}

export async function reorderTask(
  root: string,
  id: string,
  toOrder: number,
  actor = 'cli',
): Promise<HoltTaskMeta> {
  return reorderTaskCore(root, id, toOrder, actor);
}

/** Swap with neighbor (up = toward stack top / lower stack_order). */
export async function moveTask(
  root: string,
  id: string,
  dir: 'up' | 'down',
  actor = 'cli',
): Promise<HoltTaskMeta> {
  const tasks = await listLedgerTasks(root);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) throw new Error(`unknown task: ${id}`);
  const swapWith = dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= tasks.length) return tasks[idx]!;
  const a = tasks[idx]!;
  const b = tasks[swapWith]!;
  const aOrder = a.stack_order;
  const bOrder = b.stack_order;
  await reorderTaskCore(root, b.id, aOrder, actor);
  return reorderTaskCore(root, a.id, bOrder, actor);
}

/**
 * Place task at index among current stack (0 = top).
 * Uses neighbor gap order; rebalances to 10,20,… if midpoint collides.
 */
export async function reorderToIndex(
  root: string,
  id: string,
  toIndex: number,
  actor = 'cli',
): Promise<HoltTaskMeta> {
  const tasks = await listLedgerTasks(root);
  const fromIndex = tasks.findIndex((t) => t.id === id);
  if (fromIndex < 0) throw new Error(`unknown task: ${id}`);
  if (fromIndex === toIndex) return tasks[fromIndex]!;

  const without = tasks.filter((t) => t.id !== id);
  const clamped = Math.max(0, Math.min(without.length, toIndex));
  const moving = tasks[fromIndex]!;

  let newOrder: number;
  if (without.length === 0) {
    newOrder = 10;
  } else if (clamped === 0) {
    newOrder = without[0]!.stack_order - 10;
  } else if (clamped >= without.length) {
    newOrder = without[without.length - 1]!.stack_order + 10;
  } else {
    const before = without[clamped - 1]!.stack_order;
    const after = without[clamped]!.stack_order;
    newOrder = Math.trunc((before + after) / 2);
    if (newOrder <= before || newOrder >= after) {
      const ordered = [...without];
      ordered.splice(clamped, 0, moving);
      for (let i = 0; i < ordered.length; i++) {
        const t = ordered[i]!;
        const want = (i + 1) * 10;
        if (t.stack_order !== want) {
          await reorderTaskCore(root, t.id, want, actor);
        }
      }
      return (await listLedgerTasks(root)).find((t) => t.id === id)!;
    }
  }
  return reorderTaskCore(root, id, newOrder, actor);
}

export interface UpdateTaskPatch {
  status?: HoltStatus;
  lane?: string;
  title?: string;
  estimate_min?: number | null;
}

export async function updateTask(
  root: string,
  id: string,
  patch: UpdateTaskPatch,
  actor = 'cli',
): Promise<HoltTaskMeta> {
  const { meta, body } = await readTaskFile(root, id);
  const data: Record<string, unknown> = {};
  if (patch.status != null && patch.status !== meta.status) {
    meta.status = patch.status;
    data.status = patch.status;
  }
  if (patch.lane != null && patch.lane !== meta.lane) {
    meta.lane = patch.lane;
    data.lane = patch.lane;
  }
  if (patch.title != null && patch.title !== meta.title) {
    meta.title = patch.title;
    data.title = patch.title;
  }
  if (patch.estimate_min !== undefined) {
    const next = patch.estimate_min === null ? undefined : patch.estimate_min;
    if (next !== meta.estimate_min) {
      meta.estimate_min = next;
      data.estimate_min = next ?? null;
    }
  }
  if (Object.keys(data).length === 0) return meta;
  const now = new Date().toISOString();
  meta.updated_at = now;
  await writeTaskFile(root, meta, body);
  await appendEvent(ledgerPaths(root).historyPath, {
    time: now,
    event: 'updated',
    task_id: id,
    actor,
    data,
  });
  return meta;
}
