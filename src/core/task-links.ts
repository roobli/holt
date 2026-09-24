/**
 * Soft task links in Markdown body: @{T-xxxx}
 * Clickable navigation in GUI Detail — NOT hard deps (blocked_by).
 */

/** Matches @{T-1234} (case-insensitive T; digits preserved as written). */
export const TASK_LINK_RE = /@\{(T-\d+)\}/gi;

export type TaskLinkSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; id: string; raw: string };

/** Normalize id casing to T-#### (digits unchanged). */
export function normalizeTaskId(id: string): string {
  const m = /^T-(\d+)$/i.exec(id.trim());
  if (!m) return id.trim();
  return `T-${m[1]}`;
}

/** Ordered unique ids referenced by soft links in body. */
export function extractTaskLinkIds(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  TASK_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TASK_LINK_RE.exec(body)) !== null) {
    const id = normalizeTaskId(m[1]!);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Split body into plain text and soft-link segments (for rendering). */
export function splitTaskLinks(body: string): TaskLinkSegment[] {
  const segments: TaskLinkSegment[] = [];
  TASK_LINK_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TASK_LINK_RE.exec(body)) !== null) {
    if (m.index > last) {
      segments.push({ kind: 'text', text: body.slice(last, m.index) });
    }
    const id = normalizeTaskId(m[1]!);
    segments.push({ kind: 'link', id, raw: m[0]! });
    last = m.index + m[0]!.length;
  }
  if (last < body.length) {
    segments.push({ kind: 'text', text: body.slice(last) });
  }
  return segments;
}

/**
 * Escape body text and turn @{T-xxxx} into HTML controls.
 * Known ids → clickable button (data-select-task); unknown → muted span.
 */
export function renderTaskBodyHtml(
  body: string,
  knownIds: ReadonlySet<string>,
  escape: (s: string) => string,
): string {
  if (!body) return '';
  return splitTaskLinks(body)
    .map((seg) => {
      if (seg.kind === 'text') return escape(seg.text);
      const known = knownIds.has(seg.id);
      if (known) {
        return `<button type="button" class="task-link" data-select-task="${escape(seg.id)}" title="任务链接 ${escape(seg.id)}">${escape(seg.raw)}</button>`;
      }
      return `<span class="task-link is-unknown" title="未知任务 ${escape(seg.id)}">${escape(seg.raw)}</span>`;
    })
    .join('');
}
