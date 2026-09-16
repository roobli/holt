import './styles.css';
import {
  clearAll,
  estimateToHeight,
  getState,
  moveTask,
  pushTask,
  seedDemoStack,
  selectTask,
  selectedTask,
  setLane,
  sortedTasks,
  subscribe,
  updateSelected,
} from './store';
import type { DemoTask, HoltStatus, LaneFilter, LaneId } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
let toastTimer: number | undefined;

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
  toastTimer = window.setTimeout(() => el?.classList.remove('is-on'), 2200);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cardMetaLine(task: DemoTask, compact: boolean): string {
  if (compact) {
    return task.estimate_min != null ? `${task.estimate_min}m` : '';
  }
  const parts = [task.status, task.lane];
  if (task.estimate_min != null) parts.push(`${task.estimate_min}m`);
  return parts.join(' · ');
}

function renderCard(task: DemoTask, selected: boolean, index: number, total: number): string {
  const h = estimateToHeight(task.estimate_min);
  // Compact: title + estimate aside (visual cards 2 & 4). Rich: title + status·lane·estimate meta.
  const compact = !selected && h <= 64;
  const meta = compact
    ? ''
    : `<div class="stack-card-meta">${escapeHtml(cardMetaLine(task, false))}</div>`;
  const aside =
    compact && task.estimate_min != null
      ? `<div class="stack-card-estimate">${task.estimate_min}m</div>`
      : '';

  return `
    <div class="stack-card${selected ? ' is-selected' : ''}" style="min-height:${h}px" data-id="${task.id}" role="button" tabindex="0" aria-pressed="${selected}">
      <div class="stack-card-body">
        <div class="stack-card-title">${escapeHtml(task.title)}</div>
        ${meta}
      </div>
      ${aside}
      <div class="stack-card-actions" data-actions>
        <button type="button" data-move="up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-move="down" title="下移" ${index >= total - 1 ? 'disabled' : ''}>↓</button>
      </div>
    </div>
  `;
}

function renderDetail(task: DemoTask | null): string {
  if (!task) {
    return `
      <div class="detail-label">Detail</div>
      <div class="detail-empty">栈空或未选中。<br />压入一条任务后，点选卡片查看详情。</div>
    `;
  }

  const hooksText = task.hooks
    ? 'pre/post · 见声明'
    : '—';

  const history = task.history
    .map(
      (h) =>
        `<li><span class="t">${escapeHtml(h.time)}</span><span>${escapeHtml(h.label)}</span></li>`,
    )
    .join('');

  return `
    <div class="detail-label">Detail</div>
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
          ${(['personal', 'work', 'openjobs'] as LaneId[])
            .map(
              (l) =>
                `<option value="${l}"${l === task.lane ? ' selected' : ''}>${l}</option>`,
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
    </div>
    <button type="button" class="noto-btn" data-noto>在 Noto 打开正文</button>
    <div class="history-label">Recent history</div>
    <ul class="history-list">${history || '<li><span class="t">—</span><span>暂无</span></li>'}</ul>
  `;
}

function render(): void {
  const state = getState();
  const tasks = sortedTasks(state.lane);
  const selected = selectedTask();
  const lanes: { id: LaneFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'personal', label: 'personal' },
    { id: 'work', label: 'work' },
    { id: 'openjobs', label: 'openjobs' },
  ];

  const stackBody =
    tasks.length === 0
      ? `
        <div class="stack-empty">
          <strong>栈是空的</strong>
          <p>安静纸面。从上下入口压入第一条任务，开始你的优先序。</p>
        </div>
      `
      : `<div class="stack-list">${tasks
          .map((t, i) => renderCard(t, t.id === state.selectedId, i, tasks.length))
          .join('')}</div>`;

  app.innerHTML = `
    <div class="app-shell">
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
          <h1>Stack</h1>
          <p class="main-sub">优先序 · ↑↓ reorder</p>
        </header>
        <button type="button" class="push-btn" data-push="top">+ 压入栈顶</button>
        ${stackBody}
        <button type="button" class="push-btn" data-push="bottom">+ 压入栈底</button>
        <p class="main-foot">块高 48–120px 封顶，estimate 略映 · demo in-memory</p>
        <div class="demo-tools">
          <button type="button" data-tool="seed">填入视觉稿示例</button>
          <button type="button" data-tool="clear">清空栈</button>
        </div>
      </main>

      <aside class="detail">
        <div class="detail-panel">
          ${renderDetail(selected)}
        </div>
      </aside>
    </div>
  `;
}

app.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;

  const push = t.closest<HTMLElement>('[data-push]');
  if (push) {
    pushTask(push.dataset.push === 'bottom' ? 'bottom' : 'top');
    return;
  }

  const moveBtn = t.closest<HTMLButtonElement>('[data-move]');
  if (moveBtn) {
    e.stopPropagation();
    const card = moveBtn.closest<HTMLElement>('[data-id]');
    if (!card?.dataset.id) return;
    moveTask(card.dataset.id, moveBtn.dataset.move === 'down' ? 'down' : 'up');
    return;
  }

  const card = t.closest<HTMLElement>('.stack-card[data-id]');
  if (card?.dataset.id) {
    selectTask(card.dataset.id);
    return;
  }

  const lane = t.closest<HTMLElement>('[data-lane]');
  if (lane?.dataset.lane) {
    setLane(lane.dataset.lane as LaneFilter);
    return;
  }

  const noto = t.closest<HTMLElement>('[data-noto]');
  if (noto) {
    const task = selectedTask();
    showToast(
      task
        ? `stub：将在 Noto 打开 ${task.id}.md（demo 未接文件）`
        : 'stub：未选中任务',
    );
    return;
  }

  const tool = t.closest<HTMLElement>('[data-tool]');
  if (tool?.dataset.tool === 'seed') {
    seedDemoStack();
    return;
  }
  if (tool?.dataset.tool === 'clear') {
    clearAll();
    return;
  }
});

app.addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.dataset.field === 'status') {
    updateSelected({ status: el.value as HoltStatus });
  }
  if (el.dataset.field === 'lane') {
    updateSelected({ lane: el.value as LaneId });
  }
});

app.addEventListener('keydown', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.stack-card[data-id]');
  if (!card?.dataset.id) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectTask(card.dataset.id);
  }
});

subscribe(render);
render();
