import type { DemoTask, HistoryEntry, HoltStatus, LaneFilter, LaneId, ViewId } from './types';

const STORAGE_KEY = 'holt-demo-v1';

export interface AppState {
  tasks: DemoTask[];
  selectedId: string | null;
  view: ViewId;
  lane: LaneFilter;
  nextCounter: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

function nowIso(): string {
  return new Date().toISOString();
}

function timeLabel(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.tasks)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return {
    tasks: [],
    selectedId: null,
    view: 'stack',
    lane: 'all',
    nextCounter: 1,
  };
}

let state: AppState = load();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function emit(): void {
  persist();
  for (const l of listeners) l();
}

export function getState(): AppState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function sortedTasks(lane: LaneFilter = state.lane): DemoTask[] {
  const list =
    lane === 'all' ? state.tasks : state.tasks.filter((t) => t.lane === lane);
  return [...list].sort(
    (a, b) => a.stack_order - b.stack_order || a.id.localeCompare(b.id),
  );
}

export function selectedTask(): DemoTask | null {
  if (!state.selectedId) return null;
  return state.tasks.find((t) => t.id === state.selectedId) ?? null;
}

/** Map estimate_min → block height 48–120px with ease-out curve. */
export function estimateToHeight(estimateMin?: number): number {
  const MIN = 48;
  const MAX = 120;
  if (estimateMin == null || estimateMin <= 0) return MIN;
  // Reference: 15m → ~48, 90m → ~120; ease-out so large estimates taper
  const t = Math.min(1, Math.max(0, (estimateMin - 10) / 80));
  const eased = 1 - (1 - t) * (1 - t);
  return Math.round(MIN + (MAX - MIN) * eased);
}

function renumberOrders(tasks: DemoTask[]): void {
  const ordered = [...tasks].sort(
    (a, b) => a.stack_order - b.stack_order || a.id.localeCompare(b.id),
  );
  ordered.forEach((t, i) => {
    t.stack_order = (i + 1) * 10;
  });
}

function appendHistory(task: DemoTask, label: string): void {
  const entry: HistoryEntry = { time: timeLabel(), label };
  task.history = [entry, ...task.history].slice(0, 12);
  task.updated_at = nowIso();
}

export function setView(view: ViewId): void {
  if (view === 'timeline') return; // stub
  state = { ...state, view };
  emit();
}

export function setLane(lane: LaneFilter): void {
  state = { ...state, lane };
  const visible = sortedTasks(lane);
  if (state.selectedId && !visible.some((t) => t.id === state.selectedId)) {
    state = { ...state, selectedId: visible[0]?.id ?? null };
  }
  emit();
}

export function selectTask(id: string | null): void {
  state = { ...state, selectedId: id };
  emit();
}

const SAMPLE_TITLES = [
  '写立项摘要',
  '定正式名',
  '竞品补漏扫完',
  'hook 语义拍板',
  '开独立仓脚手架',
  '整理 sample ledger',
  '补 history 回放草图',
  '压栈手感微调',
];

const LANES: LaneId[] = ['personal', 'work', 'openjobs'];
const STATUSES: HoltStatus[] = ['open', 'doing', 'open', 'open'];

export function pushTask(where: 'top' | 'bottom'): void {
  const n = state.nextCounter;
  const id = `T-${String(n).padStart(4, '0')}`;
  const title =
    SAMPLE_TITLES[(n - 1) % SAMPLE_TITLES.length] +
    (n > SAMPLE_TITLES.length ? ` ·${n}` : '');
  const estimateOptions = [15, 20, 30, 45, 60, 90];
  const estimate_min = estimateOptions[(n - 1) % estimateOptions.length];
  const lane = LANES[(n - 1) % LANES.length];
  const status = STATUSES[(n - 1) % STATUSES.length];

  const orders = state.tasks.map((t) => t.stack_order);
  let stack_order: number;
  if (orders.length === 0) {
    stack_order = 10;
  } else if (where === 'top') {
    stack_order = Math.min(...orders) - 10;
  } else {
    stack_order = Math.max(...orders) + 10;
  }

  const iso = nowIso();
  const task: DemoTask = {
    id,
    title,
    status,
    lane,
    stack_order,
    estimate_min,
    hooks: n % 3 === 1 ? { pre: ['lint'], post: ['notify'] } : undefined,
    created_at: iso,
    updated_at: iso,
    history: [{ time: timeLabel(), label: 'create' }],
  };

  const tasks = [...state.tasks, task];
  renumberOrders(tasks);
  state = {
    ...state,
    tasks,
    selectedId: id,
    nextCounter: n + 1,
  };
  emit();
}

export function moveTask(id: string, dir: 'up' | 'down'): void {
  const ordered = sortedTasks('all');
  const idx = ordered.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const swapWith = dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= ordered.length) return;

  const a = ordered[idx];
  const b = ordered[swapWith];
  const from = a.stack_order;
  const to = b.stack_order;
  a.stack_order = to;
  b.stack_order = from;
  appendHistory(a, `reorder ${from} → ${to}`);
  state = { ...state, tasks: [...state.tasks] };
  emit();
}

export function updateSelected(patch: Partial<Pick<DemoTask, 'status' | 'lane' | 'title' | 'estimate_min'>>): void {
  const task = selectedTask();
  if (!task) return;
  const parts: string[] = [];
  if (patch.status != null && patch.status !== task.status) {
    parts.push(`status → ${patch.status}`);
    task.status = patch.status;
  }
  if (patch.lane != null && patch.lane !== task.lane) {
    parts.push(`lane → ${patch.lane}`);
    task.lane = patch.lane;
  }
  if (patch.title != null && patch.title !== task.title) {
    parts.push('title updated');
    task.title = patch.title;
  }
  if (patch.estimate_min != null && patch.estimate_min !== task.estimate_min) {
    parts.push(`estimate → ${patch.estimate_min}m`);
    task.estimate_min = patch.estimate_min;
  }
  if (parts.length) appendHistory(task, parts.join(', '));
  state = { ...state, tasks: [...state.tasks] };
  emit();
}

export function clearAll(): void {
  state = {
    tasks: [],
    selectedId: null,
    view: 'stack',
    lane: 'all',
    nextCounter: 1,
  };
  emit();
}

export function seedDemoStack(): void {
  // Match visual baseline sample titles (for optional "fill demo" — empty by default)
  const seed: Omit<DemoTask, 'history' | 'created_at' | 'updated_at'>[] = [
    { id: 'T-0001', title: '写立项摘要', status: 'doing', lane: 'work', stack_order: 10, estimate_min: 45, hooks: { pre: ['lint'], post: ['notify'] } },
    { id: 'T-0002', title: '定正式名', status: 'open', lane: 'work', stack_order: 20, estimate_min: 20 },
    { id: 'T-0003', title: '竞品补漏扫完', status: 'open', lane: 'work', stack_order: 30, estimate_min: 90 },
    { id: 'T-0004', title: 'hook 语义拍板', status: 'open', lane: 'work', stack_order: 40, estimate_min: 15 },
    { id: 'T-0005', title: '开独立仓脚手架', status: 'open', lane: 'work', stack_order: 50, estimate_min: 60 },
  ];
  const iso = nowIso();
  const tasks: DemoTask[] = seed.map((s, i) => ({
    ...s,
    created_at: iso,
    updated_at: iso,
    history:
      i === 0
        ? [
            { time: '12:06', label: 'status → doing' },
            { time: '12:05', label: 'reorder 10 → 3' },
            { time: '12:00', label: 'create' },
          ]
        : [{ time: '12:00', label: 'create' }],
  }));
  state = {
    tasks,
    selectedId: tasks[0]?.id ?? null,
    view: 'stack',
    lane: 'all',
    nextCounter: 6,
  };
  emit();
}
