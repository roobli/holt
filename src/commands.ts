/**
 * Shared ledger commands — CLI and local GUI adapters call these only.
 * Write rules live in src/core/ledger.ts; this module is the stable surface.
 */
import { accessSync, existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join as pathJoin } from 'node:path';
import {
  listLedgerTasks,
  listHistory,
  pushTask as pushTaskCore,
  reorderTask as reorderTaskCore,
  reorderTaskUnlocked,
  mutateLedger,
  readTaskFile,
  writeTaskFile,
  ensureLedger,
  ledgerPaths,
  inspectLedger,
  dedupeBlockedBy,
  openBlockersOf,
  formatBlockedDoneError,
  type PushOptions,
  type LedgerPaths,
  type LedgerStatus,
} from './core/ledger.ts';
import { applyEstimateDualWrite, displayEstimate } from './core/estimate.ts';
import { appendEvent } from './core/history.ts';
import type { HoltEvent, HoltStatus, HoltTaskMeta } from './core/types.ts';

export type { HoltEvent, HoltStatus, HoltTaskMeta, PushOptions, LedgerPaths, LedgerStatus };
export {
  readTaskFile,
  writeTaskFile,
  ensureLedger,
  ledgerPaths,
  inspectLedger,
  displayEstimate,
  openBlockersOf,
  formatBlockedDoneError,
};

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
  return mutateLedger(root, async ({ listLedgerTasks }) => {
    const tasks = await listLedgerTasks(root);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`unknown task: ${id}`);
    const swapWith = dir === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= tasks.length) return tasks[idx]!;
    const a = tasks[idx]!;
    const b = tasks[swapWith]!;
    const aOrder = a.stack_order;
    const bOrder = b.stack_order;
    await reorderTaskUnlocked(root, b.id, aOrder, actor);
    return reorderTaskUnlocked(root, a.id, bOrder, actor);
  });
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
  return mutateLedger(root, async ({ listLedgerTasks }) => {
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
            await reorderTaskUnlocked(root, t.id, want, actor);
          }
        }
        return (await listLedgerTasks(root)).find((t) => t.id === id)!;
      }
    }
    return reorderTaskUnlocked(root, id, newOrder, actor);
  });
}

export interface UpdateTaskPatch {
  status?: HoltStatus;
  lane?: string;
  title?: string;
  /** Duration with unit; dual-writes estimate_min. null clears both. */
  estimate?: string | null;
  /** Legacy; prefer estimate. null clears. Ignored if estimate is set. */
  estimate_min?: number | null;
  /** Replace entire blocked_by list; null/[] clears. */
  blocked_by?: string[] | null;
  add_blocked_by?: string[];
  rm_blocked_by?: string[];
  /** Project slug; null or '' clears. */
  project?: string | null;
}

function sameStringList(a: string[] | undefined, b: string[]): boolean {
  const aa = a ?? [];
  if (aa.length !== b.length) return false;
  return aa.every((v, i) => v === b[i]);
}

export async function updateTask(
  root: string,
  id: string,
  patch: UpdateTaskPatch,
  actor = 'cli',
): Promise<HoltTaskMeta> {
  return mutateLedger(root, async ({ readTaskFile, writeTaskFile, ledgerPaths, appendEvent, listLedgerTasks }) => {
    const { meta, body } = await readTaskFile(root, id);
    const all = await listLedgerTasks(root);
    const known = new Set(all.map((t) => t.id));
    const data: Record<string, unknown> = {};

    if (patch.status != null && patch.status !== meta.status) {
      if (patch.status === 'done') {
        const open = openBlockersOf(meta, all);
        if (open.length) throw new Error(formatBlockedDoneError(open));
      }
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

    if (patch.estimate !== undefined) {
      if (patch.estimate === null || patch.estimate.trim() === '') {
        if (meta.estimate != null || meta.estimate_min != null) {
          delete meta.estimate;
          delete meta.estimate_min;
          data.estimate = null;
          data.estimate_min = null;
        }
      } else {
        const before = meta.estimate;
        const beforeMin = meta.estimate_min;
        applyEstimateDualWrite(meta, patch.estimate);
        if (meta.estimate !== before || meta.estimate_min !== beforeMin) {
          data.estimate = meta.estimate;
          data.estimate_min = meta.estimate_min;
        }
      }
    } else if (patch.estimate_min !== undefined) {
      const next = patch.estimate_min === null ? undefined : patch.estimate_min;
      if (next !== meta.estimate_min) {
        meta.estimate_min = next;
        data.estimate_min = next ?? null;
      }
    }

    let nextBlocked = meta.blocked_by ? [...meta.blocked_by] : [];
    let blockedTouched = false;
    if (patch.blocked_by !== undefined) {
      blockedTouched = true;
      nextBlocked =
        patch.blocked_by === null || patch.blocked_by.length === 0
          ? []
          : dedupeBlockedBy(patch.blocked_by, id, known);
    }
    if (patch.add_blocked_by?.length) {
      blockedTouched = true;
      nextBlocked = dedupeBlockedBy([...nextBlocked, ...patch.add_blocked_by], id, known);
    }
    if (patch.rm_blocked_by?.length) {
      blockedTouched = true;
      const rm = new Set(patch.rm_blocked_by.map((x) => x.trim()).filter(Boolean));
      nextBlocked = nextBlocked.filter((x) => !rm.has(x));
    }
    if (blockedTouched && !sameStringList(meta.blocked_by, nextBlocked)) {
      if (nextBlocked.length === 0) delete meta.blocked_by;
      else meta.blocked_by = nextBlocked;
      data.blocked_by = nextBlocked;
    }

    if (patch.project !== undefined) {
      const next =
        patch.project === null || patch.project.trim() === ''
          ? undefined
          : patch.project.trim();
      if (next !== meta.project) {
        if (next === undefined) delete meta.project;
        else meta.project = next;
        data.project = next ?? null;
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
  });
}

export interface CompleteProjectResult {
  project: string;
  task_ids: string[];
}

/**
 * Mark all open/doing tasks in a project as done (all-or-nothing).
 * Each task uses the same done / blocked_by check as updateTask —
 * co-membership in the batch does NOT clear blockers.
 */
export async function completeProject(
  root: string,
  project: string,
  actor = 'cli',
): Promise<CompleteProjectResult> {
  const slug = project.trim();
  if (!slug) throw new Error('project slug required');

  return mutateLedger(root, async ({ listLedgerTasks, readTaskFile, writeTaskFile, ledgerPaths, appendEvent }) => {
    const all = await listLedgerTasks(root);
    const targets = all.filter(
      (t) => t.project === slug && (t.status === 'open' || t.status === 'doing'),
    );
    if (targets.length === 0) {
      return { project: slug, task_ids: [] };
    }

    const failures: string[] = [];
    for (const t of targets) {
      const open = openBlockersOf(t, all);
      if (open.length) {
        failures.push(`${t.id}：${formatBlockedDoneError(open)}`);
      }
    }
    if (failures.length) {
      throw new Error(`无法完成 project（全有或全无）：${failures.join('；')}`);
    }

    const now = new Date().toISOString();
    const task_ids = targets.map((t) => t.id);
    await appendEvent(ledgerPaths(root).historyPath, {
      time: now,
      event: 'project_completed',
      task_id: '*',
      actor,
      data: { project: slug, task_ids },
    });

    for (const t of targets) {
      const { meta, body } = await readTaskFile(root, t.id);
      if (meta.status === 'done') continue;
      meta.status = 'done';
      meta.updated_at = now;
      await writeTaskFile(root, meta, body);
      await appendEvent(ledgerPaths(root).historyPath, {
        time: now,
        event: 'updated',
        task_id: t.id,
        actor,
        data: { status: 'done', via: 'project_completed', project: slug },
      });
    }

    return { project: slug, task_ids };
  });
}

/** Filter helper used by CLI list --project. */
export function filterTasksByProject(
  tasks: readonly HoltTaskMeta[],
  project: string | undefined,
): HoltTaskMeta[] {
  if (project == null || project === '') return [...tasks];
  return tasks.filter((t) => t.project === project);
}

export interface OpenTaskBodyOptions {
  /** Override $EDITOR / $VISUAL (e.g. CLI --editor). */
  editor?: string;
  /**
   * When true (default), wait for EDITOR to exit.
   * Platform openers (xdg-open / open / Noto) are always detached.
   */
  wait?: boolean;
  /**
   * Override Noto.app detection (tests). Absolute path to Noto.app,
   * or `null` to skip the Noto probe even on macOS.
   */
  notoApp?: string | null;
  /** Override platform (tests). */
  platform?: NodeJS.Platform;
  /** Override home directory for Noto probe (tests). */
  home?: string;
}

/**
 * Prefer Noto on macOS when installed (Applications or ~/Applications).
 * Returns the .app path, or null if not found / not darwin.
 */
export function detectNotoApp(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string | null {
  if (platform !== 'darwin') return null;
  const candidates = [
    '/Applications/Noto.app',
    pathJoin(home, 'Applications', 'Noto.app'),
  ];
  for (const c of candidates) {
    try {
      accessSync(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** True when a platform file opener is likely to do something visible. */
export function canUsePlatformOpener(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === 'darwin' || platform === 'win32') return true;
  // Linux/BSD: xdg-open needs a session display; headless boxes no-op.
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/**
 * Resolve task md path and open with:
 *   1. --editor / $EDITOR / $VISUAL
 *   2. macOS: Noto.app if installed (`open -a`)
 *   3. platform default (`open` / `xdg-open` / `start`)
 * (same behavior as the GUI Detail “Open body / 打开正文” CTA).
 * Headless (no DISPLAY/WAYLAND and no editor): returns opened=false, via=none.
 */
export async function openTaskBody(
  root: string,
  id: string,
  opts: OpenTaskBodyOptions = {},
): Promise<{ path: string; opened: boolean; via: string }> {
  const { path } = await readTaskFile(root, id);
  const editor = opts.editor?.trim() || process.env.EDITOR || process.env.VISUAL;
  if (editor) {
    const wait = opts.wait !== false;
    // EDITOR / --editor is a shell command line; path is appended as one argv.
    const cmdline = `${editor} ${JSON.stringify(path)}`;
    if (wait) {
      const result = spawnSync(cmdline, { stdio: 'inherit', shell: true });
      if (result.error) throw result.error;
      if (result.status != null && result.status !== 0) {
        throw new Error(`editor exited ${result.status}: ${editor}`);
      }
    } else {
      spawn(cmdline, { detached: true, stdio: 'ignore', shell: true }).unref();
    }
    return { path, opened: true, via: 'editor' };
  }

  const platform = opts.platform ?? process.platform;
  if (!canUsePlatformOpener(process.env, platform)) {
    return { path, opened: false, via: 'none' };
  }

  try {
    if (platform === 'darwin') {
      const noto =
        opts.notoApp === null
          ? null
          : opts.notoApp !== undefined
            ? opts.notoApp
            : detectNotoApp(platform, opts.home ?? homedir());
      if (noto && existsSync(noto)) {
        // Detached open -a: stable on Mac (does not wait; prefers Noto over TextEdit).
        spawn('open', ['-a', noto, path], { detached: true, stdio: 'ignore' }).unref();
        return { path, opened: true, via: 'noto' };
      }
      spawn('open', [path], { detached: true, stdio: 'ignore' }).unref();
      return { path, opened: true, via: 'platform' };
    }
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', path], { detached: true, stdio: 'ignore' }).unref();
      return { path, opened: true, via: 'platform' };
    }
    spawn('xdg-open', [path], { detached: true, stdio: 'ignore' }).unref();
    return { path, opened: true, via: 'platform' };
  } catch {
    return { path, opened: false, via: 'none' };
  }
}


/** Enriched inspect for CLI / scripts (does not mutate). */
export async function inspectLedgerDetailed(root: string): Promise<{
  root: string;
  tasksDir: string;
  historyPath: string;
  exists: boolean;
  ready: boolean;
  task_count: number;
  history_exists: boolean;
}> {
  const status = await inspectLedger(root);
  let task_count = 0;
  let history_exists = false;
  if (status.ready) {
    task_count = (await listTasks(root)).length;
  }
  try {
    await access(status.historyPath);
    history_exists = true;
  } catch {
    /* */
  }
  return {
    root: status.root,
    tasksDir: status.tasksDir,
    historyPath: status.historyPath,
    exists: status.exists,
    ready: status.ready,
    task_count,
    history_exists,
  };
}
