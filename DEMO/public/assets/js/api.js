export class ApiError extends Error {
  constructor(message, status = 0, code = 'network_error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('网络连接中断，请检查后重试。', 0, 'network_error');
  }

  let payload = null;
  try { payload = await response.json(); } catch { /* non-JSON gateway response */ }
  if (!response.ok || !payload?.ok) {
    throw new ApiError(
      payload?.error?.message || `请求失败（${response.status}）`,
      response.status,
      payload?.error?.code || 'request_failed'
    );
  }
  return payload.data;
}

export const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function compactNumber(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function padded(value, size = 2) {
  return String(Math.max(0, Number(value) || 0)).padStart(size, '0');
}

export function formatDate(value, style = 'dot') {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  if (style === 'long') {
    return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
  }
  return `${y}.${m}.${d}`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function timeAgo(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '—';
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

export function debounce(fn, wait = 160) {
  let timer = 0;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
