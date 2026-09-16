import type { HoltTaskMeta } from './types.ts';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Minimal YAML subset for our known scalar/list fields — enough for tests. */
export function parseTaskMarkdown(raw: string): { meta: HoltTaskMeta; body: string } {
  const m = FRONTMATTER.exec(raw);
  if (!m) throw new Error('HOLT_TASK_NO_FRONTMATTER');
  const yaml = m[1];
  const body = m[2] ?? '';
  const meta: Record<string, unknown> = {};
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val === '[]') {
      meta[key] = [];
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(val)) {
      meta[key] = Number(val);
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  // hooks block ignored in this tiny parser; open files still round-trip via full YAML later
  const required = ['id', 'title', 'status', 'lane', 'stack_order', 'created_at', 'updated_at'] as const;
  for (const k of required) {
    if (meta[k] === undefined || meta[k] === '') throw new Error(`HOLT_TASK_MISSING_${k}`);
  }
  return { meta: meta as unknown as HoltTaskMeta, body };
}

export function stackSort(tasks: readonly HoltTaskMeta[]): HoltTaskMeta[] {
  return [...tasks].sort((a, b) => a.stack_order - b.stack_order || a.id.localeCompare(b.id));
}
