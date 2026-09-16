import './styles.css';
import {
  fetchHistory,
  fetchTasks,
  getLedger,
  moveTask as apiMove,
  openTaskFile,
  pushTask as apiPush,
  reorderToIndex,
  setLedger,
  subscribeLedgerWatch,
  updateTask,
} from './api';
import type { HoltEvent, HoltStatus, HoltTaskMeta, LaneFilter, LaneId } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;

interface UiState {
  tasks: HoltTaskMeta[];
  historyByTask: Record<string, HoltEvent[]>;
  selectedId: string | null;
  lane: LaneFilter;
  ledgerRoot: string;
  ledgerExists: boolean;
  ledgerReady: boolean;
  watching: boolean;
  error: string | null;
  pushWhere: 'top' | 'bottom' | null;
  busy: boolean;
  detailCollapsed: boolean;
}

const state: UiState = {
  tasks: [],
  historyByTask: {},
  selectedId: null,
  lane: 'all',
  ledgerRoot: '',
  ledgerExists: false,
  ledgerReady: false,
  watching: false,
  error: null,
  pushWhere: null,
  busy: false,
  detailCollapsed: true,
};

let toastTimer: number | undefined;
let dragId: string | null = null;

function showToast(msg: string): void {
  let el = document.querySelector<HTMLDivElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('is-on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('is-on'), 2800);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Map estimate_min → block height 48–120px with ease-out curve. */
function estimateToHeight(estimateMin?: number): number {
  const MIN = 48;
  const MAX = 120;
  if (estimateMin == null || estimateMin <= 0) return MIN;
  const t = Math.min(1, Math.max(0, (estimateMin - 10) / 80));
  const eased = 1 - (1 - t) * (1 - t);
  return Math.round(MIN + (MAX - MIN) * eased);
}

function sortedTasks(lane: LaneFilter = state.lane): HoltTaskMeta[] {
  const list =
    lane === 'all' ? state.tasks : state.tasks.filter((t) => t.lane === lane);
  return [...list].sort(
    (a, b) => a.stack_order - b.stack_order || a.id.localeCompare(b.id),
  );
}

function selectedTask(): HoltTaskMeta | null {
  if (!state.selectedId) return null;
  return state.tasks.find((t) => t.id === state.selectedId) ?? null;
}

function formatEventLabel(e: HoltEvent): string {
  if (e.event === 'created') return 'create';
  if (e.event === 'reordered' && e.data) {
    return `reorder ${e.data.from}→${e.data.to}`;
  }
  if (e.event === 'updated' && e.data) {
    return Object.entries(e.data)
      .map(([k, v]) => `${k} → ${String(v)}`)
      .join(', ');
  }
  return e.event;
}

function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(11, 16) || iso;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso.slice(11, 16) || '—';
  }
}

async function refresh(opts?: { keepSelection?: boolean }): Promise<void> {
  state.busy = true;
  state.error = null;
  try {
    const ledger = await getLedger();
    state.ledgerRoot = ledger.root;
    state.ledgerExists = ledger.exists;
    state.ledgerReady = ledger.ready;
    state.watching = Boolean(ledger.watching);
    if (!ledger.ready) {
      state.tasks = [];
      state.error = ledger.exists
        ? `不是 ledger（缺少 tasks/）：${ledger.root} — 可点「创建」初始化`
        : `路径不存在：${ledger.root} — 可点「创建」新建空 ledger`;
      return;
    }
    const { tasks } = await fetchTasks();
    state.tasks = tasks;
    if (state.selectedId && !tasks.some((t) => t.id === state.selectedId)) {
      state.selectedId = tasks[0]?.id ?? null;
    }
    if (state.selectedId) {
      const { events } = await fetchHistory(state.selectedId);
      state.historyByTask[state.selectedId] = [...events].reverse();
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busy = false;
    render();
  }
}

function renderCard(
  task: HoltTaskMeta,
  selected: boolean,
  index: number,
  total: number,
): string {
  const h = estimateToHeight(task.estimate_min);
  const est = task.estimate_min != null ? `${task.estimate_min}m` : '—';

  return `
    <div class="stack-card${selected ? ' is-selected' : ''}" style="min-height:${h}px" data-id="${task.id}" draggable="true" role="button" tabindex="0" aria-pressed="${selected}">
      <div class="stack-card-cols">
        <div class="stack-col stack-col-task">
          <div class="stack-card-title">${escapeHtml(task.title)}</div>
        </div>
        <div class="stack-col stack-col-status">${escapeHtml(task.status)}</div>
        <div class="stack-col stack-col-lane">${escapeHtml(task.lane)}</div>
        <div class="stack-col stack-col-est">${escapeHtml(est)}</div>
      </div>
      <div class="stack-card-actions" data-actions>
        <button type="button" data-move="up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-move="down" title="下移" ${index >= total - 1 ? 'disabled' : ''}>↓</button>
      </div>
    </div>
  `;
}

function renderDetail(task: HoltTaskMeta | null): string {
  if (!task) {
    return `
      <div class="detail-label">Detail</div>
      <div class="detail-empty">栈空或未选中。<br />压入一条任务后，点选卡片查看详情与 history。</div>
    `;
  }

  const hooksText = task.hooks ? 'pre/post · 见声明' : '—';
  const events = state.historyByTask[task.id] ?? [];
  const history = events
    .slice(0, 12)
    .map(
      (h) =>
        `<li><span class="t">${escapeHtml(formatEventTime(h.time))}</span><span>${escapeHtml(formatEventLabel(h))}</span></li>`,
    )
    .join('');

  const lanes: LaneId[] = ['personal', 'work', 'openjobs'];
  const laneOptions = Array.from(new Set([...lanes, task.lane]));

  return `
    <div class="detail-label">Detail · ${escapeHtml(task.id)}</div>
    <h2 class="detail-title">${escapeHtml(task.title)}</h2>
    <div class="detail-fields">
      <div class="detail-field">
        <label>status</label>
        <select data-field="status">
          ${(['open', 'doing', 'done', 'dropped'] as HoltStatus[])
            .map(
              (s) =>
                `<option value="${s}"${s === task.status ? ' selected' : ''}>${s}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="detail-field">
        <label>lane</label>
        <select data-field="lane">
          ${laneOptions
            .map(
              (l) =>
                `<option value="${escapeHtml(l)}"${l === task.lane ? ' selected' : ''}>${escapeHtml(l)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="detail-field">
        <label>estimate</label>
        <div class="value">${task.estimate_min != null ? `${task.estimate_min}m` : '—'}</div>
      </div>
      <div class="detail-field">
        <label>hooks</label>
        <div class="value">${escapeHtml(hooksText)}</div>
      </div>
      <div class="detail-field">
        <label>stack_order</label>
        <div class="value">${task.stack_order}</div>
      </div>
    </div>
    <button type="button" class="noto-btn" data-noto>在本机打开正文 / Noto</button>
    <div class="history-label">Recent history</div>
    <ul class="history-list">${history || '<li><span class="t">—</span><span>暂无</span></li>'}</ul>
  `;
}

function renderPushDialog(): string {
  if (!state.pushWhere) return '<div class="push-dialog hidden"></div>';
  return `
    <div class="push-dialog" data-push-dialog>
      <strong>压入栈${state.pushWhere === 'top' ? '顶' : '底'}</strong>
      <label>title<input type="text" name="title" placeholder="任务标题" autofocus /></label>
      <label>lane
        <select name="lane">
          <option value="personal">personal</option>
          <option value="work">work</option>
          <option value="openjobs">openjobs</option>
        </select>
      </label>
      <label>estimate (min, optional)<input type="number" name="estimate" min="1" step="1" placeholder="e.g. 30" /></label>
      <div class="push-dialog-actions">
        <button type="button" class="primary" data-push-submit>创建</button>
        <button type="button" data-push-cancel>取消</button>
      </div>
    </div>
  `;
}

function render(): void {
  const tasks = sortedTasks(state.lane);
  const selected = selectedTask();
  const lanes: { id: LaneFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'personal', label: 'personal' },
    { id: 'work', label: 'work' },
    { id: 'openjobs', label: 'openjobs' },
  ];

  const softHeader = `
        <div class="stack-soft-header-row" aria-hidden="true">
          <div class="stack-soft-header">
            <div class="stack-col stack-col-task">任务</div>
            <div class="stack-col stack-col-status">状态</div>
            <div class="stack-col stack-col-lane">lane</div>
            <div class="stack-col stack-col-est">估时</div>
          </div>
          <div class="stack-soft-header-gutter"></div>
        </div>`;

  const stackBody =
    tasks.length === 0
      ? `
        <div class="stack-empty">
          <strong>栈是空的</strong>
          <p>本地 ledger 暂无任务。从上下入口压入第一条，文件会写入 tasks/*.md。</p>
        </div>
      `
      : `${softHeader}<div class="stack-list">${tasks
          .map((t, i) => renderCard(t, t.id === state.selectedId, i, tasks.length))
          .join('')}</div>`;

  app.innerHTML = `
    <div class="app-shell${state.detailCollapsed ? ' is-detail-collapsed' : ''}">
      <aside class="rail">
        <div class="brand">
          <div class="brand-name">holt</div>
          <div class="brand-tag">companion</div>
        </div>
        <div>
          <div class="rail-section-label">Views</div>
          <nav class="rail-nav">
            <button type="button" class="rail-item is-active" data-view="stack">Stack</button>
            <button type="button" class="rail-item is-stub" disabled data-view="timeline">
              Timeline
              <span class="rail-item-sub">次 · 未做</span>
            </button>
          </nav>
        </div>
        <div>
          <div class="rail-section-label">Lanes</div>
          <nav class="rail-nav">
            ${lanes
              .map(
                (l) =>
                  `<button type="button" class="rail-item is-lane${
                    state.lane === l.id ? ' is-active' : ''
                  }" data-lane="${l.id}">${l.label}</button>`,
              )
              .join('')}
          </nav>
        </div>
      </aside>

      <main class="main">
        <header class="main-header">
          <div class="main-header-row">
            <div>
              <h1>Stack</h1>
              <p class="main-sub">软列对齐，无格线，仍是栈卡 · 拖拽 reorder · 主列吃满可用宽</p>
            </div>
            <button type="button" class="detail-toggle" data-detail-toggle>
              ${state.detailCollapsed ? 'Detail' : '收起 ›'}
            </button>
          </div>
        </header>
        ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
        <div class="ledger-bar">
          <span>ledger</span>
          <input type="text" data-ledger-input value="${escapeHtml(state.ledgerRoot)}" spellcheck="false" />
          <button type="button" data-ledger-apply>打开</button>
          ${
            state.ledgerReady
              ? ''
              : '<button type="button" data-ledger-create title="创建 tasks/ + history.ndjson">创建</button>'
          }
          <button type="button" data-refresh>刷新</button>
          <span class="ledger-status" data-ledger-status title="fs.watch → auto refresh">
            ${
              state.ledgerReady
                ? state.watching
                  ? '● live'
                  : '○ ready'
                : state.ledgerExists
                  ? '△ no tasks/'
                  : '✗ missing'
            }
          </span>
        </div>
        <button type="button" class="push-btn" data-push="top" ${state.busy ? 'disabled' : ''}>+ 压入栈顶</button>
        ${renderPushDialog()}
        ${stackBody}
        <button type="button" class="push-btn" data-push="bottom" ${state.busy ? 'disabled' : ''}>+ 压入栈底</button>
        <p class="main-foot">软表格：淡字表头 + 列对齐元数据 · 无竖线/无斑马/圆角卡间隙 · 块高 48–120px</p>
      </main>

      <aside class="detail">
        <div class="detail-panel">
          ${renderDetail(selected)}
        </div>
      </aside>
    </div>
  `;
}

async function selectAndLoad(id: string | null): Promise<void> {
  state.selectedId = id;
  if (id) {
    state.detailCollapsed = false;
    try {
      const { events } = await fetchHistory(id);
      state.historyByTask[id] = [...events].reverse();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }
  render();
}

app.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;

  if (t.closest('[data-detail-toggle]')) {
    state.detailCollapsed = !state.detailCollapsed;
    render();
    return;
  }

  const push = t.closest<HTMLElement>('[data-push]');
  if (push?.dataset.push === 'top' || push?.dataset.push === 'bottom') {
    state.pushWhere = push.dataset.push;
    render();
    const input = app.querySelector<HTMLInputElement>('input[name="title"]');
    input?.focus();
    return;
  }

  if (t.closest('[data-push-cancel]')) {
    state.pushWhere = null;
    render();
    return;
  }

  if (t.closest('[data-push-submit]')) {
    void (async () => {
      const dialog = app.querySelector('[data-push-dialog]');
      if (!dialog || !state.pushWhere) return;
      const title = dialog.querySelector<HTMLInputElement>('input[name="title"]')?.value.trim();
      const lane = dialog.querySelector<HTMLSelectElement>('select[name="lane"]')?.value;
      const estRaw = dialog.querySelector<HTMLInputElement>('input[name="estimate"]')?.value;
      if (!title || !lane) {
        showToast('需要 title 与 lane');
        return;
      }
      const estimate_min = estRaw ? Number(estRaw) : undefined;
      if (estRaw && !Number.isFinite(estimate_min)) {
        showToast('estimate 须为数字');
        return;
      }
      try {
        state.busy = true;
        const { task } = await apiPush({
          title,
          lane,
          estimate_min,
          where: state.pushWhere,
        });
        state.pushWhere = null;
        state.selectedId = task.id;
        await refresh({ keepSelection: true });
        showToast(`created ${task.id}`);
      } catch (err) {
        state.error = err instanceof Error ? err.message : String(err);
        state.busy = false;
        render();
      }
    })();
    return;
  }

  const moveBtn = t.closest<HTMLButtonElement>('[data-move]');
  if (moveBtn) {
    e.stopPropagation();
    const card = moveBtn.closest<HTMLElement>('[data-id]');
    if (!card?.dataset.id) return;
    void (async () => {
      try {
        await apiMove(card.dataset.id!, moveBtn.dataset.move === 'down' ? 'down' : 'up');
        await refresh({ keepSelection: true });
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    })();
    return;
  }

  const card = t.closest<HTMLElement>('.stack-card[data-id]');
  if (card?.dataset.id) {
    void selectAndLoad(card.dataset.id);
    return;
  }

  const lane = t.closest<HTMLElement>('[data-lane]');
  if (lane?.dataset.lane) {
    state.lane = lane.dataset.lane as LaneFilter;
    const visible = sortedTasks(state.lane);
    if (state.selectedId && !visible.some((x) => x.id === state.selectedId)) {
      state.selectedId = visible[0]?.id ?? null;
    }
    render();
    return;
  }

  const noto = t.closest<HTMLElement>('[data-noto]');
  if (noto) {
    const task = selectedTask();
    if (!task) {
      showToast('未选中任务');
      return;
    }
    void (async () => {
      try {
        const { path } = await openTaskFile(task.id);
        showToast(`打开 ${path}`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    })();
    return;
  }

  if (t.closest('[data-refresh]')) {
    void refresh({ keepSelection: true });
    return;
  }

  if (t.closest('[data-ledger-apply]') || t.closest('[data-ledger-create]')) {
    const create = Boolean(t.closest('[data-ledger-create]'));
    const input = app.querySelector<HTMLInputElement>('[data-ledger-input]');
    const path = input?.value.trim();
    if (!path) return;
    void (async () => {
      try {
        const info = await setLedger(path, create);
        state.selectedId = null;
        state.ledgerRoot = info.root;
        state.ledgerExists = info.exists;
        state.ledgerReady = info.ready;
        await refresh();
        showToast(
          create || info.created
            ? `created ledger → ${state.ledgerRoot}`
            : `ledger → ${state.ledgerRoot}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        state.error = msg;
        showToast(msg);
        render();
      }
    })();
  }
});

app.addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  const task = selectedTask();
  if (!task) return;
  if (el.dataset.field === 'status') {
    void (async () => {
      await updateTask(task.id, { status: el.value as HoltStatus });
      await refresh({ keepSelection: true });
    })().catch((err) => showToast(err instanceof Error ? err.message : String(err)));
  }
  if (el.dataset.field === 'lane') {
    void (async () => {
      await updateTask(task.id, { lane: el.value });
      await refresh({ keepSelection: true });
    })().catch((err) => showToast(err instanceof Error ? err.message : String(err)));
  }
});

app.addEventListener('keydown', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.stack-card[data-id]');
  if (!card?.dataset.id) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    void selectAndLoad(card.dataset.id);
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    void (async () => {
      await apiMove(card.dataset.id!, e.key === 'ArrowUp' ? 'up' : 'down');
      await refresh({ keepSelection: true });
    })().catch((err) => showToast(err instanceof Error ? err.message : String(err)));
  }
});

app.addEventListener('dragstart', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.stack-card[data-id]');
  if (!card?.dataset.id) return;
  if ((e.target as HTMLElement).closest('[data-actions]')) {
    e.preventDefault();
    return;
  }
  dragId = card.dataset.id;
  card.classList.add('is-dragging');
  e.dataTransfer?.setData('text/plain', dragId);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
});

app.addEventListener('dragend', () => {
  dragId = null;
  app.querySelectorAll('.stack-card.is-dragging, .stack-card.is-drop-target').forEach((el) => {
    el.classList.remove('is-dragging', 'is-drop-target');
  });
});

app.addEventListener('dragover', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.stack-card[data-id]');
  if (!card || !dragId) return;
  e.preventDefault();
  app.querySelectorAll('.stack-card.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
  if (card.dataset.id !== dragId) card.classList.add('is-drop-target');
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
});

app.addEventListener('drop', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.stack-card[data-id]');
  if (!card?.dataset.id || !dragId) return;
  e.preventDefault();
  const ordered = sortedTasks('all');
  const toIndex = ordered.findIndex((t) => t.id === card.dataset.id);
  const id = dragId;
  dragId = null;
  if (toIndex < 0) return;
  void (async () => {
    await reorderToIndex(id, toIndex);
    await refresh({ keepSelection: true });
  })().catch((err) => showToast(err instanceof Error ? err.message : String(err)));
});

let watchRefreshTimer: number | undefined;
function onLedgerFileChange(): void {
  if (state.busy || state.pushWhere) return;
  window.clearTimeout(watchRefreshTimer);
  watchRefreshTimer = window.setTimeout(() => {
    void refresh({ keepSelection: true });
  }, 80);
}

render();
void refresh();
subscribeLedgerWatch(onLedgerFileChange);
