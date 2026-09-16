import type { HoltEvent, HoltStatus, HoltTaskMeta } from './types';

export interface LedgerInfo {
  root: string;
  tasksDir: string;
  historyPath: string;
  exists: boolean;
  ready: boolean;
  watching?: boolean;
  clients?: number;
  created?: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as T & { error?: string; createable?: boolean; code?: string };
  if (!res.ok) {
    const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & {
      createable?: boolean;
      code?: string;
      status?: number;
    };
    err.createable = body.createable;
    err.code = body.code;
    err.status = res.status;
    throw err;
  }
  return body;
}

export function getLedger() {
  return req<LedgerInfo>('/api/ledger');
}

export function setLedger(path: string, create = false) {
  return req<LedgerInfo>('/api/ledger', {
    method: 'POST',
    body: JSON.stringify({ path, create }),
  });
}

export function fetchTasks() {
  return req<{ tasks: HoltTaskMeta[] }>('/api/tasks');
}

export function pushTask(input: {
  title: string;
  lane: string;
  estimate_min?: number;
  where: 'top' | 'bottom';
}) {
  return req<{ task: HoltTaskMeta }>('/api/push', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function moveTask(id: string, dir: 'up' | 'down') {
  return req<{ task: HoltTaskMeta }>('/api/move', {
    method: 'POST',
    body: JSON.stringify({ id, dir }),
  });
}

export function reorderToIndex(id: string, toIndex: number) {
  return req<{ task: HoltTaskMeta }>('/api/reorder-index', {
    method: 'POST',
    body: JSON.stringify({ id, toIndex }),
  });
}

export function updateTask(
  id: string,
  patch: { status?: HoltStatus; lane?: string },
) {
  return req<{ task: HoltTaskMeta }>('/api/update', {
    method: 'POST',
    body: JSON.stringify({ id, ...patch }),
  });
}

export function fetchHistory(taskId?: string) {
  const q = taskId ? `?task=${encodeURIComponent(taskId)}` : '';
  return req<{ events: HoltEvent[] }>(`/api/history${q}`);
}

export function openTaskFile(id: string) {
  return req<{ path: string; opened: boolean }>('/api/open', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

/** Subscribe to ledger file changes (SSE). Returns unsubscribe. */
export function subscribeLedgerWatch(onChange: () => void): () => void {
  const es = new EventSource('/api/watch');
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as { type?: string };
      if (data.type === 'change') onChange();
    } catch {
      /* ignore malformed */
    }
  };
  es.onerror = () => {
    /* browser auto-reconnects EventSource */
  };
  return () => es.close();
}
