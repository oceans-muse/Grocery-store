import {
  api, escapeHtml, compactNumber, padded, formatDate, formatDateTime, timeAgo, debounce,
} from './api.js';
import { $, $$, bindGlass, initTheme, initDialogs, toast } from './ui.js';

const loginView = $('#loginView');
const loginForm = $('#loginForm');
const loginError = $('#loginError');
const loginSubmit = $('#loginSubmit');
const adminShell = $('#adminShell');
const adminView = $('#adminView');
const adminTitle = $('#adminTitle');
const adminEyebrow = $('#adminEyebrow');
const confirmDialog = $('#confirmDialog');

const VIEW_META = {
  overview: { eyebrow: 'Mission Control · 概览', title: '概览', nav: 'overview' },
  posts: { eyebrow: 'Content · 内容', title: '手记', nav: 'posts' },
  projects: { eyebrow: 'Archive · 项目', title: '项目与成就', nav: 'projects' },
  missions: { eyebrow: 'Payload · 任务', title: '卫星参数申请', nav: 'missions' },
  comments: { eyebrow: 'Signals · 读者', title: '评论', nav: 'comments' },
  subscribers: { eyebrow: 'Audience · 订阅', title: '订阅者', nav: 'subscribers' },
  messages: { eyebrow: 'Inbox · 信号', title: '联系消息', nav: 'messages' },
  settings: { eyebrow: 'Configuration · 站点', title: '设置', nav: 'settings' },
  editor: { eyebrow: 'Composer · 编排', title: '新建手记', nav: 'posts' },
};

const COVERS = [
  ['glass', '玻璃'], ['ignition', '点火'], ['separation', '分离'], ['catia', '图纸'],
  ['telemetry', '遥测'], ['letter', '书信'], ['silence', '静默'], ['weightless', '失重'],
];

const state = {
  user: null,
  stats: null,
  settings: {},
  view: 'overview',
  posts: [],
  projects: { launches: [], engines: [] },
  projectTab: 'launches',
  missions: [],
  postStatus: 'all',
  postQuery: '',
  commentFilter: '',
  subscribers: [],
  messages: [],
  editorDirty: false,
  editorId: null,
  recordType: 'launch',
  recordId: null,
};

let postsController = null;
let authChecked = false;

bindGlass();
initTheme();
initDialogs();
bindStatic();
checkAuth();

/* ═══════════════ Boot & auth ═══════════════ */

async function checkAuth() {
  try {
    const data = await api('/auth/me');
    state.user = data.user;
    showDashboard();
  } catch (error) {
    authChecked = true;
    showLogin(error.status === 401 ? '' : error.message);
  }
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!loginForm.checkValidity()) { loginForm.reportValidity(); return; }
  loginSubmit.disabled = true;
  const original = loginSubmit.innerHTML;
  loginSubmit.textContent = '正在验证…';
  loginError.className = 'form-message';
  loginError.textContent = '';
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: {
        username: $('#loginUser').value.trim(),
        password: $('#loginPass').value,
      },
    });
    state.user = data.user;
    loginForm.reset();
    showDashboard();
    toast('欢迎回来。');
  } catch (error) {
    loginError.className = 'form-message is-error';
    loginError.textContent = error.message;
    $('#loginPass').select();
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.innerHTML = original;
  }
});

$('#togglePass')?.addEventListener('click', (event) => {
  const input = $('#loginPass');
  const button = event.currentTarget;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  input.focus({ preventScroll: true });
});

function showLogin(message = '') {
  adminShell.hidden = true;
  loginView.hidden = false;
  document.title = '工作台 · oceans-muse';
  if (message) {
    loginError.className = 'form-message is-error';
    loginError.textContent = message;
  }
  window.setTimeout(() => $('#loginUser')?.focus({ preventScroll: true }), 80);
}

function showDashboard() {
  authChecked = true;
  loginView.hidden = true;
  adminShell.hidden = false;
  renderUser();
  routeFromHash();
  loadOverviewSummary();
}

function renderUser() {
  const name = state.user?.displayName || 'oceans-muse';
  const parts = name.split(/[\s-]+/).filter(Boolean);
  const initials = (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase() || 'OM';
  $('#adminUserName').textContent = name;
  $('#adminAvatar').textContent = initials;
}

$('#logoutBtn')?.addEventListener('click', async () => {
  const confirmed = await confirmAction('退出后需要重新输入密码才能进入工作台。', '确认退出登录？');
  if (!confirmed) return;
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch { /* the local session is cleared regardless */ }
  state.user = null;
  showLogin('已退出登录。');
  toast('已退出工作台。');
});

/* ═══════════════ Router ═══════════════ */

function bindStatic() {
  $$('.admin-nav__item').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.view));
  });
  $('#newPostBtn')?.addEventListener('click', () => navigate('editor/new'));
  $('#recordForm')?.addEventListener('submit', submitRecordForm);
  window.addEventListener('hashchange', routeFromHash);
  window.addEventListener('beforeunload', (event) => {
    if (!state.editorDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function navigate(route) {
  const hash = `#${route}`;
  if (location.hash === hash) routeFromHash();
  else location.hash = hash;
}

function routeFromHash() {
  if (!state.user) return;
  const hash = location.hash.replace(/^#/, '') || 'overview';
  if (hash.startsWith('editor/')) {
    const id = hash.split('/')[1];
    renderEditor(id === 'new' ? null : Number(id));
    return;
  }
  const allowed = ['overview', 'posts', 'projects', 'missions', 'comments', 'subscribers', 'messages', 'settings'];
  const view = allowed.includes(hash) ? hash : 'overview';
  state.view = view;
  setTopbar(view);
  setActiveNav(VIEW_META[view].nav);
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (view === 'overview') renderOverview();
  if (view === 'posts') renderPostsView();
  if (view === 'projects') renderProjectsView();
  if (view === 'missions') renderMissionsView();
  if (view === 'comments') renderCommentsView();
  if (view === 'subscribers') renderSubscribersView();
  if (view === 'messages') renderMessagesView();
  if (view === 'settings') renderSettingsView();
}

function setTopbar(view) {
  const meta = VIEW_META[view] || VIEW_META.overview;
  adminEyebrow.textContent = meta.eyebrow;
  adminTitle.textContent = meta.title;
  document.title = `${meta.title} · 工作台 · oceans-muse`;
}

function setActiveNav(nav) {
  $$('.admin-nav__item').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === nav);
  });
}

function setLoading(count = 4) {
  adminView.innerHTML = `<div class="admin-loading">${'<span></span>'.repeat(count)}</div>`;
}

async function handleError(error, fallback = '操作失败，请稍后重试。') {
  if (error?.status === 401) {
    state.user = null;
    showLogin('登录状态已过期，请重新登录。');
    return;
  }
  toast(error?.message || fallback, { type: 'error' });
}

async function loadOverviewSummary() {
  try {
    const data = await api('/admin/overview');
    state.stats = data.stats;
    state.settings = data.settings || {};
    updateNavCounts(data.stats);
  } catch (error) {
    handleError(error);
  }
}

function updateNavCounts(stats) {
  if (!stats) return;
  $('#navPostCount').textContent = String(stats.posts ?? 0);
  $('#navProjectCount').textContent = String(stats.projects ?? '');
  $('#navMissionCount').textContent = String(stats.missionRequests ?? 0);
  $('#navCommentCount').textContent = String(stats.comments ?? 0);
  $('#navSubscriberCount').textContent = String(stats.subscribers ?? 0);
  $('#navMessageCount').textContent = String(stats.messages ?? 0);
}

/* ═══════════════ Overview ═══════════════ */

async function renderOverview() {
  setLoading(3);
  try {
    const data = await api('/admin/overview');
    state.stats = data.stats;
    state.settings = data.settings || {};
    updateNavCounts(data.stats);
    const stats = data.stats;
    const settings = data.settings || {};
    const recent = data.recent || { comments: [], messages: [] };

    adminView.innerHTML = `
      <div class="stat-grid">
        ${statCard('已发布手记', stats.posts, `${stats.drafts} 篇草稿`, iconDoc(), true)}
        ${statCard('总阅读', compactNumber(stats.views), '所有公开手记', iconEye())}
        ${statCard('读者共鸣', compactNumber(stats.likes), '喜欢与赞同', iconHeart())}
        ${statCard('任务简报订阅', stats.subscribers, '有效邮箱', iconMail())}
        ${statCard('评论', stats.comments, '读者信号', iconChat())}
        ${statCard('任务申请', stats.missionRequests, '待评估卫星参数', iconTarget())}
      </div>

      <div class="overview-grid">
        <div class="overview-stack">
          <section class="panel glass">
            <div class="panel__head">
              <div><h2>最近评论</h2><p>读者在轨道上留下的信号。</p></div>
              <button class="panel__link" type="button" data-go="comments">全部评论 →</button>
            </div>
            <div class="recent-list">
              ${recent.comments.length ? recent.comments.map((comment) => `
                <div class="recent-item">
                  <span class="recent-avatar">${escapeHtml((comment.author || '?').slice(0, 1))}</span>
                  <div class="recent-item__body">
                    <b>${escapeHtml(comment.author)}</b>
                    <p>${escapeHtml(comment.body)}</p>
                    <small>${escapeHtml(comment.postTitle)} · ${timeAgo(comment.createdAt)}</small>
                  </div>
                  <a class="recent-item__link" href="/post/${encodeURIComponent(comment.postSlug)}" target="_blank" rel="noopener" aria-label="查看文章">
                    <svg viewBox="0 0 14 14"><path d="M3 11 11 3M5 3h6v6"/></svg>
                  </a>
                </div>`).join('') : '<div class="empty-state" style="padding:34px 12px"><h3>还没有评论</h3><p>公开手记后，读者信号会出现在这里。</p></div>'}
            </div>
          </section>

          <section class="panel glass">
            <div class="panel__head">
              <div><h2>快捷操作</h2><p>常用动作，少一次点击。</p></div>
            </div>
            <div class="quick-actions">
              <button class="quick-action" type="button" data-go="editor/new">
                ${iconPlus()}<span>写一篇新的手记</span><b>N</b>
              </button>
              <button class="quick-action" type="button" data-go="comments">
                ${iconChat()}<span>处理读者评论</span><b>${stats.comments}</b>
              </button>
              <button class="quick-action" type="button" data-go="projects">
                ${iconRocket()}<span>维护项目与成就</span><b>${stats.projects}</b>
              </button>
              <button class="quick-action" type="button" data-go="missions">
                ${iconTarget()}<span>评估卫星参数申请</span><b>${stats.missionRequests}</b>
              </button>
              <button class="quick-action" type="button" data-go="subscribers">
                ${iconMail()}<span>导出订阅名单</span><b>${stats.subscribers}</b>
              </button>
              <a class="quick-action" href="/" target="_blank" rel="noopener">
                ${iconGlobe()}<span>在浏览器中查看站点</span><b>↗</b>
              </a>
            </div>
          </section>
        </div>

        <div class="overview-stack">
          <section class="panel glass">
            <div class="panel__head">
              <div><h2>下一次任务</h2><p>首页倒计时读取以下参数。</p></div>
              <button class="panel__link" type="button" data-go="settings">编辑 →</button>
            </div>
            <div class="mission-snapshot">
              <div class="mission-snapshot__row"><span>任务</span><b>${escapeHtml(settings['mission.title'] || '未命名')}</b></div>
              <div class="mission-snapshot__row"><span>窗口</span><b>${formatDateTime(settings['mission.target'])}</b></div>
              <div class="mission-snapshot__row"><span>发射场</span><b>${escapeHtml(settings['mission.site'] || '—')}</b></div>
              <div class="mission-snapshot__row"><span>状态</span><span class="status-pill" data-status="published">Tracking</span></div>
            </div>
          </section>

          <section class="panel glass">
            <div class="panel__head">
              <div><h2>最新信号</h2><p>来自联系表单的消息。</p></div>
              <button class="panel__link" type="button" data-go="messages">收件箱 →</button>
            </div>
            <div class="recent-list">
              ${recent.messages.length ? recent.messages.map((message) => `
                <div class="recent-item">
                  <span class="recent-avatar">${escapeHtml((message.name || '?').slice(0, 1))}</span>
                  <div class="recent-item__body">
                    <b>${escapeHtml(message.name)}</b>
                    <p>${escapeHtml(message.body)}</p>
                    <small>${timeAgo(message.createdAt)}</small>
                  </div>
                  <span class="status-pill" data-status="${message.status}">${statusLabel(message.status)}</span>
                </div>`).join('') : '<div class="empty-state" style="padding:34px 12px"><h3>收件箱为空</h3><p>新的联系消息会出现在这里。</p></div>'}
            </div>
          </section>
        </div>
      </div>`;

    adminView.onclick = (event) => {
      const target = event.target.closest('[data-go]');
      if (target) navigate(target.dataset.go);
    };
  } catch (error) {
    handleError(error);
  }
}

function statCard(label, value, note, icon, accent = false) {
  return `<article class="stat-card${accent ? ' stat-card--accent' : ''}">
    <div class="stat-card__label">${escapeHtml(label)}${icon}</div>
    <strong>${escapeHtml(String(value ?? 0))}</strong>
    <small>${escapeHtml(note)}</small>
  </article>`;
}

/* ═══════════════ Posts ═══════════════ */

function renderPostsView() {
  adminView.innerHTML = `
    <div class="admin-toolbar glass">
      <input class="input" id="postSearch" type="search" placeholder="搜索标题、摘要或标签…" value="${escapeHtml(state.postQuery)}" aria-label="搜索手记">
      <select class="select" id="postStatusFilter" aria-label="按状态筛选">
        <option value="all"${state.postStatus === 'all' ? ' selected' : ''}>全部状态</option>
        <option value="published"${state.postStatus === 'published' ? ' selected' : ''}>已发布</option>
        <option value="draft"${state.postStatus === 'draft' ? ' selected' : ''}>草稿</option>
      </select>
      <span class="admin-toolbar__spacer"></span>
      <button class="btn btn--sm" type="button" id="refreshPosts">刷新</button>
    </div>
    <div class="post-rows" id="postRows">
      ${Array.from({ length: 4 }, () => '<div class="admin-loading"><span style="height:64px"></span></div>').join('')}
    </div>`;

  $('#refreshPosts')?.addEventListener('click', loadPostRows);
  $('#postSearch')?.addEventListener('input', debounce((event) => {
    state.postQuery = event.target.value.trim();
    loadPostRows();
  }, 260));
  $('#postStatusFilter')?.addEventListener('change', (event) => {
    state.postStatus = event.target.value;
    loadPostRows();
  });

  $('#postRows')?.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-post-act]');
    if (!action) return;
    const id = Number(action.dataset.id);
    if (action.dataset.postAct === 'edit') navigate(`editor/${id}`);
    if (action.dataset.postAct === 'delete') {
      const post = state.posts.find((item) => item.id === id);
      const confirmed = await confirmAction(`「${post?.title || '这篇手记'}」将被永久删除，评论也会一并移除。`, '删除这篇手记？');
      if (!confirmed) return;
      try {
        await api(`/admin/posts/${id}`, { method: 'DELETE' });
        toast('手记已删除。');
        await loadPostRows();
        loadOverviewSummary();
      } catch (error) { handleError(error); }
    }
  });

  loadPostRows();
}

async function loadPostRows() {
  const rows = $('#postRows');
  if (!rows) return;
  if (postsController) postsController.abort();
  postsController = new AbortController();
  rows.setAttribute('aria-busy', 'true');
  try {
    const params = new URLSearchParams({
      status: state.postStatus,
      q: state.postQuery,
      sort: 'updated',
    });
    const data = await api(`/admin/posts?${params}`, { signal: postsController.signal });
    state.posts = data.items;
    rows.setAttribute('aria-busy', 'false');
    if (!data.items.length) {
      rows.innerHTML = `<div class="panel glass empty-state">
        <span>No records</span><h3>没有匹配的手记</h3>
        <p>${state.postQuery ? '试试别的关键词，或清空搜索。' : '从一篇新的手记开始。'}</p>
        <button class="btn btn--primary btn--sm" type="button" data-new-post>新建手记</button>
      </div>`;
      rows.querySelector('[data-new-post]')?.addEventListener('click', () => navigate('editor/new'));
      return;
    }
    rows.innerHTML = data.items.map((post) => `
      <article class="post-row">
        <span class="post-swatch" data-cover="${escapeHtml(post.cover)}" aria-hidden="true"></span>
        <div class="post-row__title">
          <b title="${escapeHtml(post.title)}">${escapeHtml(post.title)}</b>
          <span>${escapeHtml(post.category)} · /post/${escapeHtml(post.slug)}</span>
        </div>
        <span class="status-pill" data-status="${post.status}">${post.status === 'published' ? '已发布' : '草稿'}</span>
        <span class="post-row__meta">${post.publishedAt ? formatDate(post.publishedAt) : '未排期'}</span>
        <span class="post-row__meta">${compactNumber(post.views)} 阅读 · ${compactNumber(post.likes)} 共鸣</span>
        <div class="post-row__actions">
          <a class="icon-button" data-act="view" href="/post/${encodeURIComponent(post.slug)}" target="_blank" rel="noopener" aria-label="查看">
            <svg viewBox="0 0 16 16"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.8"/></svg>
          </a>
          <button class="icon-button" type="button" data-post-act="edit" data-id="${post.id}" aria-label="编辑">
            <svg viewBox="0 0 16 16"><path d="m2.5 11.5-.7 3 3-.7 8-8-2.3-2.3z"/><path d="m9.8 4.2 2.3 2.3"/></svg>
          </button>
          <button class="icon-button" type="button" data-post-act="delete" data-id="${post.id}" aria-label="删除">
            <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9M6.8 7v4M9.2 7v4"/></svg>
          </button>
        </div>
      </article>`).join('');
  } catch (error) {
    if (error.name === 'AbortError') return;
    rows.innerHTML = `<div class="panel glass empty-state"><h3>加载失败</h3><p>${escapeHtml(error.message)}</p><button class="btn btn--sm" type="button" id="retryPosts">重试</button></div>`;
    $('#retryPosts')?.addEventListener('click', loadPostRows);
  }
}

/* ═══════════════ Projects & achievements ═══════════════ */

const LAUNCH_STATUS_LABELS = { success: '成功', partial: '部分成功', fail: '失败' };
const ENGINE_STATUS_LABELS = { active: '在役', dev: '研发中', retired: '退役' };

async function renderProjectsView() {
  setLoading(3);
  try {
    const data = await api('/admin/projects');
    state.projects = data;
    adminView.innerHTML = `
      <div class="admin-toolbar glass">
        <div class="admin-tabs" role="tablist" aria-label="项目类型">
          <button type="button" class="is-active" data-project-tab="launches" role="tab" aria-selected="true">测试记录 <b>${padded(data.launches.length)}</b></button>
          <button type="button" data-project-tab="engines" role="tab" aria-selected="false">发动机 <b>${padded(data.engines.length)}</b></button>
        </div>
        <span class="admin-toolbar__spacer"></span>
        <button class="btn btn--primary btn--sm" type="button" id="addProjectRecord"></button>
      </div>
      <div id="projectAdminList"></div>`;

    $$('[data-project-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        state.projectTab = button.dataset.projectTab;
        $$('[data-project-tab]').forEach((item) => {
          const active = item === button;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-selected', String(active));
        });
        renderProjectAdminList();
      });
    });
    $('#addProjectRecord')?.addEventListener('click', () => openRecordDialog(state.projectTab === 'launches' ? 'launch' : 'engine'));
    renderProjectAdminList();
  } catch (error) { handleError(error); }
}

function renderProjectAdminList() {
  const host = $('#projectAdminList');
  const add = $('#addProjectRecord');
  if (!host) return;
  const launches = state.projectTab === 'launches';
  if (add) add.textContent = launches ? '新增测试记录' : '新增发动机';

  const items = launches ? state.projects.launches : state.projects.engines;
  if (!items.length) {
    host.innerHTML = `<div class="panel glass empty-state"><span>No records</span><h3>还没有${launches ? '测试记录' : '发动机档案'}</h3><p>点击右上角按钮添加第一条记录。</p></div>`;
    return;
  }

  host.innerHTML = `<div class="panel glass project-admin-panel">
    <div class="panel__head">
      <div><h2>${launches ? '测试记录' : '发动机档案'}</h2><p>${launches ? '成功、部分成功与失败都应被准确记录。' : '型号参数、推进剂与试车结果。'}</p></div>
      <span class="editor-count">${padded(items.length)} ${launches ? '次' : '台'}</span>
    </div>
    <div class="record-admin-list">
      ${launches ? items.map(launchAdminRow).join('') : items.map(engineAdminRow).join('')}
    </div>
  </div>`;

  host.querySelector('.record-admin-list')?.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-record-act]');
    if (!action) return;
    const id = Number(action.dataset.id);
    if (action.dataset.recordAct === 'edit') {
      const record = (launches ? state.projects.launches : state.projects.engines).find((item) => item.id === id);
      if (record) openRecordDialog(launches ? 'launch' : 'engine', record);
      return;
    }
    if (action.dataset.recordAct === 'delete') {
      const confirmed = await confirmAction('这条记录会从公开的项目与成就模块中移除。', '删除这条记录？');
      if (!confirmed) return;
      try {
        await api(`/admin/${launches ? 'launches' : 'engines'}/${id}`, { method: 'DELETE' });
        toast('记录已删除。');
        await renderProjectsView();
        loadOverviewSummary();
      } catch (error) { handleError(error); }
    }
  });
}

function launchAdminRow(item) {
  return `<article class="record-admin-row">
    <span class="record-admin-date"><b>${formatDate(item.date).slice(5).replace('.', '/')}</b><small>${formatDate(item.date).slice(0, 4)}</small></span>
    <div class="record-admin-main">
      <b>${escapeHtml(item.name)}</b>
      <span>${escapeHtml([item.vehicle, item.payload].filter((value) => value && value !== '—').join(' · ') || '未填写载体与载荷')}</span>
    </div>
    <span class="status-pill" data-status="${item.status}">${LAUNCH_STATUS_LABELS[item.status] || item.status}</span>
    <div class="record-admin-actions">
      <button class="icon-button" type="button" data-record-act="edit" data-id="${item.id}" aria-label="编辑">
        <svg viewBox="0 0 16 16"><path d="m2.5 11.5-.7 3 3-.7 8-8-2.3-2.3z"/><path d="m9.8 4.2 2.3 2.3"/></svg>
      </button>
      <button class="icon-button is-danger" type="button" data-record-act="delete" data-id="${item.id}" aria-label="删除">
        <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>
      </button>
    </div>
  </article>`;
}

function engineAdminRow(item) {
  return `<article class="record-admin-row record-admin-row--engine">
    <span class="record-admin-code">${escapeHtml(item.code)}</span>
    <div class="record-admin-main">
      <b>${escapeHtml(item.name)}</b>
      <span>${escapeHtml([item.propellant, item.thrust, item.isp].filter(Boolean).join(' · '))}</span>
    </div>
    <span class="status-pill" data-status="${item.status}">${ENGINE_STATUS_LABELS[item.status] || item.status}</span>
    <div class="record-admin-actions">
      <button class="icon-button" type="button" data-record-act="edit" data-id="${item.id}" aria-label="编辑">
        <svg viewBox="0 0 16 16"><path d="m2.5 11.5-.7 3 3-.7 8-8-2.3-2.3z"/><path d="m9.8 4.2 2.3 2.3"/></svg>
      </button>
      <button class="icon-button is-danger" type="button" data-record-act="delete" data-id="${item.id}" aria-label="删除">
        <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>
      </button>
    </div>
  </article>`;
}

function openRecordDialog(type, record = null) {
  const dialog = $('#recordDialog');
  if (!dialog) return;
  state.recordType = type;
  state.recordId = record?.id || null;
  const isLaunch = type === 'launch';
  $('#recordDialogEyebrow').textContent = isLaunch ? 'Launch Record · 测试记录' : 'Engine Archive · 发动机';
  $('#recordDialogTitle').textContent = `${record ? '编辑' : '新增'}${isLaunch ? '测试记录' : '发动机'}`;
  $('#recordMessage').className = 'form-message';
  $('#recordMessage').textContent = '';
  const fields = $('#recordFields');
  if (isLaunch) {
    fields.innerHTML = `
      <div class="field field--wide"><label for="recordName">名称</label><input class="input" id="recordName" value="${escapeHtml(record?.name || '')}" maxlength="120" placeholder="如 T-08 · 热分离验证" required></div>
      <div class="field"><label for="recordVehicle">载体 / 箭体</label><input class="input" id="recordVehicle" value="${escapeHtml(record?.vehicle || '')}" maxlength="80" placeholder="S-08 / B-13"></div>
      <div class="field"><label for="recordDate">日期</label><input class="input" id="recordDate" type="date" value="${record?.date ? toLocalInput(record.date).slice(0, 10) : toLocalInput(new Date().toISOString()).slice(0, 10)}"></div>
      <div class="field"><label for="recordStatus">结果</label><select class="select" id="recordStatus"><option value="success"${record?.status === 'success' ? ' selected' : ''}>成功</option><option value="partial"${record?.status === 'partial' ? ' selected' : ''}>部分成功</option><option value="fail"${record?.status === 'fail' ? ' selected' : ''}>失败</option></select></div>
      <div class="field"><label for="recordPayload">载荷</label><input class="input" id="recordPayload" value="${escapeHtml(record?.payload || '')}" maxlength="100" placeholder="12U 遥测舱"></div>
      <div class="field field--wide"><label for="recordNote">备注</label><textarea class="textarea" id="recordNote" maxlength="600" style="min-height:86px" placeholder="这次测试验证了什么？">${escapeHtml(record?.note || '')}</textarea></div>`;
  } else {
    fields.innerHTML = `
      <div class="field"><label for="recordCode">编号</label><input class="input" id="recordCode" value="${escapeHtml(record?.code || '')}" maxlength="24" placeholder="R-05" required></div>
      <div class="field"><label for="recordName">名称</label><input class="input" id="recordName" value="${escapeHtml(record?.name || '')}" maxlength="80" placeholder="甲烷发动机" required></div>
      <div class="field"><label for="recordStatus">状态</label><select class="select" id="recordStatus"><option value="active"${record?.status === 'active' ? ' selected' : ''}>在役</option><option value="dev"${record?.status === 'dev' ? ' selected' : ''}>研发中</option><option value="retired"${record?.status === 'retired' ? ' selected' : ''}>退役</option></select></div>
      <div class="field"><label for="recordPropellant">推进剂</label><input class="input" id="recordPropellant" value="${escapeHtml(record?.propellant || '')}" maxlength="80" placeholder="液氧 / 甲烷"></div>
      <div class="field"><label for="recordThrust">推力</label><input class="input" id="recordThrust" value="${escapeHtml(record?.thrust || '')}" maxlength="40" placeholder="2.4 MN"></div>
      <div class="field"><label for="recordIsp">比冲</label><input class="input" id="recordIsp" value="${escapeHtml(record?.isp || '')}" maxlength="40" placeholder="348 s"></div>
      <div class="field field--wide"><label for="recordNote">备注</label><textarea class="textarea" id="recordNote" maxlength="600" style="min-height:86px" placeholder="型号特点、试车结果…">${escapeHtml(record?.note || '')}</textarea></div>`;
  }
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => ($('#recordCode') || $('#recordName'))?.focus({ preventScroll: true }), 80);
}

async function submitRecordForm(event) {
  event.preventDefault();
  const form = $('#recordForm');
  const message = $('#recordMessage');
  const submit = $('#recordSubmit');
  if (!form?.checkValidity()) { form?.reportValidity(); return; }
  if (!submit || submit.disabled) return;
  submit.disabled = true;
  const original = submit.textContent;
  submit.textContent = '正在保存…';
  message.className = 'form-message';
  message.textContent = '';
  const isLaunch = state.recordType === 'launch';
  const payload = isLaunch ? {
    name: $('#recordName').value.trim(),
    vehicle: $('#recordVehicle').value.trim(),
    date: $('#recordDate').value ? new Date($('#recordDate').value).toISOString() : null,
    status: $('#recordStatus').value,
    payload: $('#recordPayload').value.trim(),
    note: $('#recordNote').value.trim(),
  } : {
    code: $('#recordCode').value.trim(),
    name: $('#recordName').value.trim(),
    status: $('#recordStatus').value,
    propellant: $('#recordPropellant').value.trim(),
    thrust: $('#recordThrust').value.trim(),
    isp: $('#recordIsp').value.trim(),
    note: $('#recordNote').value.trim(),
  };
  const base = isLaunch ? 'launches' : 'engines';
  try {
    if (state.recordId) await api(`/admin/${base}/${state.recordId}`, { method: 'PUT', body: payload });
    else await api(`/admin/${base}`, { method: 'POST', body: payload });
    $('#recordDialog')?.close();
    toast(isLaunch ? '测试记录已保存。' : '发动机档案已保存。');
    if (state.view === 'projects') await renderProjectsView();
    loadOverviewSummary();
  } catch (error) {
    message.className = 'form-message is-error';
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = original;
  }
}

/* ═══════════════ Mission requests ═══════════════ */

const MISSION_TYPE_LABELS = { comm: '通信', remote: '遥感', nav: '导航', science: '科学实验', tech: '技术验证' };

async function renderMissionsView() {
  setLoading(3);
  try {
    const data = await api('/admin/missions');
    state.missions = data.missions;
    adminView.innerHTML = `
      <div class="admin-toolbar glass">
        <span class="editor-count">${state.missions.length} 条申请 · ${state.missions.filter((item) => item.status === 'new').length} 条待评估</span>
      </div>
      <div class="mod-list" id="missionRows">
        ${state.missions.length ? state.missions.map((mission) => `
          <article class="mod-item mission-admin-item">
            <span class="mod-avatar">${escapeHtml(mission.reference.slice(-2))}</span>
            <div class="mod-body">
              <div class="mod-head">
                <b class="subscriber-mail">${escapeHtml(mission.reference)}</b>
                <span class="status-pill" data-status="${mission.status}">${missionStatusLabel(mission.status)}</span>
                <span class="subscriber-meta">${escapeHtml(MISSION_TYPE_LABELS[mission.type] || mission.type)}</span>
                <time datetime="${escapeHtml(mission.createdAt)}">${timeAgo(mission.createdAt)}</time>
              </div>
              <div class="mission-admin-specs">
                <span><small>批次</small><b>${escapeHtml(mission.batch || '—')}</b></span>
                <span><small>质量</small><b>${mission.mass} kg</b></span>
                <span><small>高度</small><b>${mission.altitude} km</b></span>
                <span><small>滞空</small><b>${mission.lifetime} 年</b></span>
              </div>
            </div>
            <div class="mod-actions">
              ${mission.status === 'new' ? `
                <button class="icon-button" type="button" data-mission-act="reviewed" data-id="${mission.id}" aria-label="标记已评估">
                  <svg viewBox="0 0 16 16"><path d="m2.5 8.5 3.5 3.5 7.5-8"/></svg>
                </button>` : ''}
              ${mission.status !== 'closed' ? `
                <button class="icon-button" type="button" data-mission-act="closed" data-id="${mission.id}" aria-label="关闭申请">
                  <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.8"/><path d="m4.5 11.5 7-7"/></svg>
                </button>` : ''}
              <button class="icon-button is-danger" type="button" data-mission-act="delete" data-id="${mission.id}" aria-label="删除申请">
                <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>
              </button>
            </div>
          </article>`).join('') : '<div class="panel glass empty-state"><span>No payloads</span><h3>还没有卫星参数申请</h3><p>读者通过首页「预定发射」提交后，会出现在这里。</p></div>'}
      </div>`;

    $('#missionRows')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-mission-act]');
      if (!button) return;
      const id = Number(button.dataset.id);
      const action = button.dataset.missionAct;
      try {
        if (action === 'delete') {
          const confirmed = await confirmAction('这条卫星参数申请将被永久删除。', '删除任务申请？');
          if (!confirmed) return;
          await api(`/admin/missions/${id}`, { method: 'DELETE' });
          toast('任务申请已删除。');
        } else {
          await api(`/admin/missions/${id}`, { method: 'PATCH', body: { status: action } });
          toast(action === 'reviewed' ? '已标记为已评估。' : '申请已关闭。');
        }
        renderMissionsView();
        loadOverviewSummary();
      } catch (error) { handleError(error); }
    });
  } catch (error) { handleError(error); }
}

/* ═══════════════ Editor ═══════════════ */

async function renderEditor(id) {
  state.editorId = id;
  setTopbar('editor');
  setActiveNav('posts');
  adminTitle.textContent = id ? '编辑手记' : '新建手记';
  document.title = `${id ? '编辑' : '新建'}手记 · 工作台`;
  setLoading(4);

  let post = {
    title: '', slug: '', excerpt: '', content: '', category: '设计', tags: [],
    cover: 'glass', status: 'draft', featured: false, publishedAt: null,
  };
  if (id) {
    try {
      const data = await api(`/admin/posts/${id}`);
      post = data.post;
    } catch (error) {
      handleError(error);
      navigate('posts');
      return;
    }
  }

  const tagString = (post.tags || []).join(', ');
  const dateValue = post.publishedAt ? toLocalInput(post.publishedAt) : '';

  adminView.innerHTML = `
    <form class="editor" id="editorForm" novalidate>
      <div class="editor-main glass">
        <input class="editor-title-field" id="editorTitle" name="title" maxlength="140" placeholder="给这篇手记一个标题…" value="${escapeHtml(post.title)}" aria-label="手记标题" required>
        <div class="editor-subfields">
          <div class="field">
            <label for="editorSlug">链接别名</label>
            <input class="input" id="editorSlug" name="slug" maxlength="84" placeholder="留空自动生成" value="${escapeHtml(post.slug)}">
          </div>
          <div class="field">
            <label for="editorCategory">分类</label>
            <input class="input" id="editorCategory" name="category" list="categoryList" maxlength="24" placeholder="设计 / 测试 / 飞行…" value="${escapeHtml(post.category)}">
            <datalist id="categoryList"><option value="设计"><option value="测试"><option value="飞行"><option value="工具"><option value="随笔"></datalist>
          </div>
        </div>
        <div class="field" style="margin-top:13px">
          <label for="editorExcerpt">摘要 <span style="opacity:.45">(留空自动截取正文)</span></label>
          <textarea class="textarea" id="editorExcerpt" name="excerpt" maxlength="300" style="min-height:76px" placeholder="用一两句话说明这篇手记在解决什么问题…">${escapeHtml(post.excerpt)}</textarea>
        </div>

        <div class="editor-toolbar">
          <div class="editor-tabs" role="tablist" aria-label="编辑模式">
            <button type="button" class="is-active" data-editor-tab="write" role="tab" aria-selected="true">Markdown</button>
            <button type="button" data-editor-tab="preview" role="tab" aria-selected="false">预览</button>
          </div>
          <span class="editor-count" id="editorCount">${post.content.length} 字符 · 约 ${Math.max(2, Math.round(post.content.length / 420))} min</span>
        </div>

        <div class="editor-area">
          <textarea class="editor-textarea" id="editorContent" name="content" placeholder="用 Markdown 写下你的判断。支持标题、列表、引用、代码块、链接与图片。">${escapeHtml(post.content)}</textarea>
          <div class="editor-preview article-body" id="editorPreview" hidden></div>
        </div>
        <p class="editor-note">支持 ## 标题、**粗体**、- 列表、&gt; 引用、\`\`\` 代码块。预览由服务端渲染，发布前请检查排版。</p>

        <div class="editor-actions">
          ${id ? '<span class="editor-delete"><button class="btn btn--sm btn--ghost" type="button" id="deletePostBtn">删除手记</button></span>' : ''}
          <button class="btn btn--sm" type="button" id="cancelEdit">取消</button>
          <button class="btn btn--sm btn--primary" type="submit" id="savePostBtn">${post.status === 'published' ? '更新并发布' : '保存手记'}</button>
        </div>
      </div>

      <aside class="editor-side">
        <section class="panel glass">
          <div class="panel__head"><div><h2>发布</h2><p>状态与时间窗口。</p></div></div>
          <div class="editor-publish">
            <div class="field">
              <label for="editorStatus">状态</label>
              <select class="select" id="editorStatus" name="status">
                <option value="draft"${post.status === 'draft' ? ' selected' : ''}>草稿</option>
                <option value="published"${post.status === 'published' ? ' selected' : ''}>已发布</option>
              </select>
            </div>
            <div class="field">
              <label for="editorDate">发布时间 <span style="opacity:.45">(可留空)</span></label>
              <input class="input" id="editorDate" name="publishedAt" type="datetime-local" value="${dateValue}">
            </div>
            <label class="checkbox"><input type="checkbox" id="editorFeatured" ${post.featured ? 'checked' : ''}> 设为编辑精选</label>
          </div>
        </section>

        <section class="panel glass">
          <div class="panel__head"><div><h2>封面</h2><p>程序化生成的视觉档案。</p></div></div>
          <div class="cover-options" role="radiogroup" aria-label="封面样式">
            ${COVERS.map(([key, label]) => `<button type="button" class="cover-option${post.cover === key ? ' is-active' : ''}" data-cover="${key}" role="radio" aria-checked="${post.cover === key}" aria-label="${label}"></button>`).join('')}
          </div>
          <div class="cover-legend">${COVERS.map(([key, label]) => `<span>${label}</span>`).join('')}</div>
          <input type="hidden" id="editorCover" value="${escapeHtml(post.cover)}">
        </section>

        <section class="panel glass">
          <div class="panel__head"><div><h2>标签</h2><p>逗号分隔，最多 8 个。</p></div></div>
          <input class="input" id="editorTags" maxlength="160" placeholder="热分离, 时序, 气动" value="${escapeHtml(tagString)}">
          <p class="editor-note">标签会出现在卡片、文章页与搜索里。</p>
        </section>
      </aside>
    </form>`;

  bindEditor(post);
  if (post.status === 'published') $('#savePostBtn').textContent = '更新并发布';
}

function bindEditor(post) {
  const form = $('#editorForm');
  const title = $('#editorTitle');
  const content = $('#editorContent');
  const preview = $('#editorPreview');
  const count = $('#editorCount');
  const coverInput = $('#editorCover');
  let activeTab = 'write';
  let previewSeq = 0;

  const markDirty = () => { state.editorDirty = true; };
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);

  title?.addEventListener('input', () => {
    const slug = $('#editorSlug');
    if (post.id || (slug && slug.value.trim())) return;
    // Leave blank so the server can generate a stable slug.
  });

  content?.addEventListener('input', () => {
    const value = content.value;
    count.textContent = `${value.length} 字符 · 约 ${Math.max(2, Math.round(value.length / 420))} min`;
    if (activeTab === 'preview') schedulePreview();
  });

  $$('[data-editor-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.editorTab;
      $$('[data-editor-tab]').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-selected', String(selected));
      });
      const writing = activeTab === 'write';
      content.hidden = !writing;
      preview.hidden = writing;
      if (!writing) refreshPreview();
    });
  });

  $$('.cover-option').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.cover-option').forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-checked', String(active));
      });
      coverInput.value = button.dataset.cover;
      state.editorDirty = true;
    });
  });

  const schedulePreview = debounce(refreshPreview, 280);

  async function refreshPreview() {
    if (!preview) return;
    const value = content.value;
    if (!value.trim()) {
      preview.innerHTML = '<p class="preview-empty">开始写作后，这里会出现排版预览。</p>';
      return;
    }
    const seq = ++previewSeq;
    try {
      const data = await api('/admin/preview', { method: 'POST', body: { content: value } });
      if (seq !== previewSeq) return;
      preview.innerHTML = data.html || '<p class="preview-empty">没有可预览的内容。</p>';
    } catch (error) {
      if (seq !== previewSeq) return;
      preview.innerHTML = `<p class="preview-empty">${escapeHtml(error.message || '预览失败。')}</p>`;
    }
  }

  $('#cancelEdit')?.addEventListener('click', async () => {
    if (state.editorDirty) {
      const confirmed = await confirmAction('尚未保存的修改会丢失。', '放弃这次编辑？');
      if (!confirmed) return;
    }
    state.editorDirty = false;
    navigate('posts');
  });

  $('#deletePostBtn')?.addEventListener('click', async () => {
    const confirmed = await confirmAction(`「${title.value || post.title}」将被永久删除。`, '删除这篇手记？');
    if (!confirmed) return;
    try {
      await api(`/admin/posts/${post.id}`, { method: 'DELETE' });
      state.editorDirty = false;
      toast('手记已删除。');
      navigate('posts');
    } catch (error) { handleError(error); }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!title.value.trim()) {
      toast('标题不能为空。', { type: 'error' });
      title.focus();
      return;
    }
    const button = $('#savePostBtn');
    if (button.disabled) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = '正在入库…';

    const dateInput = $('#editorDate').value;
    const payload = {
      title: title.value.trim(),
      slug: $('#editorSlug').value.trim(),
      excerpt: $('#editorExcerpt').value.trim(),
      content: content.value,
      category: $('#editorCategory').value.trim() || '随笔',
      tags: $('#editorTags').value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      cover: coverInput.value,
      status: $('#editorStatus').value,
      featured: $('#editorFeatured').checked,
      publishedAt: dateInput ? new Date(dateInput).toISOString() : null,
    };

    try {
      const data = post.id
        ? await api(`/admin/posts/${post.id}`, { method: 'PUT', body: payload })
        : await api('/admin/posts', { method: 'POST', body: payload });
      state.editorDirty = false;
      toast(post.id ? '手记已更新。' : '手记已创建。');
      state.posts = [];
      navigate('posts');
      loadOverviewSummary();
      if (!post.id && data?.post) {
        // Keep the new id available to the next render, but prefer the list view.
        state.lastCreatedId = data.post.id;
      }
    } catch (error) {
      handleError(error);
      button.disabled = false;
      button.textContent = original;
    }
  });

  form.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      form.requestSubmit();
    }
  });
}

function toLocalInput(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/* ═══════════════ Comments ═══════════════ */

async function renderCommentsView() {
  setLoading(3);
  try {
    const query = state.commentFilter ? `?status=${encodeURIComponent(state.commentFilter)}` : '';
    const data = await api(`/admin/comments${query}`);
    const items = data.comments;
    adminView.innerHTML = `
      <div class="admin-toolbar glass">
        <select class="select" id="commentFilter" aria-label="筛选评论状态">
          <option value=""${state.commentFilter === '' ? ' selected' : ''}>全部评论</option>
          <option value="approved"${state.commentFilter === 'approved' ? ' selected' : ''}>已显示</option>
          <option value="hidden"${state.commentFilter === 'hidden' ? ' selected' : ''}>已隐藏</option>
          <option value="pending"${state.commentFilter === 'pending' ? ' selected' : ''}>待审核</option>
        </select>
        <span class="admin-toolbar__spacer"></span>
        <span class="editor-count">${items.length} 条记录</span>
      </div>
      <div class="mod-list" id="commentRows">
        ${items.length ? items.map(commentRow).join('') : '<div class="panel glass empty-state"><span>No signals</span><h3>还没有评论</h3><p>读者在文章下方留言后，会出现在这里。</p></div>'}
      </div>`;

    $('#commentFilter')?.addEventListener('change', (event) => {
      state.commentFilter = event.target.value;
      renderCommentsView();
    });
    $('#commentRows')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-comment-act]');
      if (!button) return;
      const id = Number(button.dataset.id);
      const action = button.dataset.commentAct;
      try {
        if (action === 'delete') {
          const confirmed = await confirmAction('这条评论将被永久删除。', '删除评论？');
          if (!confirmed) return;
          await api(`/admin/comments/${id}`, { method: 'DELETE' });
          toast('评论已删除。');
        } else {
          const status = action === 'approve' ? 'approved' : 'hidden';
          await api(`/admin/comments/${id}`, { method: 'PATCH', body: { status } });
          toast(status === 'approved' ? '评论已显示。' : '评论已隐藏。');
        }
        renderCommentsView();
        loadOverviewSummary();
      } catch (error) { handleError(error); }
    });
  } catch (error) { handleError(error); }
}

function commentRow(comment) {
  return `<article class="mod-item">
    <span class="mod-avatar">${escapeHtml((comment.author || '?').slice(0, 1))}</span>
    <div class="mod-body">
      <div class="mod-head">
        <b>${escapeHtml(comment.author)}</b>
        <span class="status-pill" data-status="${comment.status}">${statusLabel(comment.status)}</span>
        <a href="/post/${encodeURIComponent(comment.postSlug)}#comments" target="_blank" rel="noopener">${escapeHtml(comment.postTitle)}</a>
        <time datetime="${escapeHtml(comment.createdAt)}">${timeAgo(comment.createdAt)}</time>
      </div>
      <p>${escapeHtml(comment.body)}</p>
    </div>
    <div class="mod-actions">
      ${comment.status !== 'approved' ? `
        <button class="icon-button" type="button" data-comment-act="approve" data-id="${comment.id}" aria-label="显示评论">
          <svg viewBox="0 0 16 16"><path d="m2.5 8.5 3.5 3.5 7.5-8"/></svg>
        </button>` : ''}
      ${comment.status !== 'hidden' ? `
        <button class="icon-button" type="button" data-comment-act="hide" data-id="${comment.id}" aria-label="隐藏评论">
          <svg viewBox="0 0 16 16"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z"/><path d="m3 3 10 10"/></svg>
        </button>` : ''}
      <button class="icon-button is-danger" type="button" data-comment-act="delete" data-id="${comment.id}" aria-label="删除评论">
        <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>
      </button>
    </div>
  </article>`;
}

/* ═══════════════ Subscribers ═══════════════ */

async function renderSubscribersView() {
  setLoading(3);
  try {
    const data = await api('/admin/subscribers');
    state.subscribers = data.subscribers;
    adminView.innerHTML = `
      <div class="admin-toolbar glass">
        <span class="editor-count">${state.subscribers.length} 个有效邮箱</span>
        <span class="admin-toolbar__spacer"></span>
        <button class="btn btn--sm" type="button" id="copySubscribers">复制全部邮箱</button>
        <button class="btn btn--sm btn--primary" type="button" id="exportSubscribers">导出 CSV</button>
      </div>
      <div class="mod-list" id="subscriberRows">
        ${state.subscribers.length ? state.subscribers.map((subscriber) => `
          <article class="mod-item">
            <span class="mod-avatar">${escapeHtml(subscriber.email.slice(0, 1).toUpperCase())}</span>
            <div class="mod-body">
              <div class="mod-head"><b class="subscriber-mail">${escapeHtml(subscriber.email)}</b><span class="subscriber-meta">${escapeHtml(subscriber.source)} · ${formatDate(subscriber.createdAt, 'long')}</span></div>
              <p class="subscriber-meta">订阅于 ${formatDateTime(subscriber.createdAt)}</p>
            </div>
            <div class="mod-actions">
              <a class="icon-button" href="mailto:${encodeURIComponent(subscriber.email)}" aria-label="发送邮件">
                <svg viewBox="0 0 16 16"><path d="M2 4h12v8H2z"/><path d="m2.5 5 5.5 4 5.5-4"/></svg>
              </a>
              <button class="icon-button is-danger" type="button" data-subscriber-act="delete" data-id="${subscriber.id}" aria-label="移除订阅">
                <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>
              </button>
            </div>
          </article>`).join('') : '<div class="panel glass empty-state"><span>No subscribers</span><h3>订阅名单为空</h3><p>当读者在首页订阅任务简报后，会出现在这里。</p></div>'}
      </div>`;

    $('#copySubscribers')?.addEventListener('click', async () => {
      const emails = state.subscribers.map((item) => item.email).join(', ');
      try {
        await navigator.clipboard.writeText(emails);
        toast('邮箱列表已复制。');
      } catch {
        toast('复制失败，请使用 CSV 导出。', { type: 'error' });
      }
    });
    $('#exportSubscribers')?.addEventListener('click', () => {
      const header = 'email,source,created_at\n';
      const body = state.subscribers.map((item) => [item.email, item.source, item.createdAt].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([`\ufeff${header}${body}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `oceans-muse-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast('CSV 已导出。');
    });
    $('#subscriberRows')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-subscriber-act="delete"]');
      if (!button) return;
      const confirmed = await confirmAction('该邮箱将从任务简报名单中移除。', '移除订阅者？');
      if (!confirmed) return;
      try {
        await api(`/admin/subscribers/${button.dataset.id}`, { method: 'DELETE' });
        toast('订阅者已移除。');
        renderSubscribersView();
        loadOverviewSummary();
      } catch (error) { handleError(error); }
    });
  } catch (error) { handleError(error); }
}

/* ═══════════════ Messages ═══════════════ */

async function renderMessagesView() {
  setLoading(3);
  try {
    const data = await api('/admin/messages');
    state.messages = data.messages;
    adminView.innerHTML = `
      <div class="admin-toolbar glass">
        <span class="editor-count">${state.messages.length} 条消息 · ${state.messages.filter((item) => item.status === 'new').length} 条未读</span>
      </div>
      <div class="mod-list" id="messageRows">
        ${state.messages.length ? state.messages.map((message) => `
          <article class="mod-item">
            <span class="mod-avatar">${escapeHtml((message.name || '?').slice(0, 1))}</span>
            <div class="mod-body">
              <div class="mod-head">
                <b>${escapeHtml(message.name)}</b>
                <span class="status-pill" data-status="${message.status}">${statusLabel(message.status)}</span>
                <a href="mailto:${encodeURIComponent(message.email)}">${escapeHtml(message.email)}</a>
                <time datetime="${escapeHtml(message.createdAt)}">${timeAgo(message.createdAt)}</time>
              </div>
              ${message.subject ? `<span class="message-subject">主题：${escapeHtml(message.subject)}</span>` : ''}
              <p class="message-text">${escapeHtml(message.body)}</p>
            </div>
            <div class="mod-actions">
              ${message.status === 'new' ? `
                <button class="icon-button" type="button" data-message-act="read" data-id="${message.id}" aria-label="标记已读">
                  <svg viewBox="0 0 16 16"><path d="m2.5 8.5 3.5 3.5 7.5-8"/></svg>
                </button>` : ''}
              ${message.status !== 'archived' ? `
                <button class="icon-button" type="button" data-message-act="archive" data-id="${message.id}" aria-label="归档">
                  <svg viewBox="0 0 16 16"><path d="M2.5 5h11v8h-11zM2 2.5h12V5H2zM6 8h4"/></svg>
                </button>` : ''}
              <button class="icon-button is-danger" type="button" data-message-act="delete" data-id="${message.id}" aria-label="删除消息">
                <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>
              </button>
            </div>
          </article>`).join('') : '<div class="panel glass empty-state"><span>Inbox clear</span><h3>收件箱为空</h3><p>通过首页「发送信号」提交的消息会出现在这里。</p></div>'}
      </div>`;

    $('#messageRows')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-message-act]');
      if (!button) return;
      const id = Number(button.dataset.id);
      const action = button.dataset.messageAct;
      try {
        if (action === 'delete') {
          const confirmed = await confirmAction('这条联系消息将被永久删除。', '删除消息？');
          if (!confirmed) return;
          await api(`/admin/messages/${id}`, { method: 'DELETE' });
          toast('消息已删除。');
        } else {
          await api(`/admin/messages/${id}`, { method: 'PATCH', body: { status: action === 'read' ? 'read' : 'archived' } });
          toast(action === 'read' ? '已标记为已读。' : '消息已归档。');
        }
        renderMessagesView();
        loadOverviewSummary();
      } catch (error) { handleError(error); }
    });
  } catch (error) { handleError(error); }
}

/* ═══════════════ Settings ═══════════════ */

async function renderSettingsView() {
  setLoading(3);
  try {
    const data = await api('/admin/settings');
    const settings = data.settings || {};
    state.settings = settings;
    const value = (key, fallback = '') => escapeHtml(settings[key] ?? fallback);
    adminView.innerHTML = `
      <div class="settings-grid">
        <div class="settings-stack">
          <form class="settings-section glass" id="siteSettings" novalidate>
            <div class="settings-section__head"><h2>站点信息</h2><p>标题、描述与个人信息会同步到首页。</p></div>
            <div class="settings-fields">
              <div class="field"><label for="setSiteTitle">站点标题</label><input class="input" id="setSiteTitle" value="${value('site.title')}" maxlength="80"></div>
              <div class="field"><label for="setLocation">坐标</label><input class="input" id="setLocation" value="${value('site.location')}" maxlength="80"></div>
              <div class="field field--wide"><label for="setTagline">一句话定位</label><input class="input" id="setTagline" value="${value('site.tagline')}" maxlength="160"></div>
              <div class="field field--wide"><label for="setDescription">站点描述</label><textarea class="textarea" id="setDescription" maxlength="400" style="min-height:86px">${value('site.description')}</textarea></div>
              <div class="field"><label for="setNow">现在在做</label><input class="input" id="setNow" value="${value('site.now')}" maxlength="120"></div>
              <div class="field"><label for="setTools">常用工具</label><input class="input" id="setTools" value="${value('site.tools')}" maxlength="120"></div>
            </div>
            <div class="settings-actions"><button class="btn btn--sm btn--primary" type="submit">保存站点信息</button></div>
          </form>

          <form class="settings-section glass" id="missionSettings" novalidate>
            <div class="settings-section__head"><h2>任务倒计时</h2><p>控制首页「预定发射」卡片的目标与元信息。</p></div>
            <div class="settings-fields">
              <div class="field field--wide"><label for="setMissionTitle">任务名称</label><input class="input" id="setMissionTitle" value="${value('mission.title')}" maxlength="120"></div>
              <div class="field"><label for="setMissionTarget">发射窗口</label><input class="input" id="setMissionTarget" type="datetime-local" value="${toLocalInput(settings['mission.target'] || '')}"></div>
              <div class="field"><label for="setMissionSite">发射场</label><input class="input" id="setMissionSite" value="${value('mission.site')}" maxlength="80"></div>
              <div class="field"><label for="setMissionType">任务类型</label><input class="input" id="setMissionType" value="${value('mission.type')}" maxlength="80"></div>
              <div class="field"><label for="setMissionPayload">载荷</label><input class="input" id="setMissionPayload" value="${value('mission.payload')}" maxlength="80"></div>
              <div class="field field--wide"><label for="setMissionNote">任务备注</label><input class="input" id="setMissionNote" value="${value('mission.note')}" maxlength="160"></div>
            </div>
            <div class="settings-actions"><button class="btn btn--sm btn--primary" type="submit">保存任务参数</button></div>
          </form>

          <form class="settings-section glass" id="newsletterSettings" novalidate>
            <div class="settings-section__head"><h2>任务简报</h2><p>首页订阅模块的文案。</p></div>
            <div class="settings-fields">
              <div class="field field--wide"><label for="setNewsletterTitle">简报标题</label><input class="input" id="setNewsletterTitle" value="${value('newsletter.title')}" maxlength="120"></div>
              <div class="field field--wide"><label for="setNewsletterNote">简报说明</label><textarea class="textarea" id="setNewsletterNote" maxlength="300" style="min-height:78px">${value('newsletter.note')}</textarea></div>
              <div class="field field--wide"><label for="setGithub">GitHub 链接</label><input class="input" id="setGithub" value="${value('social.github')}" maxlength="300"></div>
            </div>
            <div class="settings-actions"><button class="btn btn--sm btn--primary" type="submit">保存简报文案</button></div>
          </form>
        </div>

        <div class="settings-stack">
          <form class="settings-section glass" id="passwordSettings" novalidate>
            <div class="settings-section__head"><h2>账户安全</h2><p>修改后所有会话将失效，需要重新登录。</p></div>
            <div class="settings-fields" style="grid-template-columns:1fr">
              <div class="field"><label for="currentPassword">当前密码</label><input class="input" id="currentPassword" type="password" autocomplete="current-password"></div>
              <div class="field"><label for="newPassword">新密码</label><input class="input" id="newPassword" type="password" autocomplete="new-password" placeholder="至少 8 个字符"></div>
              <div class="field"><label for="confirmPassword">确认新密码</label><input class="input" id="confirmPassword" type="password" autocomplete="new-password"></div>
            </div>
            <p class="form-message" id="passwordMessage" role="status"></p>
            <div class="settings-actions"><button class="btn btn--sm btn--primary" type="submit">更新密码</button></div>
          </form>

          <section class="settings-section glass danger-zone">
            <div class="settings-section__head"><h2>内容健康</h2><p>快速检查公开站点的关键输出。</p></div>
            <div class="mission-snapshot">
              <div class="mission-snapshot__row"><span>RSS</span><a class="panel__link" href="/feed.xml" target="_blank" rel="noopener">打开 /feed.xml ↗</a></div>
              <div class="mission-snapshot__row"><span>Sitemap</span><a class="panel__link" href="/sitemap.xml" target="_blank" rel="noopener">打开 /sitemap.xml ↗</a></div>
              <div class="mission-snapshot__row"><span>本站</span><a class="panel__link" href="/" target="_blank" rel="noopener">打开首页 ↗</a></div>
            </div>
          </section>
        </div>
      </div>`;

    bindSettingsForms();
  } catch (error) { handleError(error); }
}

function bindSettingsForms() {
  $('#siteSettings')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveSettings({
      'site.title': $('#setSiteTitle').value,
      'site.location': $('#setLocation').value,
      'site.tagline': $('#setTagline').value,
      'site.description': $('#setDescription').value,
      'site.now': $('#setNow').value,
      'site.tools': $('#setTools').value,
    });
  });
  $('#missionSettings')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const target = $('#setMissionTarget').value;
    await saveSettings({
      'mission.title': $('#setMissionTitle').value,
      'mission.target': target ? new Date(target).toISOString() : state.settings['mission.target'],
      'mission.site': $('#setMissionSite').value,
      'mission.type': $('#setMissionType').value,
      'mission.payload': $('#setMissionPayload').value,
      'mission.note': $('#setMissionNote').value,
    });
  });
  $('#newsletterSettings')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveSettings({
      'newsletter.title': $('#setNewsletterTitle').value,
      'newsletter.note': $('#setNewsletterNote').value,
      'social.github': $('#setGithub').value,
    });
  });
  $('#passwordSettings')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#passwordMessage');
    const current = $('#currentPassword').value;
    const next = $('#newPassword').value;
    const confirm = $('#confirmPassword').value;
    if (next.length < 8) {
      message.className = 'form-message is-error';
      message.textContent = '新密码至少需要 8 个字符。';
      return;
    }
    if (next !== confirm) {
      message.className = 'form-message is-error';
      message.textContent = '两次输入的新密码不一致。';
      return;
    }
    const button = event.target.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api('/admin/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      message.className = 'form-message is-success';
      message.textContent = '密码已更新，正在返回登录页…';
      toast('密码已更新，请重新登录。');
      state.user = null;
      window.setTimeout(() => showLogin('密码已更新，请使用新密码登录。'), 900);
    } catch (error) {
      message.className = 'form-message is-error';
      message.textContent = error.message;
      button.disabled = false;
    }
  });
}

async function saveSettings(values) {
  try {
    const data = await api('/admin/settings', { method: 'PUT', body: { settings: values } });
    state.settings = data.settings;
    toast('设置已保存。');
    loadOverviewSummary();
  } catch (error) { handleError(error); }
}

/* ═══════════════ Confirm ═══════════════ */

function confirmAction(message, title = '确认操作') {
  return new Promise((resolve) => {
    if (!confirmDialog) { resolve(window.confirm(message)); return; }
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = message;
    confirmDialog.returnValue = '';
    const onClose = () => {
      cleanup();
      resolve(confirmDialog.returnValue === 'ok');
    };
    const ok = () => { confirmDialog.returnValue = 'ok'; confirmDialog.close(); };
    const cancel = () => { confirmDialog.returnValue = ''; confirmDialog.close(); };
    const cleanup = () => {
      confirmDialog.removeEventListener('close', onClose);
      confirmDialog.querySelector('#confirmOk')?.removeEventListener('click', ok);
      confirmDialog.querySelector('[data-confirm-cancel]')?.removeEventListener('click', cancel);
    };
    confirmDialog.addEventListener('close', onClose);
    confirmDialog.querySelector('#confirmOk')?.addEventListener('click', ok);
    confirmDialog.querySelector('[data-confirm-cancel]')?.addEventListener('click', cancel);
    confirmDialog.showModal();
    confirmDialog.querySelector('[data-confirm-cancel]')?.focus();
  });
}

/* ═══════════════ Small helpers ═══════════════ */

function statusLabel(status) {
  return ({
    published: '已发布', draft: '草稿', approved: '已显示', hidden: '已隐藏', pending: '待审核',
    new: '未读', read: '已读', archived: '已归档', reviewed: '已评估', closed: '已关闭',
  })[status] || status;
}

function missionStatusLabel(status) {
  return ({ new: '待评估', reviewed: '已评估', closed: '已关闭' })[status] || status;
}

function iconDoc() {
  return '<svg viewBox="0 0 16 16"><path d="M3 1.5h6l4 4v9H3z"/><path d="M9 1.5v4h4"/></svg>';
}
function iconEye() {
  return '<svg viewBox="0 0 16 16"><path d="M1.5 8S3.8 4 8 4s6.5 4 6.5 4S12.2 12 8 12 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.7"/></svg>';
}
function iconHeart() {
  return '<svg viewBox="0 0 16 16"><path d="M8 13.5S2.8 10.3 2.8 6.8A2.9 2.9 0 0 1 8 4.9a2.9 2.9 0 0 1 5.2 1.9c0 3.5-5.2 6.7-5.2 6.7Z"/></svg>';
}
function iconMail() {
  return '<svg viewBox="0 0 16 16"><path d="M2 4h12v8H2z"/><path d="m2.5 5 5.5 4 5.5-4"/></svg>';
}
function iconChat() {
  return '<svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v8h-6l-3 2.3v-2.3h-2z"/></svg>';
}
function iconInbox() {
  return '<svg viewBox="0 0 16 16"><path d="M2 3.5h12v9H2z"/><path d="M2 10h3.2l1 1.5h3.6l1-1.5H14"/></svg>';
}
function iconPlus() {
  return '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>';
}
function iconGlobe() {
  return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2a10 10 0 0 1 0 12A10 10 0 0 1 8 2Z"/></svg>';
}
function iconRocket() {
  return '<svg viewBox="0 0 16 16"><path d="M8 1.5c2 1.6 3.1 3.8 3.1 6.3 0 1.3-.4 2.5-1.1 3.5H6a5.8 5.8 0 0 1-1.1-3.5c0-2.5 1.1-4.7 3.1-6.3Z"/><path d="M6.2 12 5.4 15M9.8 12l.8 3M8 4.4v2"/></svg>';
}
function iconTarget() {
  return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.4"/><path d="M8 1.8v2.2M8 12v2.2M1.8 8h2.2M12 8h2.2M3.6 3.6l1.6 1.6M10.8 10.8l1.6 1.6M12.4 3.6l-1.6 1.6M5.2 10.8l-1.6 1.6"/></svg>';
}
