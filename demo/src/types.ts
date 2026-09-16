export type HoltStatus = 'open' | 'doing' | 'done' | 'dropped';

export type LaneId = 'personal' | 'work' | 'openjobs';

export interface DemoTask {
  id: string;
  title: string;
  status: HoltStatus;
  lane: LaneId;
  stack_order: number;
  estimate_min?: number;
  hooks?: { pre?: string[]; post?: string[] };
  created_at: string;
  updated_at: string;
  history: HistoryEntry[];
}

export interface HistoryEntry {
  time: string; // HH:mm display
  label: string;
}

export type ViewId = 'stack' | 'timeline';
export type LaneFilter = 'all' | LaneId;
