import './styles.css';
import {
  completeProject as apiCompleteProject,
  fetchHistory,
  fetchTask,
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
import {
  displayEstimate,
  estimateMinutesOf,
  openBlockersOf,
  type HoltEvent,
  type HoltStatus,
  type HoltTaskMeta,
  type LaneFilter,
  type LaneId,
  type ProjectFilter,
} from './types';
import { renderTaskBodyHtml } from '../../src/core/task-links.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;

interface UiState {
  tasks: HoltTaskMeta[];
  historyByTask: Record<string, HoltEvent[]>;
  /** Markdown body by task id (soft links rendered in Detail). */
  bodyByTask: Record<string, string>;
  selectedId: string | null;
  lane: LaneFilter;
  project: ProjectFilter;
  ledgerRoot: string;
  ledgerExists: boolean;
  ledgerReady: boolean;
  watching: boolean;
  error: string | null;
  pushWhere: 'top' | 'bottom' | null;
  busy: boolean;
  detailCollapsed: boolean;
  detailError: string | null;
}

const state: UiState = {
  tasks: [],
  historyByTask: {},
  bodyByTask: {},
  selectedId: null,
  lane: 'all',
  project: 'all',
  ledgerRoot: '',
  ledgerExists: false,
  ledgerReady: false,
  watching: false,
  error: null,
  pushWhere: null,
  busy: false,
  detailCollapsed: true,
  detailError: null,
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

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/ledger busy/i.test(raw) || /\.holt\.lock/i.test(raw)) {
    return '账本正在被占用（CLI 或另一窗口在写），请稍后再试';
  }
  if (/409/.test(raw)) {
    return '账本正在被占用（CLI 或另一窗口在写），请稍后再试';
  }
  return raw;
}

/** Map estimate minutes → block height 48–120px with ease-out curve. */
function estimateToHeight(estimateMin?: number): number {
  const MIN = 48;
  const MAX = 120;
  if (estimateMin == null || estimateMin <= 0) return MIN;
  const t = Math.min(1, Math.max(0, (estimateMin - 10) / 80));
  const eased = 1 - (1 - t) * (1 - t);
  return Math.round(MIN + (MAX - MIN) * eased);
}

function projectSlugs(): string[] {
  const set = new Set<string>();
  for (const t of state.tasks) {
    if (t.project) set.add(t.project);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function sortedTasks(
  lane: LaneFilter = state.lane,
  project: ProjectFilter = state.project,
): HoltTaskMeta[] {
  let list = state.tasks;
  if (lane !== 'all') list = list.filter((t) => t.lane === lane);
  if (project !== 'all') list = list.filter((t) => t.project === project);
  return [...list].sort(
    (a, b) => a.stack_order - b.stack_order || a.id.localeCompare(b.id),
  );
}

function selectedTask(): HoltTaskMeta | null {
  if (!state.selectedId) return null;
  return state.tasks.find((t) => t.id === state.selectedId) ?? null;
}


async function loadSelectedDetail(id: string): Promise<void> {
  const [{ events }, file] = await Promise.all([fetchHistory(id), fetchTask(id)]);
  state.historyByTask[id] = [...events].reverse();
  state.bodyByTask[id] = file.body ?? '';
}

function formatEventLabel(e: HoltEvent): string {
  if (e.event === 'created') return 'create';
  if (e.event === 'project_completed' && e.data) {
    return `project ${String(e.data.project ?? '')} completed`;
  }
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
    if (state.project !== 'all' && !projectSlugs().includes(state.project)) {
      state.project = 'all';
    }
    if (state.selectedId) {
      await loadSelectedDetail(state.selectedId);
    }
  } catch (err) {
    state.error = friendlyError(err);
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
  const h = estimateToHeight(estimateMinutesOf(task));
  const est = displayEstimate(task) ?? '—';
  const openBb = openBlockersOf(task, state.tasks);
  const blockedMark =
    openBb.length > 0
      ? `<span class="stack-blocked-mark" title="阻塞于 ${escapeHtml(openBb.join(', '))}">阻塞</span>`
      : '';

  return `
    <div class="stack-card${selected ? ' is-selected' : ''}" style="min-height:${h}px" data-id="${task.id}" draggable="true" role="button" tabindex="0" aria-pressed="${selected}">
      <div class="stack-card-cols">
        <div class="stack-col stack-col-task">
          <div class="stack-card-title">${blockedMark}${escapeHtml(task.title)}</div>
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
  const estVal = displayEstimate(task) ?? '';
  const blocked = task.blocked_by ?? [];
  const blockedList =
    blocked.length === 0
      ? '<div class="value muted">无</div>'
      : `<ul class="blocked-list">${blocked
          .map(
            (id) =>
              `<li><button type="button" class="linkish" data-select-task="${escapeHtml(id)}">${escapeHtml(id)}</button> <button type="button" class="linkish muted" data-rm-blocked="${escapeHtml(id)}">移除</button></li>`,
          )
          .join('')}</ul>`;

  const knownIds = new Set(state.tasks.map((t) => t.id));
  const rawBody = state.bodyByTask[task.id] ?? '';
  const bodyHtml = renderTaskBodyHtml(rawBody, knownIds, escapeHtml);

  return `
    <div class="detail-label">Detail · ${escapeHtml(task.id)}</div>
    ${state.detailError ? `<div class="detail-error">${escapeHtml(state.detailError)}</div>` : ''}
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
        <label>估时</label>
        <input type="text" data-field="estimate" value="${escapeHtml(estVal)}" placeholder="45m / 2h / 1d" />
        <div class="field-hint">1d = 8 小时工作日</div>
      </div>
      <div class="detail-field">
        <label>project</label>
        <input type="text" data-field="project" value="${escapeHtml(task.project ?? '')}" placeholder="slug（空=未分组）" />
      </div>
      <div class="detail-field detail-field-block">
        <label>阻塞于</label>
        ${blockedList}
        <div class="blocked-add">
          <input type="text" data-add-blocked placeholder="T-0001" />
          <button type="button" data-add-blocked-btn>添加前置</button>
        </div>
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
    <div class="detail-field detail-field-block detail-body-block">
      <label>正文 <span class="muted-label">任务链接 @{T-xxxx}</span></label>
      <div class="detail-body">${bodyHtml || '<span class="muted">（空）</span>'}</div>
    </div>
    ${
      task.project
        ? `<button type="button" class="noto-btn" data-complete-project="${escapeHtml(task.project)}">完成整个 project</button>`
        : ''
    }
    <button type="button" class="noto-btn" data-open-body title="holt open-body">Open body · 打开正文</button>
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
      <label>estimate (optional)<input type="text" name="estimate" placeholder="45m / 2h / 1d" /></label>
      <label>project (optional)<input type="text" name="project" placeholder="slug" /></label>
      <div class="push-dialog-actions">
        <button type="button" class="primary" data-push-submit>创建</button>
        <button type="button" data-push-cancel>取消</button>
      </div>
    </div>
  `;
}

function render(): void {
  const tasks = sortedTasks(state.lane, state.project);
  const selected = selectedTask();
  const lanes: { id: LaneFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'personal', label: 'personal' },
    { id: 'work', label: 'work' },
    { id: 'openjobs', label: 'openjobs' },
  ];
  const projects = projectSlugs();

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
        <div>
          <div class="rail-section-label">Projects</div>
          <nav class="rail-nav">
            <button type="button" class="rail-item is-project${
              state.project === 'all' ? ' is-active' : ''
            }" data-project="all">All</button>
            ${projects
              .map(
                (p) =>
                  `<button type="button" class="rail-item is-project${
                    state.project === p ? ' is-active' : ''
                  }" data-project="${escapeHtml(p)}">${escapeHtml(p)}</button>`,
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
  state.detailError = null;
  if (id) {
    state.detailCollapsed = false;
    try {
      await loadSelectedDetail(id);
    } catch (err) {
      state.error = friendlyError(err);
    }
  }
  render();
  if (id) {
    const card = app.querySelector<HTMLElement>(`.stack-card[data-id="${CSS.escape(id)}"]`);
    card?.scrollIntoView({ block: 'nearest' });
  }
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
      const estimate = dialog.querySelector<HTMLInputElement>('input[name="estimate"]')?.value.trim();
      const project = dialog.querySelector<HTMLInputElement>('input[name="project"]')?.value.trim();
      if (!title || !lane) {
        const titleInput = dialog.querySelector<HTMLInputElement>('input[name="title"]');
        if (!title && titleInput) {
          titleInput.classList.add('is-invalid');
          titleInput.setAttribute('aria-invalid', 'true');
          titleInput.focus();
        }
        showToast(title ? '需要 lane' : '标题不能为空');
        return;
      }
      try {
        state.busy = true;
        const { task } = await apiPush({
          title,
          lane,
          estimate: estimate || undefined,
          project: project || undefined,
          where: state.pushWhere,
        });
        state.pushWhere = null;
        state.selectedId = task.id;
        await refresh({ keepSelection: true });
        showToast(`created ${task.id}`);
      } catch (err) {
        state.error = friendlyError(err);
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

  const selectTask = t.closest<HTMLElement>('[data-select-task]');
  if (selectTask?.dataset.selectTask) {
    void selectAndLoad(selectTask.dataset.selectTask);
    return;
  }

  const rmBlocked = t.closest<HTMLElement>('[data-rm-blocked]');
  if (rmBlocked?.dataset.rmBlocked) {
    const task = selectedTask();
    if (!task) return;
    void (async () => {
      try {
        state.detailError = null;
        await updateTask(task.id, { rm_blocked_by: [rmBlocked.dataset.rmBlocked!] });
        await refresh({ keepSelection: true });
      } catch (err) {
        state.detailError = friendlyError(err);
        render();
      }
    })();
    return;
  }

  if (t.closest('[data-add-blocked-btn]')) {
    const task = selectedTask();
    const input = app.querySelector<HTMLInputElement>('[data-add-blocked]');
    const id = input?.value.trim();
    if (!task || !id) return;
    void (async () => {
      try {
        state.detailError = null;
        await updateTask(task.id, { add_blocked_by: [id] });
        await refresh({ keepSelection: true });
      } catch (err) {
        state.detailError = friendlyError(err);
        render();
      }
    })();
    return;
  }

  const completeProj = t.closest<HTMLElement>('[data-complete-project]');
  if (completeProj?.dataset.completeProject) {
    const slug = completeProj.dataset.completeProject;
    if (
      !window.confirm(
        `将把「${slug}」下所有进行中任务标为完成。依赖未清的会整批取消。`,
      )
    ) {
      return;
    }
    void (async () => {
      try {
        state.detailError = null;
        const result = await apiCompleteProject(slug);
        await refresh({ keepSelection: true });
        showToast(
          result.task_ids.length
            ? `已完成 project ${result.project}（${result.task_ids.length} 项）`
            : `project ${result.project}：无进行中任务`,
        );
      } catch (err) {
        state.detailError = friendlyError(err);
        showToast(friendlyError(err));
        render();
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
    const visible = sortedTasks(state.lane, state.project);
    if (state.selectedId && !visible.some((x) => x.id === state.selectedId)) {
      state.selectedId = visible[0]?.id ?? null;
    }
    render();
    return;
  }

  const proj = t.closest<HTMLElement>('[data-project]');
  if (proj?.dataset.project) {
    state.project = proj.dataset.project as ProjectFilter;
    const visible = sortedTasks(state.lane, state.project);
    if (state.selectedId && !visible.some((x) => x.id === state.selectedId)) {
      state.selectedId = visible[0]?.id ?? null;
    }
    render();
    return;
  }

  const openBody = t.closest<HTMLElement>('[data-open-body]');
  if (openBody) {
    const task = selectedTask();
    if (!task) {
      showToast('未选中任务');
      return;
    }
    void (async () => {
      try {
        const { path, opened } = await openTaskFile(task.id);
        showToast(
          opened
            ? `打开 ${path}`
            : `未打开（无 DISPLAY / 编辑器）· ${path}`,
        );
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

app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el?.name === 'title' && el.classList.contains('is-invalid')) {
    el.classList.remove('is-invalid');
    el.removeAttribute('aria-invalid');
  }
});

app.addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement | HTMLInputElement;
  const task = selectedTask();
  if (!task) return;
  if (el.dataset.field === 'status') {
    void (async () => {
      try {
        state.detailError = null;
        await updateTask(task.id, { status: (el as HTMLSelectElement).value as HoltStatus });
        await refresh({ keepSelection: true });
      } catch (err) {
        state.detailError = friendlyError(err);
        showToast(friendlyError(err));
        render();
      }
    })();
  }
  if (el.dataset.field === 'lane') {
    void (async () => {
      await updateTask(task.id, { lane: (el as HTMLSelectElement).value });
      await refresh({ keepSelection: true });
    })().catch((err) => showToast(err instanceof Error ? err.message : String(err)));
  }
});

app.addEventListener('focusout', (e) => {
  const el = e.target as HTMLInputElement;
  const task = selectedTask();
  if (!task || !el.dataset?.field) return;
  if (el.dataset.field === 'estimate') {
    const raw = el.value.trim();
    const current = displayEstimate(task) ?? '';
    if (raw === current) return;
    void (async () => {
      try {
        state.detailError = null;
        await updateTask(task.id, { estimate: raw === '' ? null : raw });
        await refresh({ keepSelection: true });
      } catch (err) {
        state.detailError = friendlyError(err);
        showToast(friendlyError(err));
        render();
      }
    })();
  }
  if (el.dataset.field === 'project') {
    const raw = el.value.trim();
    const current = task.project ?? '';
    if (raw === current) return;
    void (async () => {
      try {
        state.detailError = null;
        await updateTask(task.id, { project: raw === '' ? null : raw });
        await refresh({ keepSelection: true });
      } catch (err) {
        state.detailError = friendlyError(err);
        showToast(friendlyError(err));
        render();
      }
    })();
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
  const ordered = sortedTasks('all', 'all');
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
