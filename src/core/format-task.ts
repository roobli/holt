import type { HoltTaskMeta } from './types.ts';

function yamlScalar(v: unknown): string {
  if (v === undefined || v === null) return '""';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]`;
  }
  const s = String(v);
  if (/[:#\n"'{}[\],&*?|>!%@`]/.test(s) || s === '' || /^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/** Serialize task meta + body to Markdown with YAML frontmatter (minimal writer). */
export function formatTaskMarkdown(meta: HoltTaskMeta, body = ''): string {
  const lines: string[] = ['---'];
  const order: (keyof HoltTaskMeta)[] = [
    'id',
    'title',
    'status',
    'lane',
    'stack_order',
    'estimate',
    'estimate_min',
    'blocked_by',
    'project',
    'due',
    'owner',
    'watchers',
    'created_at',
    'updated_at',
  ];
  for (const key of order) {
    const val = meta[key];
    if (val === undefined) continue;
    lines.push(`${key}: ${yamlScalar(val)}`);
  }
  if (meta.hooks) {
    lines.push('hooks:');
    lines.push(`  pre: ${yamlScalar(meta.hooks.pre ?? [])}`);
    lines.push(`  post: ${yamlScalar(meta.hooks.post ?? [])}`);
  }
  lines.push('---');
  const trimmed = body.replace(/^\n+/, '').replace(/\s+$/, '');
  return trimmed ? `${lines.join('\n')}\n\n${trimmed}\n` : `${lines.join('\n')}\n`;
}

export function nextTaskId(existingIds: readonly string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = /^T-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `T-${String(max + 1).padStart(4, '0')}`;
}
