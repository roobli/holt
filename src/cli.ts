#!/usr/bin/env node
/**
 * holt CLI — local-first ledger surface (file model).
 * Usage: holt <command> [ledger] [options]
 * Default ledger: ./sample
 */
import { resolve } from 'node:path';
import {
  completeProject,
  displayEstimate,
  filterTasksByProject,
  listTasks,
  pushTask,
  readHistory,
  reorderTask,
  updateTask,
  type UpdateTaskPatch,
} from './commands.ts';
import type { HoltStatus } from './core/types.ts';

function usage(): never {
  console.error(`holt — local task stack CLI

Usage:
  holt list [ledger] [--project <slug>]
  holt push [ledger] --title <t> --lane <lane> [--estimate 45m|2h|1d] [--project <slug>] [--blocked-by id,id] [--top|--bottom]
  holt update [ledger] <id> [--status s] [--lane l] [--title t] [--estimate 2h] [--project slug]
                          [--blocked-by id,id] [--add-blocked-by id] [--rm-blocked-by id]
  holt complete-project [ledger] <slug>
  holt reorder [ledger] <id> --to <stack_order>
  holt history [ledger] [--task <id>]

Default ledger: ./sample
Estimate: 45m / 2h / 1d (1d = 8h); bare number = minutes.
`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const args = [...argv];
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  while (args.length) {
    const a = args.shift()!;
    if (a === '--') {
      positional.push(...args);
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'top' || key === 'bottom' || key === 'help') {
        flags.set(key, true);
        continue;
      }
      const next = args[0];
      if (!next || next.startsWith('--')) {
        flags.set(key, true);
      } else {
        flags.set(key, args.shift()!);
      }
      continue;
    }
    positional.push(a);
  }
  return { flags, positional };
}

function flagStr(flags: Map<string, string | boolean>, key: string): string | undefined {
  const v = flags.get(key);
  return typeof v === 'string' ? v : undefined;
}

function defaultLedger(positionalRest: string[]): string {
  return resolve(positionalRest[0] ?? './sample');
}

/** Resolve ledger + trailing id when command is `cmd [ledger] <id>`. */
function ledgerAndId(rest: string[]): { ledger: string; id: string | undefined } {
  if (rest.length >= 2) {
    return { ledger: resolve(rest[0]!), id: rest[1] };
  }
  if (rest.length === 1) {
    if (/^T-\d+$/i.test(rest[0]!)) {
      return { ledger: resolve('./sample'), id: rest[0] };
    }
    return { ledger: resolve(rest[0]!), id: undefined };
  }
  return { ledger: resolve('./sample'), id: undefined };
}

function parseIdList(raw: string | undefined): string[] | undefined {
  if (raw == null) return undefined;
  if (raw.trim() === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const STATUSES = new Set<HoltStatus>(['open', 'doing', 'done', 'dropped']);

async function cmdList(
  ledger: string,
  flags: Map<string, string | boolean>,
): Promise<void> {
  const project = flagStr(flags, 'project');
  let tasks = await listTasks(ledger);
  tasks = filterTasksByProject(tasks, project);
  if (tasks.length === 0) {
    console.log('(empty stack)');
    return;
  }
  const rows = tasks.map((t) => ({
    order: t.stack_order,
    id: t.id,
    title: t.title,
    status: t.status,
    lane: t.lane,
    estimate: displayEstimate(t) ?? '',
    project: t.project ?? '',
  }));
  const headers = ['order', 'id', 'title', 'status', 'lane', 'estimate', 'project'] as const;
  const widths = Object.fromEntries(
    headers.map((h) => [
      h,
      Math.max(h.length, ...rows.map((r) => String(r[h]).length)),
    ]),
  ) as Record<(typeof headers)[number], number>;
  const line = (cols: Record<string, string | number>) =>
    headers.map((h) => String(cols[h]).padEnd(widths[h])).join('  ');
  console.log(line(Object.fromEntries(headers.map((h) => [h, h]))));
  console.log(headers.map((h) => '-'.repeat(widths[h])).join('  '));
  for (const r of rows) console.log(line(r));
}

async function cmdPush(
  ledger: string,
  flags: Map<string, string | boolean>,
): Promise<void> {
  const title = flagStr(flags, 'title');
  const lane = flagStr(flags, 'lane');
  if (!title || !lane) {
    console.error('push requires --title and --lane');
    process.exit(2);
  }
  const estimate = flagStr(flags, 'estimate');
  const project = flagStr(flags, 'project');
  const blocked_by = parseIdList(flagStr(flags, 'blocked-by'));
  const where = flags.has('bottom') ? 'bottom' : 'top';
  const meta = await pushTask(ledger, {
    title,
    lane,
    estimate,
    project,
    blocked_by,
    where,
    actor: 'cli',
  });
  const est = displayEstimate(meta);
  console.log(
    `created ${meta.id} order=${meta.stack_order} lane=${meta.lane}` +
      (est ? ` estimate=${est}` : '') +
      (meta.project ? ` project=${meta.project}` : ''),
  );
}

async function cmdUpdate(
  ledger: string,
  id: string | undefined,
  flags: Map<string, string | boolean>,
): Promise<void> {
  if (!id) {
    console.error('update requires <id>');
    process.exit(2);
  }
  const patch: UpdateTaskPatch = {};
  const statusRaw = flagStr(flags, 'status');
  if (statusRaw != null) {
    if (!STATUSES.has(statusRaw as HoltStatus)) {
      console.error(`--status must be one of ${[...STATUSES].join('|')}`);
      process.exit(2);
    }
    patch.status = statusRaw as HoltStatus;
  }
  const lane = flagStr(flags, 'lane');
  if (lane != null) patch.lane = lane;
  const title = flagStr(flags, 'title');
  if (title != null) patch.title = title;
  if (flags.has('estimate')) {
    if (flags.get('estimate') === true) {
      console.error('--estimate requires a value (use empty string "" to clear)');
      process.exit(2);
    }
    patch.estimate = flagStr(flags, 'estimate') ?? null;
  }
  if (flags.has('project')) {
    if (flags.get('project') === true) {
      patch.project = null;
    } else {
      patch.project = flagStr(flags, 'project') ?? null;
    }
  }
  if (flags.has('blocked-by')) {
    if (flags.get('blocked-by') === true) {
      patch.blocked_by = [];
    } else {
      patch.blocked_by = parseIdList(flagStr(flags, 'blocked-by')) ?? [];
    }
  }
  const addBb = parseIdList(flagStr(flags, 'add-blocked-by'));
  if (addBb) patch.add_blocked_by = addBb;
  const rmBb = parseIdList(flagStr(flags, 'rm-blocked-by'));
  if (rmBb) patch.rm_blocked_by = rmBb;

  if (Object.keys(patch).length === 0) {
    console.error('update requires at least one flag');
    process.exit(2);
  }
  const meta = await updateTask(ledger, id, patch, 'cli');
  console.log(`updated ${meta.id} status=${meta.status}` +
    (displayEstimate(meta) ? ` estimate=${displayEstimate(meta)}` : '') +
    (meta.project ? ` project=${meta.project}` : '') +
    (meta.blocked_by?.length ? ` blocked_by=${meta.blocked_by.join(',')}` : ''));
}

async function cmdCompleteProject(
  ledger: string,
  slug: string | undefined,
): Promise<void> {
  if (!slug) {
    console.error('complete-project requires <slug>');
    process.exit(2);
  }
  const result = await completeProject(ledger, slug, 'cli');
  if (result.task_ids.length === 0) {
    console.log(`project ${result.project}: nothing to complete`);
    return;
  }
  console.log(
    `completed project ${result.project} (${result.task_ids.length}): ${result.task_ids.join(', ')}`,
  );
}

async function cmdReorder(
  ledger: string,
  id: string | undefined,
  flags: Map<string, string | boolean>,
): Promise<void> {
  if (!id) {
    console.error('reorder requires <id>');
    process.exit(2);
  }
  const toRaw = flagStr(flags, 'to');
  if (toRaw == null) {
    console.error('reorder requires --to <stack_order>');
    process.exit(2);
  }
  const to = Number(toRaw);
  if (!Number.isFinite(to)) {
    console.error('--to must be a number');
    process.exit(2);
  }
  const meta = await reorderTask(ledger, id, to, 'cli');
  console.log(`reordered ${meta.id} → ${meta.stack_order}`);
}

async function cmdHistory(
  ledger: string,
  flags: Map<string, string | boolean>,
): Promise<void> {
  const taskId = flagStr(flags, 'task');
  const events = await readHistory(ledger, taskId);
  if (events.length === 0) {
    console.log('(no history)');
    return;
  }
  for (const e of events) {
    const data = e.data ? ` ${JSON.stringify(e.data)}` : '';
    console.log(`${e.time}  ${e.event}  ${e.task_id}${data}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) usage();
  const { flags, positional } = parseArgs(argv);
  if (flags.has('help')) usage();
  const [cmd, ...rest] = positional;
  if (!cmd) usage();

  switch (cmd) {
    case 'list': {
      // holt list [ledger] [--project x] — ledger is first positional if not looking like a flag
      await cmdList(defaultLedger(rest), flags);
      break;
    }
    case 'push': {
      await cmdPush(defaultLedger(rest), flags);
      break;
    }
    case 'update': {
      const { ledger, id } = ledgerAndId(rest);
      await cmdUpdate(ledger, id, flags);
      break;
    }
    case 'complete-project': {
      // holt complete-project [ledger] <slug>
      let ledger: string;
      let slug: string | undefined;
      if (rest.length >= 2) {
        ledger = resolve(rest[0]!);
        slug = rest[1];
      } else if (rest.length === 1) {
        ledger = resolve('./sample');
        slug = rest[0];
      } else {
        ledger = resolve('./sample');
        slug = undefined;
      }
      await cmdCompleteProject(ledger, slug);
      break;
    }
    case 'reorder': {
      const { ledger, id } = ledgerAndId(rest);
      await cmdReorder(ledger, id, flags);
      break;
    }
    case 'history': {
      await cmdHistory(defaultLedger(rest), flags);
      break;
    }
    default:
      console.error(`unknown command: ${cmd}`);
      usage();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
