import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'liquid-glass-2026';
process.env.IP_SALT = 'test-salt';
process.env.SITE_ORIGIN = '';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oceans-muse-test-'));
const dbPath = path.join(tmpDir, 'blog.db');

const { createBlogServer } = await import('../server.js');
const app = await createBlogServer({ dbPath });
const server = app.server;

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const jar = new Map();

function rememberCookies(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const cookie of cookies) {
    const pair = cookie.split(';')[0];
    const index = pair.indexOf('=');
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

async function request(pathname, options = {}) {
  const { method = 'GET', body, auth = true, origin = true } = options;
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (origin && method !== 'GET' && method !== 'HEAD') headers.origin = base;
  if (auth && jar.get('om_session')) headers.cookie = `om_session=${jar.get('om_session')}`;
  if (options.visitor && jar.get('om_visitor')) headers.cookie = `om_visitor=${jar.get('om_visitor')}`;
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  rememberCookies(response);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML or XML */ }
  return { response, status: response.status, text, json };
}

test('oceans-muse full-stack API', async (t) => {
  t.after(async () => {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  await t.test('health, metadata and public post listing', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.data.status, 'ok');

    const meta = await request('/api/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.json.data.settings['site.title'], 'oceans-muse');
    assert.ok(meta.json.data.categories.length >= 4);

    const list = await request('/api/posts?limit=6');
    assert.equal(list.status, 200);
    assert.equal(list.json.data.total, 8);
    assert.equal(list.json.data.items.length, 6);
    assert.ok(list.json.data.items[0].readingMinutes >= 2);

    const design = await request(`/api/posts?category=${encodeURIComponent('设计')}`);
    assert.equal(design.json.data.total, 3);

    const tagged = await request(`/api/posts?tag=${encodeURIComponent('时序')}`);
    assert.equal(tagged.json.data.total, 1);

    const searched = await request(`/api/posts?q=${encodeURIComponent('玻璃')}`);
    assert.equal(searched.json.data.total, 1);

    const popular = await request('/api/posts?sort=popular&limit=2');
    assert.equal(popular.json.data.items.length, 2);
  });

  await t.test('article detail, views, likes and comments', async () => {
    const detail = await request('/api/posts/liquid-glass-cockpit');
    assert.equal(detail.status, 200);
    assert.match(detail.json.data.post.html, /<h2 id=/);
    assert.ok(detail.json.data.post.toc.length >= 4);
    assert.ok(detail.json.data.post.views > 0);

    const like = await request('/api/posts/liquid-glass-cockpit/like', { method: 'POST' });
    assert.equal(like.status, 200);
    assert.equal(like.json.data.liked, true);
    const unlike = await request('/api/posts/liquid-glass-cockpit/like', {
      method: 'POST',
      visitor: true,
    });
    assert.equal(unlike.json.data.liked, false);

    const before = await request('/api/posts/liquid-glass-cockpit/comments');
    assert.equal(before.json.data.comments.length, 3);

    const comment = await request('/api/posts/liquid-glass-cockpit/comments', {
      method: 'POST',
      body: { author: '测试读者', body: '这是一条用于集成测试的评论。' },
    });
    assert.equal(comment.status, 201);

    const after = await request('/api/posts/liquid-glass-cockpit/comments');
    assert.equal(after.json.data.comments.length, 4);
    assert.equal(after.json.data.comments.at(-1).author, '测试读者');
  });

  await t.test('projects and mission request intake', async () => {
    const projects = await request('/api/projects');
    assert.equal(projects.status, 200);
    assert.equal(projects.json.data.launches.length, 5);
    assert.equal(projects.json.data.engines.length, 4);
    assert.equal(projects.json.data.launches[0].status, 'success');

    const mission = await request('/api/mission-requests', {
      method: 'POST',
      body: {
        batch: 'B-2026-09',
        type: 'remote',
        mass: 18.5,
        altitude: 550,
        lifetime: 5,
      },
    });
    assert.equal(mission.status, 201);
    assert.equal(mission.json.data.reference, 'MSN-0001');

    const invalid = await request('/api/mission-requests', {
      method: 'POST',
      body: { type: 'nonsense', mass: 0, altitude: 0, lifetime: 0 },
    });
    assert.equal(invalid.status, 400);
  });

  await t.test('newsletter and contact forms persist', async () => {
    const subscribe = await request('/api/subscribe', {
      method: 'POST',
      body: { email: 'reader@example.com' },
    });
    assert.equal(subscribe.status, 201);
    assert.equal(subscribe.json.data.created, true);

    const duplicate = await request('/api/subscribe', {
      method: 'POST',
      body: { email: 'READER@example.com' },
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.json.data.created, false);

    const contact = await request('/api/contact', {
      method: 'POST',
      body: {
        name: '测试联系',
        email: 'contact@example.com',
        subject: '接口测试',
        message: '这是一条足够长的集成测试联系消息。',
      },
    });
    assert.equal(contact.status, 201);
  });

  await t.test('admin endpoints require authentication', async () => {
    const unauthorized = await request('/api/admin/overview');
    assert.equal(unauthorized.status, 401);

    const wrong = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'wrong-password' },
    });
    assert.equal(wrong.status, 401);

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'liquid-glass-2026' },
    });
    assert.equal(login.status, 200);
    assert.ok(jar.get('om_session'));

    const me = await request('/api/auth/me');
    assert.equal(me.json.data.user.displayName, 'oceans-muse');
  });

  await t.test('admin overview and content management', async () => {
    const overview = await request('/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.json.data.stats.posts, 8);
    assert.equal(overview.json.data.stats.subscribers, 1);
    assert.equal(overview.json.data.stats.messages, 1);
    assert.equal(overview.json.data.stats.missionRequests, 1);
    assert.equal(overview.json.data.stats.projects, 9);

    const created = await request('/api/admin/posts', {
      method: 'POST',
      body: {
        title: '集成测试手记',
        slug: 'integration-note',
        excerpt: '用于验证完整内容流程。',
        content: '## 一节\n\n正文与 **强调**。',
        category: '工具',
        tags: ['测试', 'API'],
        cover: 'catia',
        status: 'draft',
      },
    });
    assert.equal(created.status, 201);
    const id = created.json.data.post.id;
    assert.equal(created.json.data.post.slug, 'integration-note');

    const publicDraft = await request('/api/posts/integration-note');
    assert.equal(publicDraft.status, 404);

    const updated = await request(`/api/admin/posts/${id}`, {
      method: 'PUT',
      body: {
        title: '集成测试手记（已发布）',
        slug: 'integration-note',
        excerpt: '用于验证完整内容流程。',
        content: '## 一节\n\n正文与 **强调**。',
        category: '工具',
        tags: ['测试', 'API'],
        cover: 'catia',
        status: 'published',
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.post.status, 'published');

    const publicPost = await request('/api/posts/integration-note');
    assert.equal(publicPost.status, 200);
    assert.match(publicPost.json.data.post.html, /<strong>强调<\/strong>/);

    const preview = await request('/api/admin/preview', {
      method: 'POST',
      body: { content: '## 预览\n\n<script>alert(1)</script>' },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.data.html.includes('<script>'), false);
    assert.match(preview.json.data.html, /&lt;script&gt;/);

    const deleted = await request(`/api/admin/posts/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    const gone = await request('/api/posts/integration-note');
    assert.equal(gone.status, 404);
  });

  await t.test('project archive management and mission requests', async () => {
    const launch = await request('/api/admin/launches', {
      method: 'POST',
      body: {
        name: 'T-08 · 集成测试',
        vehicle: 'S-08',
        date: '2026-10-01',
        status: 'success',
        payload: '测试舱',
        note: '自动化测试记录。',
      },
    });
    assert.equal(launch.status, 201);
    const launchId = launch.json.data.launch.id;

    const updateLaunch = await request(`/api/admin/launches/${launchId}`, {
      method: 'PUT',
      body: { ...launch.json.data.launch, name: 'T-08 · 集成测试（更新）', status: 'partial' },
    });
    assert.equal(updateLaunch.status, 200);
    assert.equal(updateLaunch.json.data.launch.status, 'partial');

    const engine = await request('/api/admin/engines', {
      method: 'POST',
      body: {
        code: 'R-09',
        name: '集成测试发动机',
        status: 'dev',
        propellant: '液氧 / 甲烷',
        thrust: '100 kN',
        isp: '340 s',
        note: '自动化测试。',
      },
    });
    assert.equal(engine.status, 201);
    const engineId = engine.json.data.engine.id;

    const duplicate = await request('/api/admin/engines', {
      method: 'POST',
      body: { code: 'R-09', name: '重复编号', status: 'dev' },
    });
    assert.equal(duplicate.status, 409);

    const missions = await request('/api/admin/missions');
    assert.equal(missions.json.data.missions.length, 1);
    const missionId = missions.json.data.missions[0].id;
    const reviewed = await request(`/api/admin/missions/${missionId}`, {
      method: 'PATCH',
      body: { status: 'reviewed' },
    });
    assert.equal(reviewed.status, 200);
    const missionGone = await request(`/api/admin/missions/${missionId}`, { method: 'DELETE' });
    assert.equal(missionGone.status, 200);

    const launchGone = await request(`/api/admin/launches/${launchId}`, { method: 'DELETE' });
    assert.equal(launchGone.status, 200);
    const engineGone = await request(`/api/admin/engines/${engineId}`, { method: 'DELETE' });
    assert.equal(engineGone.status, 200);

    const projects = await request('/api/projects');
    assert.equal(projects.json.data.launches.length, 5);
    assert.equal(projects.json.data.engines.length, 4);
  });

  await t.test('comment moderation, subscribers and messages', async () => {
    const comments = await request('/api/admin/comments');
    const target = comments.json.data.comments.find((item) => item.author === '测试读者');
    assert.ok(target);

    const hide = await request(`/api/admin/comments/${target.id}`, {
      method: 'PATCH',
      body: { status: 'hidden' },
    });
    assert.equal(hide.status, 200);
    const publicComments = await request('/api/posts/liquid-glass-cockpit/comments');
    assert.equal(publicComments.json.data.comments.some((item) => item.id === target.id), false);

    const invalidStatus = await request(`/api/admin/comments/${target.id}`, {
      method: 'PATCH',
      body: { status: 'nonsense' },
    });
    assert.equal(invalidStatus.status, 400);

    const removed = await request(`/api/admin/comments/${target.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);

    const subscribers = await request('/api/admin/subscribers');
    assert.equal(subscribers.json.data.subscribers.length, 1);
    const subscriberId = subscribers.json.data.subscribers[0].id;
    const removedSubscriber = await request(`/api/admin/subscribers/${subscriberId}`, { method: 'DELETE' });
    assert.equal(removedSubscriber.status, 200);

    const messages = await request('/api/admin/messages');
    assert.equal(messages.json.data.messages.length, 1);
    const messageId = messages.json.data.messages[0].id;
    const read = await request(`/api/admin/messages/${messageId}`, {
      method: 'PATCH',
      body: { status: 'read' },
    });
    assert.equal(read.status, 200);
    const removedMessage = await request(`/api/admin/messages/${messageId}`, { method: 'DELETE' });
    assert.equal(removedMessage.status, 200);
  });

  await t.test('settings and generated feeds', async () => {
    const settings = await request('/api/admin/settings');
    assert.equal(settings.status, 200);

    const saved = await request('/api/admin/settings', {
      method: 'PUT',
      body: { settings: { 'site.tagline': '测试中的一句话定位。' } },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.data.settings['site.tagline'], '测试中的一句话定位。');

    const rss = await request('/feed.xml');
    assert.equal(rss.status, 200);
    assert.match(rss.text, /<rss version="2.0"/);
    assert.match(rss.text, /Cockpit|驾驶舱/);

    const sitemap = await request('/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.text, /liquid-glass-cockpit/);

    const robots = await request('/robots.txt');
    assert.match(robots.text, /Sitemap:/);
  });

  await t.test('pages, assets and security headers', async () => {
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(home.text, /liquid-boot/);
    assert.match(home.text, /Liquid Glass/);
    assert.match(home.text, /id="projects"/);
    assert.match(home.text, /id="missionDialog"/);

    const article = await request('/post/liquid-glass-cockpit');
    assert.equal(article.status, 200);
    assert.match(article.text, /当驾驶舱开始像玻璃一样思考/);
    assert.match(article.text, /og:title/);

    const admin = await request('/admin');
    assert.equal(admin.status, 200);
    assert.match(admin.text, /工作台/);

    const manifest = await request('/manifest.webmanifest');
    assert.equal(manifest.status, 200);

    const css = await request('/assets/css/base.css');
    assert.equal(css.status, 200);
    assert.match(css.response.headers.get('content-type'), /text\/css/);

    const missing = await request('/this-does-not-exist');
    assert.equal(missing.status, 404);
    assert.match(missing.text, /404/);
  });

  await t.test('password change invalidates sessions and rotates credentials', async () => {
    const change = await request('/api/admin/password', {
      method: 'POST',
      body: { currentPassword: 'liquid-glass-2026', newPassword: 'new-liquid-2026' },
    });
    assert.equal(change.status, 200);

    const oldSession = await request('/api/admin/overview');
    assert.equal(oldSession.status, 401);

    const oldLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'liquid-glass-2026' },
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'new-liquid-2026' },
    });
    assert.equal(newLogin.status, 200);
    const me = await request('/api/auth/me');
    assert.equal(me.status, 200);
  });

  await t.test('logout clears the admin session', async () => {
    const logout = await request('/api/auth/logout', { method: 'POST' });
    assert.equal(logout.status, 200);
    const overview = await request('/api/admin/overview');
    assert.equal(overview.status, 401);
  });
});
