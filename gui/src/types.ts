export type HoltStatus = 'open' | 'doing' | 'done' | 'dropped';
export type LaneId = 'personal' | 'work' | 'openjobs';
export type LaneFilter = 'all' | LaneId;
export type ProjectFilter = 'all' | string;

export interface HoltTaskMeta {
  id: string;
  title: string;
  status: HoltStatus;
  lane: string;
  stack_order: number;
  estimate?: string;
  estimate_min?: number;
  blocked_by?: string[];
  project?: string;
  hooks?: { pre?: unknown[]; post?: unknown[] };
  created_at: string;
  updated_at: string;
}

export interface HoltEvent {
  time: string;
  event: string;
  task_id: string;
  actor?: string;
  data?: Record<string, unknown>;
}

/** Prefer raw estimate; fallback legacy minutes → Nm. */
export function displayEstimate(meta: {
  estimate?: string;
  estimate_min?: number;
}): string | undefined {
  if (meta.estimate != null && String(meta.estimate).trim() !== '') {
    return String(meta.estimate).trim();
  }
  if (meta.estimate_min != null && Number.isFinite(meta.estimate_min)) {
    return `${meta.estimate_min}m`;
  }
  return undefined;
}

/** Minutes for block height. */
export function estimateMinutesOf(meta: {
  estimate?: string;
  estimate_min?: number;
}): number | undefined {
  if (meta.estimate != null && String(meta.estimate).trim() !== '') {
    const m = /^\s*(\d+(?:\.\d+)?)\s*([mhd])?\s*$/i.exec(String(meta.estimate));
    if (m) {
      const n = Number(m[1]);
      const unit = (m[2] ?? 'm').toLowerCase();
      if (unit === 'h') return Math.floor(n * 60);
      if (unit === 'd') return Math.floor(n * 60 * 8);
      return Math.floor(n);
    }
  }
  if (meta.estimate_min != null && Number.isFinite(meta.estimate_min)) {
    return meta.estimate_min;
  }
  return undefined;
}

export function openBlockersOf(
  task: HoltTaskMeta,
  all: readonly HoltTaskMeta[],
): string[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  return (task.blocked_by ?? []).filter((bid) => {
    const b = byId.get(bid);
    if (!b) return true;
    return b.status === 'open' || b.status === 'doing';
  });
}
