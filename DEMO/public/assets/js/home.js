import {
  api, escapeHtml, compactNumber, padded, formatDate, debounce, prefersReducedMotion,
} from './api.js';
import {
  $, $$, bindGlass, initReveal, initHeader, initTilt, initTheme, initDialogs,
  initFooter, toast,
} from './ui.js';
import { bootDone } from './boot.js';

const LAYOUT_KEY = 'om-journal-layout';
const state = {
  category: 'all',
  sort: 'new',
  layout: 'grid',
  offset: 0,
  limit: 6,
  total: 0,
  items: [],
  loading: false,
  meta: null,
  controller: null,
  projects: { launches: [], engines: [] },
  launchStatus: 'all',
  engineStatus: 'all',
};

try {
  const saved = localStorage.getItem(LAYOUT_KEY);
  if (saved === 'grid' || saved === 'list') state.layout = saved;
} catch { /* storage unavailable */ }

const grid = $('#postGrid');
const filters = $('#journalFilters');
const resultCount = $('#resultCount');
const resultHint = $('#resultHint');
const moreWrap = $('#journalMoreWrap');
const loadMore = $('#loadMore');
const sortSelect = $('#sortSelect');
const layoutSwitch = $('#layoutSwitch');

bindGlass();
initTheme();
initHeader();
initDialogs();
initTilt();
initFooter();
applyLayout(state.layout);

/* ═══════════════ Data ═══════════════ */

const metaPromise = loadMeta();
metaPromise.finally(() => {
  bootDone.then(() => {
    initReveal();
    animateStats();
  });
});

loadPosts({ reset: true });
loadProjects();
bindMissionDialog();

async function loadMeta() {
  try {
    const data = await api('/meta');
    state.meta = data;
    applyMeta(data);
    return data;
  } catch (error) {
    toast(error.message || '站点信息加载失败。', { type: 'error' });
    return null;
  }
}

function applyMeta(data) {
  const { settings = {}, stats = {}, categories = [] } = data;
  renderFilters(categories, stats.posts || 0);
  initMission(settings);

  const aboutLocation = $('#aboutLocation');
  const aboutNow = $('#aboutNow');
  const aboutTools = $('#aboutTools');
  if (aboutLocation && settings['site.location']) aboutLocation.textContent = settings['site.location'];
  if (aboutNow && settings['site.now']) aboutNow.textContent = settings['site.now'];
  if (aboutTools && settings['site.tools']) aboutTools.textContent = settings['site.tools'];
  const newsletterNote = $('#subscribeNote');
  if (newsletterNote && settings['newsletter.note']) newsletterNote.textContent = settings['newsletter.note'];

  if (settings['mission.title']) {
    const mini = $('#missionTitleMini');
    if (mini) mini.textContent = settings['mission.title'].slice(0, 14);
  }
  if (settings['mission.site']) {
    const site = $('#missionSite');
    if (site) site.textContent = settings['mission.site'];
  }
}

function renderFilters(categories, postCount) {
  if (!filters) return;
  const all = [{ name: 'all', label: '全部', count: postCount }, ...categories.map((item) => ({
    name: item.name,
    label: item.name,
    count: item.count,
  }))];
  if (!all.some((item) => item.name === state.category)) state.category = 'all';
  filters.innerHTML = all.map((item) => `
    <button class="chip${item.name === state.category ? ' is-active' : ''}" type="button"
      data-category="${escapeHtml(item.name)}" aria-pressed="${item.name === state.category}">
      ${escapeHtml(item.label)} <span class="chip__count">${padded(item.count)}</span>
    </button>
  `).join('');
}

async function loadPosts({ reset = false } = {}) {
  if (!grid) return;
  if (state.controller) state.controller.abort();
  const controller = new AbortController();
  state.controller = controller;
  state.loading = true;
  grid.setAttribute('aria-busy', 'true');
  if (loadMore) {
    loadMore.disabled = true;
    loadMore.textContent = '正在接收遥测…';
  }

  if (reset) {
    state.offset = 0;
    state.items = [];
    renderSkeletons();
  }

  const params = new URLSearchParams({
    category: state.category,
    sort: state.sort,
    limit: String(state.limit),
    offset: String(state.offset),
  });

  try {
    const data = await api(`/posts?${params}`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.total = data.total;
    state.items = reset ? data.items : [...state.items, ...data.items];
    state.offset = state.items.length;
    if (data.categories) renderFilters(data.categories, state.meta?.stats?.posts || data.total);
    renderPosts();
  } catch (error) {
    if (error.name === 'AbortError') return;
    renderLoadError(error);
    toast(error.message || '文章加载失败。', { type: 'error' });
  } finally {
    if (state.controller === controller) {
      state.loading = false;
      state.controller = null;
      grid.setAttribute('aria-busy', 'false');
      if (loadMore) {
        loadMore.disabled = false;
        loadMore.textContent = '加载更多手记';
      }
    }
  }
}

function renderSkeletons() {
  grid.dataset.layout = state.layout;
  grid.innerHTML = Array.from({ length: 3 }, () => '<div class="skeleton-card" aria-hidden="true"></div>').join('');
  if (moreWrap) moreWrap.hidden = true;
}

function renderPosts() {
  if (!grid) return;
  grid.dataset.layout = state.layout;
  if (!state.items.length) {
    grid.innerHTML = `
      <div class="journal-empty">
        <span class="journal-empty__orb" aria-hidden="true"></span>
        <h3>这条轨道暂时是空的</h3>
        <p>${state.category === 'all' ? '第一篇文章正在总装，很快与大家见面。' : '这个分类还没有公开的记录，换一个频道看看？'}</p>
        ${state.category === 'all' ? '' : '<button class="btn btn--sm" type="button" data-reset-filter>查看全部手记</button>'}
      </div>`;
    resultCount.textContent = '00';
    resultHint.textContent = '等待新的记录';
    if (moreWrap) moreWrap.hidden = true;
    return;
  }

  const useFeatured = state.layout === 'grid' && state.category === 'all' && state.sort === 'new';
  grid.innerHTML = state.items.map((post, index) => {
    const featured = useFeatured && index === 0 && post.featured;
    return postCard(post, index, featured);
  }).join('');

  resultCount.textContent = padded(state.total);
  const hints = { new: '按发布时间排序', old: '按时间正序排列', popular: '按阅读与共鸣排序' };
  resultHint.textContent = hints[state.sort] || hints.new;
  if (moreWrap) moreWrap.hidden = state.items.length >= state.total;
}

function postCard(post, index, featured) {
  const tags = (post.tags || []).slice(0, 2);
  const likes = post.likes ? ` · ${compactNumber(post.likes)} 共鸣` : '';
  return `
    <a class="post-card${featured ? ' post-card--featured' : ''}" href="/post/${encodeURIComponent(post.slug)}"
       style="--i:${Math.min(index, 6)}" aria-label="${escapeHtml(post.title)}">
      <div class="post-cover" data-cover="${escapeHtml(post.cover || 'glass')}">
        <span class="post-cover__wash" aria-hidden="true"></span>
        <span class="post-cover__grid" aria-hidden="true"></span>
        <span class="post-cover__ring" aria-hidden="true"></span>
        <span class="post-cover__ring post-cover__ring--b" aria-hidden="true"></span>
        <span class="post-cover__orb" aria-hidden="true"></span>
        <span class="post-cover__shine" aria-hidden="true"></span>
        ${featured ? '<span class="post-cover__badge"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .8 7.5 4.5 11.2 6 7.5 7.5 6 11.2 4.5 7.5.8 6 4.5 4.5z"/></svg>编辑精选</span>' : ''}
        <span class="post-cover__label">FIG. ${padded(index + 1)} · ${escapeHtml(post.category)}</span>
      </div>
      <div class="post-card__body">
        <div class="post-card__meta">
          <span class="post-card__cat">${escapeHtml(post.category)}</span>
          <i aria-hidden="true"></i>
          <span>${formatDate(post.publishedAt)}</span>
          <i aria-hidden="true"></i>
          <span>${post.readingMinutes || 5} min</span>
        </div>
        <h3 class="post-card__title">${escapeHtml(post.title)}</h3>
        <p class="post-card__excerpt">${escapeHtml(post.excerpt)}</p>
        <div class="post-card__foot">
          <div class="post-card__tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
          <span class="post-card__more">${compactNumber(post.views)} 阅读${likes}
            <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5"/></svg>
          </span>
        </div>
      </div>
    </a>`;
}

function renderLoadError(error) {
  if (!grid) return;
  if (state.items.length) {
    toast('更多文章加载失败，请稍后重试。', { type: 'error' });
    return;
  }
  grid.innerHTML = `
    <div class="journal-empty">
      <span class="journal-empty__orb" aria-hidden="true"></span>
      <h3>遥测暂时中断</h3>
      <p>${escapeHtml(error?.message || '无法连接到文章服务。')}</p>
      <button class="btn btn--sm" type="button" data-retry>重新连接</button>
    </div>`;
  resultCount.textContent = '--';
  resultHint.textContent = 'Signal lost';
}

/* ═══════════════ Projects & achievements ═══════════════ */

const LAUNCH_LABELS = { success: '成功', partial: '部分成功', fail: '失败' };
const ENGINE_LABELS = { active: '在役', dev: '研发中', retired: '退役' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

async function loadProjects() {
  try {
    const data = await api('/projects');
    state.projects = {
      launches: Array.isArray(data.launches) ? data.launches : [],
      engines: Array.isArray(data.engines) ? data.engines : [],
    };
    renderProjectControls();
    renderLaunches();
    renderEngines();
  } catch (error) {
    const launchList = $('#launchList');
    const engineList = $('#engineList');
    const markup = `<div class="project-empty"><span class="badge">Signal Lost</span><h4>档案暂时不可用</h4><p>${escapeHtml(error.message || '请稍后重试。')}</p></div>`;
    if (launchList) launchList.innerHTML = markup;
    if (engineList) engineList.innerHTML = markup;
  }
}

function renderProjectControls() {
  const launches = state.projects.launches;
  const engines = state.projects.engines;
  const launchCounts = launches.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const engineCounts = engines.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  $('#launchCount').textContent = `${padded(launches.length)} 次`;
  $('#engineCount').textContent = `${padded(engines.length)} 台`;
  syncProjectFilter('#launchFilters', 'data-launch-status', launchCounts, launches.length, state.launchStatus);
  syncProjectFilter('#engineFilters', 'data-engine-status', engineCounts, engines.length, state.engineStatus);
}

function syncProjectFilter(selector, attribute, counts, total, active) {
  $$(`${selector} [${attribute}]`).forEach((button) => {
    const key = button.getAttribute(attribute);
    const count = key === 'all' ? total : (counts[key] || 0);
    const countEl = button.querySelector('.chip__count');
    if (countEl) countEl.textContent = padded(count);
    const isActive = key === active;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function renderLaunches() {
  const list = $('#launchList');
  if (!list) return;
  const items = state.projects.launches.filter((item) => state.launchStatus === 'all' || item.status === state.launchStatus);
  if (!items.length) {
    list.innerHTML = `<div class="project-empty">
      <span class="project-empty__orb" aria-hidden="true"></span>
      <span class="badge">No Records</span>
      <h4>${state.launchStatus === 'all' ? '测试记录整理中' : '这个筛选下还没有记录'}</h4>
      <p>${state.launchStatus === 'all' ? '历史试飞数据正在校对，稍后开放查阅。' : '换一个状态，查看其他测试结果。'}</p>
    </div>`;
    return;
  }
  list.innerHTML = items.map((item) => {
    const date = new Date(item.date);
    const day = Number.isNaN(date.getTime()) ? '--' : String(date.getDate()).padStart(2, '0');
    const month = Number.isNaN(date.getTime()) ? '---' : MONTHS[date.getMonth()];
    const meta = [item.vehicle, item.payload && item.payload !== '—' ? `载荷 ${item.payload}` : ''].filter(Boolean).join(' · ');
    return `<article class="project-record">
      <div class="record-date"><b>${day}</b><span>${month}</span></div>
      <div class="record-main">
        <div class="record-heading">
          <h4>${escapeHtml(item.name)}</h4>
          <span class="record-status" data-status="${escapeHtml(item.status)}">${LAUNCH_LABELS[item.status] || item.status}</span>
        </div>
        ${meta ? `<p class="record-meta">${escapeHtml(meta)}</p>` : ''}
        ${item.note ? `<p class="record-note">${escapeHtml(item.note)}</p>` : ''}
      </div>
    </article>`;
  }).join('');
}

function renderEngines() {
  const list = $('#engineList');
  if (!list) return;
  const items = state.projects.engines.filter((item) => state.engineStatus === 'all' || item.status === state.engineStatus);
  if (!items.length) {
    list.innerHTML = `<div class="project-empty">
      <span class="project-empty__orb" aria-hidden="true"></span>
      <span class="badge">No Records</span>
      <h4>${state.engineStatus === 'all' ? '发动机档案整理中' : '这个状态下还没有型号'}</h4>
      <p>${state.engineStatus === 'all' ? '型号参数与试车数据即将上线。' : '换一个状态，查看其他发动机。'}</p>
    </div>`;
    return;
  }
  list.innerHTML = items.map((item) => `<article class="engine-record">
    <div class="engine-head">
      <span class="engine-code">${escapeHtml(item.code)}</span>
      <span class="record-status" data-status="${escapeHtml(item.status)}">${ENGINE_LABELS[item.status] || item.status}</span>
    </div>
    <h4>${escapeHtml(item.name)}</h4>
    <div class="engine-specs">
      <span><small>Propellant</small><b>${escapeHtml(item.propellant || '—')}</b></span>
      <span><small>Thrust</small><b>${escapeHtml(item.thrust || '—')}</b></span>
      <span><small>Isp</small><b>${escapeHtml(item.isp || '—')}</b></span>
    </div>
    ${item.note ? `<p class="engine-note">${escapeHtml(item.note)}</p>` : ''}
  </article>`).join('');
}

$('#launchFilters')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-launch-status]');
  if (!button) return;
  state.launchStatus = button.dataset.launchStatus;
  syncProjectFilter('#launchFilters', 'data-launch-status',
    state.projects.launches.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}),
    state.projects.launches.length, state.launchStatus);
  renderLaunches();
});

$('#engineFilters')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-engine-status]');
  if (!button) return;
  state.engineStatus = button.dataset.engineStatus;
  syncProjectFilter('#engineFilters', 'data-engine-status',
    state.projects.engines.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}),
    state.projects.engines.length, state.engineStatus);
  renderEngines();
});

/* ═══════════════ Mission request ═══════════════ */

function bindMissionDialog() {
  const dialog = $('#missionDialog');
  const form = $('#missionRequestForm');
  if (!dialog || !form) return;
  const success = $('#missionSuccess');
  const reference = $('#missionReference');
  const message = $('#missionFormMessage');
  const submit = $('#missionSubmit');

  const open = () => {
    form.hidden = false;
    success.hidden = true;
    form.reset();
    message.className = 'form-message';
    message.textContent = '';
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => $('#missionBatch')?.focus({ preventScroll: true }), 80);
  };

  $$('[data-open-mission]').forEach((button) => button.addEventListener('click', open));
  $('#missionSuccessClose')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    form.hidden = false;
    success.hidden = true;
    form.reset();
    message.className = 'form-message';
    message.textContent = '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (!submit || submit.disabled) return;
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = '正在写入任务队列…';
    message.className = 'form-message';
    message.textContent = '';
    try {
      const data = await api('/mission-requests', {
        method: 'POST',
        body: {
          batch: $('#missionBatch').value.trim(),
          type: $('#missionType').value,
          mass: Number($('#missionMass').value),
          altitude: Number($('#missionAltitude').value),
          lifetime: Number($('#missionLifetime').value),
        },
      });
      form.hidden = true;
      success.hidden = false;
      if (reference) reference.textContent = data.reference || 'MSN----';
      toast('卫星参数已进入任务队列。');
      $('#missionSuccessClose')?.focus({ preventScroll: true });
    } catch (error) {
      message.className = 'form-message is-error';
      message.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = original;
    }
  });
}

/* ═══════════════ Filters & layout ═══════════════ */

filters?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button || button.dataset.category === state.category) return;
  setCategory(button.dataset.category);
});

function setCategory(category) {
  state.category = category;
  filters?.querySelectorAll('[data-category]').forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  loadPosts({ reset: true });
}

sortSelect?.addEventListener('change', () => {
  state.sort = sortSelect.value;
  loadPosts({ reset: true });
});

layoutSwitch?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-layout]');
  if (!button) return;
  const layout = button.dataset.layout;
  if (layout !== 'grid' && layout !== 'list') return;
  state.layout = layout;
  applyLayout(layout);
  if (state.items.length) renderPosts();
});

function applyLayout(layout) {
  if (grid) grid.dataset.layout = layout;
  layoutSwitch?.querySelectorAll('[data-layout]').forEach((button) => {
    const active = button.dataset.layout === layout;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* ignore */ }
}

loadMore?.addEventListener('click', () => loadPosts());
grid?.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) loadPosts({ reset: true });
  if (event.target.closest('[data-reset-filter]')) setCategory('all');
});

$$('[data-lab-filter]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    setCategory(link.dataset.labFilter);
    $('#journal')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  });
});

/* ═══════════════ Mission telemetry ═══════════════ */

function initMission(settings) {
  const target = Date.parse(settings['mission.target'] || '2028-06-01T12:00:00.000Z');
  if (!Number.isFinite(target)) return;
  const cycle = 900 * 86400_000;
  const start = target - cycle;
  const daysEl = $('#cdDays');
  const hoursEl = $('#cdHours');
  const minutesEl = $('#cdMinutes');
  const secondsEl = $('#cdSeconds');
  const bar = $('#missionBar');
  const pctEl = $('#missionPct');
  const status = $('#missionStatus');
  const statusText = $('#missionStatusText');
  const targetEl = $('#missionTarget');
  const card = $('#missionCard');

  if (targetEl) {
    const date = new Date(target);
    const pad = (n) => String(n).padStart(2, '0');
    targetEl.textContent = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
  }

  const tick = () => {
    const now = Date.now();
    const diff = target - now;
    const rawPct = ((now - start) / cycle) * 100;
    const pct = Math.max(0, Math.min(100, rawPct));
    if (bar) bar.style.width = `${pct.toFixed(2)}%`;
    if (pctEl) pctEl.textContent = `${pct.toFixed(1)}%`;

    if (diff <= 0) {
      if (daysEl) daysEl.textContent = '000';
      if (hoursEl) hoursEl.textContent = '00';
      if (minutesEl) minutesEl.textContent = '00';
      if (secondsEl) secondsEl.textContent = '00';
      if (statusText) statusText.textContent = '窗口已开启';
      status?.classList.remove('is-hold');
      if (card) card.setAttribute('aria-label', '发射窗口已开启');
      return;
    }

    const sec = Math.floor(diff / 1000);
    if (daysEl) daysEl.textContent = padded(Math.floor(sec / 86400), 3);
    if (hoursEl) hoursEl.textContent = padded(Math.floor((sec % 86400) / 3600));
    if (minutesEl) minutesEl.textContent = padded(Math.floor((sec % 3600) / 60));
    if (secondsEl) secondsEl.textContent = padded(sec % 60);

    let label = '待发射';
    let hold = false;
    if (diff < 2 * 86400_000) { label = '进入发射窗口'; hold = true; }
    else if (diff < 30 * 86400_000) { label = '发射前准备'; hold = true; }
    if (statusText) statusText.textContent = label;
    status?.classList.toggle('is-hold', hold);
    if (card) card.setAttribute('aria-label', `下一次发射倒计时 ${Math.floor(sec / 86400)} 天`);
  };

  tick();
  window.setInterval(tick, 1000);
}

/* ═══════════════ Stats ═══════════════ */

function animateStats() {
  const stats = state.meta?.stats;
  if (!stats) return;
  animateValue($('#statPosts'), stats.posts, (v) => padded(v));
  animateValue($('#statViews'), stats.views, (v) => compactNumber(v));
  animateValue($('#statYears'), state.meta?.years || 6, (v) => String(v));
  animateValue($('#statLikes'), stats.likes, (v) => compactNumber(v));
}

function animateValue(element, target, format) {
  if (!element) return;
  const end = Number(target) || 0;
  if (prefersReducedMotion() || end === 0) {
    element.textContent = format(end);
    return;
  }
  const duration = 1500;
  const start = performance.now();
  const frame = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = format(Math.round(end * eased));
    if (progress < 1) requestAnimationFrame(frame);
    else element.textContent = format(end);
  };
  element.textContent = format(0);
  requestAnimationFrame(frame);
}

/* ═══════════════ Search palette ═══════════════ */

const searchDialog = $('#searchDialog');
const searchInput = $('#searchInput');
const searchResults = $('#searchResults');
let searchIndex = 0;
let searchAbort = null;

const openSearch = () => {
  if (!searchDialog?.showModal) return;
  if (!searchDialog.open) searchDialog.showModal();
  if (searchInput) {
    searchInput.value = '';
    window.setTimeout(() => searchInput.focus(), 60);
  }
  renderSearchIdle();
};

$('#searchTrigger')?.addEventListener('click', openSearch);
$('#inlineSearch')?.addEventListener('click', openSearch);
document.addEventListener('keydown', (event) => {
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (searchDialog?.open) searchDialog.close();
    else openSearch();
  }
  if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !searchDialog?.open) {
    event.preventDefault();
    openSearch();
  }
});

const performSearch = debounce(async (query) => {
  if (!query) { renderSearchIdle(); return; }
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  renderSearchMessage('正在检索轨道记录…');
  try {
    const data = await api(`/posts?q=${encodeURIComponent(query)}&limit=7&sort=new`, { signal: searchAbort.signal });
    if (!data.items.length) {
      renderSearchMessage(`没有找到与「${query}」相关的记录。`);
      return;
    }
    renderSearchResults(data.items, `找到 ${data.total} 条记录`);
  } catch (error) {
    if (error.name !== 'AbortError') renderSearchMessage(error.message || '搜索失败，请重试。');
  }
}, 180);

searchInput?.addEventListener('input', () => performSearch(searchInput.value.trim()));
searchInput?.addEventListener('keydown', (event) => {
  const items = $$('.search-result', searchResults);
  if (!items.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    searchIndex = (searchIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((item, index) => item.classList.toggle('is-active', index === searchIndex));
    items[searchIndex].scrollIntoView({ block: 'nearest' });
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    items[searchIndex]?.click();
  }
});

searchResults?.addEventListener('click', (event) => {
  const item = event.target.closest('[data-href]');
  if (!item) return;
  searchDialog?.close();
  window.location.href = item.dataset.href;
});

function renderSearchIdle() {
  searchIndex = 0;
  const recent = state.items.slice(0, 4);
  if (!recent.length) {
    renderSearchMessage('输入关键词，搜索手记、标签与内容。');
    return;
  }
  renderSearchResults(recent, '最近更新', false);
}

function renderSearchResults(items, label, showLabel = true) {
  searchIndex = 0;
  const prefix = showLabel ? `<p class="search-empty" style="padding:6px 12px 8px;text-align:left;font-size:10px;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(label)}</p>` : '';
  searchResults.innerHTML = prefix + items.map((post) => `
    <button class="search-result" type="button" role="option" data-href="/post/${encodeURIComponent(post.slug)}">
      <span class="search-result__icon" aria-hidden="true">
        <svg viewBox="0 0 16 16"><path d="M3 2.5h7.5L13 5v8.5H3z"/><path d="M10.5 2.5V5H13M5.5 8h5M5.5 10.5h3.5"/></svg>
      </span>
      <span>
        <span class="search-result__title">${escapeHtml(post.title)}</span>
        <span class="search-result__meta">${escapeHtml(post.category)} · ${formatDate(post.publishedAt)} · ${post.readingMinutes || 5} min</span>
      </span>
      <span class="search-result__arrow" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5"/></svg></span>
    </button>`).join('');
  $$('.search-result', searchResults)[0]?.classList.add('is-active');
}

function renderSearchMessage(message) {
  searchResults.innerHTML = `<p class="search-empty">${escapeHtml(message)}</p>`;
}

/* ═══════════════ Newsletter & contact ═══════════════ */

const subscribeForm = $('#subscribeForm');
subscribeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#subscribeEmail');
  const button = $('#subscribeBtn');
  const message = $('#subscribeMessage');
  if (!input?.checkValidity()) { input?.reportValidity(); return; }
  if (!button || button.disabled) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = '发送中…';
  message.className = 'form-message';
  message.textContent = '';
  try {
    const data = await api('/subscribe', { method: 'POST', body: { email: input.value.trim(), source: 'newsletter' } });
    message.className = 'form-message is-success';
    message.textContent = data.message;
    toast(data.message);
    subscribeForm.reset();
  } catch (error) {
    message.className = 'form-message is-error';
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

const contactForm = $('#contactForm');
contactForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('#contactMessageStatus');
  const button = $('#contactSubmit');
  if (!contactForm.checkValidity()) { contactForm.reportValidity(); return; }
  if (!button || button.disabled) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = '发送中…';
  status.className = 'form-message';
  status.textContent = '';
  try {
    const data = await api('/contact', {
      method: 'POST',
      body: {
        name: $('#contactName').value.trim(),
        email: $('#contactEmail').value.trim(),
        subject: $('#contactSubject').value.trim(),
        message: $('#contactMessage').value.trim(),
      },
    });
    status.className = 'form-message is-success';
    status.textContent = data.message;
    toast(data.message);
    window.setTimeout(() => {
      $('#contactDialog')?.close();
      contactForm.reset();
      status.textContent = '';
    }, 900);
  } catch (error) {
    status.className = 'form-message is-error';
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

/* Keyboard-visible polish for the opening state. */
window.addEventListener('pageshow', (event) => {
  if (event.persisted) document.documentElement.classList.add('is-ready');
});
