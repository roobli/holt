export type HoltStatus = 'open' | 'doing' | 'done' | 'dropped';

export interface HoltTaskMeta {
  id: string;
  title: string;
  status: HoltStatus;
  lane: string;
  stack_order: number;
  /** User-facing duration with unit (e.g. 45m / 2h / 1d). Preferred over estimate_min. */
  estimate?: string;
  /** Normalized minutes; dual-written from estimate during transition; legacy files may only have this. */
  estimate_min?: number;
  /** Task ids this task is blocked by (truth for deps). */
  blocked_by?: string[];
  /** Optional project slug (filter only in v1). */
  project?: string;
  due?: string;
  owner?: string;
  watchers?: string[];
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
