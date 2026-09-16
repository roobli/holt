#!/usr/bin/env node
/**
 * holt CLI — local-first ledger surface (file model).
 * Usage: holt <command> [ledger] [options]
 * Default ledger: ./sample
 */
import { resolve } from 'node:path';
import {
  listTasks,
  pushTask,
  readHistory,
  reorderTask,
} from './commands.ts';

function usage(): never {
  console.error(`holt — local task stack CLI

Usage:
  holt list [ledger]
  holt push [ledger] --title <t> --lane <lane> [--estimate N] [--top|--bottom]
  holt reorder [ledger] <id> --to <stack_order>
  holt history [ledger] [--task <id>]

Default ledger: ./sample
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

async function cmdList(ledger: string): Promise<void> {
  const tasks = await listTasks(ledger);
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
    estimate: t.estimate_min ?? '',
  }));
  const headers = ['order', 'id', 'title', 'status', 'lane', 'estimate'] as const;
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
  const estimateRaw = flagStr(flags, 'estimate');
  const estimate_min = estimateRaw != null ? Number(estimateRaw) : undefined;
  if (estimateRaw != null && !Number.isFinite(estimate_min)) {
    console.error('--estimate must be a number');
    process.exit(2);
  }
  const where = flags.has('bottom') ? 'bottom' : 'top';
  const meta = await pushTask(ledger, {
    title,
    lane,
    estimate_min,
    where,
    actor: 'cli',
  });
  console.log(`created ${meta.id} order=${meta.stack_order} lane=${meta.lane}`);
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
      await cmdList(defaultLedger(rest));
      break;
    }
    case 'push': {
      await cmdPush(defaultLedger(rest), flags);
      break;
    }
    case 'reorder': {
      // holt reorder [ledger] <id> --to N  OR  holt reorder <id> --to N
      let ledger: string;
      let id: string | undefined;
      if (rest.length >= 2) {
        ledger = resolve(rest[0]);
        id = rest[1];
      } else if (rest.length === 1) {
        // ambiguous: could be ledger or id — if looks like T-#### treat as id
        if (/^T-\d+$/i.test(rest[0])) {
          ledger = resolve('./sample');
          id = rest[0];
        } else {
          ledger = resolve(rest[0]);
          id = undefined;
        }
      } else {
        ledger = resolve('./sample');
        id = undefined;
      }
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
