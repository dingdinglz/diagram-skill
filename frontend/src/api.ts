import type { Graph, Task, TaskSummary, HistoricalVersion } from './types';

const params = new URLSearchParams(window.location.hash.slice(1));
const key = `flowplan:token:${window.location.origin}`;
const suppliedToken = params.get('token');
if (suppliedToken) {
  sessionStorage.setItem(key, suppliedToken);
  params.delete('token');
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${params.size ? `#${params}` : ''}`);
}
export const initialTaskId = params.get('task');
export const hasToken = () => !!sessionStorage.getItem(key);
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${sessionStorage.getItem(key) || ''}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: `请求失败 (${response.status})` }));
    throw new ApiError(response.status, data.error || '请求失败');
  }
  return response.json() as Promise<T>;
}
export const api = {
  list: () => request<TaskSummary[]>('/tasks'),
  create: (title: string, mode: 'manual' | 'agent' = 'manual', graph?: Graph) => request<Task>('/tasks', 'POST', { title, mode, ...(graph ? { graph } : {}) }),
  task: (id: string) => request<Task>(`/tasks/${encodeURIComponent(id)}`),
  save: (id: string, revision: number, graph: Graph) => request<Task>(`/tasks/${encodeURIComponent(id)}/draft`, 'PUT', { revision, graph }),
  action: (id: string, action: string, body: unknown) => request<Task>(`/tasks/${encodeURIComponent(id)}/${action}`, 'POST', body),
  version: (id: string, version: string) => request<HistoricalVersion>(`/tasks/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`),
};
export async function downloadArtifact(taskId: string, version: string, file: string) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/versions/${encodeURIComponent(version)}/${file}`, {
    headers: { Authorization: `Bearer ${sessionStorage.getItem(key) || ''}` },
  });
  if (!response.ok) throw new Error('这个版本的文件尚不存在，或当前会话已失效。');
  saveBlob(await response.blob(), `${taskId}-${version}-${file}`);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
