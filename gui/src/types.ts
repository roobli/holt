export type HoltStatus = 'open' | 'doing' | 'done' | 'dropped';
export type LaneId = 'personal' | 'work' | 'openjobs';
export type LaneFilter = 'all' | LaneId;

export interface HoltTaskMeta {
  id: string;
  title: string;
  status: HoltStatus;
  lane: string;
  stack_order: number;
  estimate_min?: number;
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
