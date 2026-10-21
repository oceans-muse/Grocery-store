import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  initDatabase, listPosts, getPostBySlug, getPostById, getAdjacentPosts, getRelatedPosts,
  incrementViews, toggleLike, hasLiked, listComments, addComment, listAllComments,
  setCommentStatus, deleteComment, getCategories, getTags, getSettings, setSettings,
  getStats, addSubscriber, listSubscribers, deleteSubscriber, addMessage, listMessages,
  setMessageStatus, deleteMessage, slugExists, insertPost, updatePost, deletePost, adminRecent,
  getProjects, insertLaunch, updateLaunch, deleteLaunch, insertEngine, updateEngine, deleteEngine,
  addMissionRequest, listMissionRequests, setMissionRequestStatus, deleteMissionRequest,
} from './lib/db.js';
import { renderMarkdown, plainText, escapeHtml } from './lib/markdown.js';
import {
  verifyPassword, createSession, getSessionUser, destroySession, updatePassword,
  parseCookies, sessionCookie, clearSessionCookie,
} from './lib/auth.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4310;
const HOST = process.env.HOST || '127.0.0.1';
const COVER_NAMES = new Set(['glass', 'ignition', 'separation', 'catia', 'telemetry', 'letter', 'silence', 'weightless']);
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1';
const ALLOWED_SETTINGS = new Set([
  'site.title', 'site.tagline', 'site.description', 'site.location', 'site.now', 'site.tools',
  'social.github', 'mission.title', 'mission.target', 'mission.site', 'mission.type',
  'mission.payload', 'mission.note', 'newsletter.title', 'newsletter.note',
]);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message, code = 'request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

const ORIGIN = () => process.env.SITE_ORIGIN || `http://${HOST}:${PORT}`;

function requestOrigin(req) {
  if (process.env.SITE_ORIGIN) return process.env.SITE_ORIGIN.replace(/\/$/, '');
  const host = req.headers.host || `${HOST}:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1' ? 'https' : 'http';
  return `${proto}://${host}`;
}

function setCookies(res, cookies) {
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
}

function send(res, status, body, { type = 'text/plain; charset=utf-8', cookies = [], headers = {} } = {}) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', Buffer.byteLength(body));
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  setCookies(res, cookies);
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

function sendJson(res, status, payload, cookies = []) {
  send(res, status, JSON.stringify(payload), {
    type: 'application/json; charset=utf-8',
    cookies,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function ok(res, data, status = 200, cookies = []) {
  sendJson(res, status, { ok: true, data }, cookies);
}

function fail(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : '服务器开小差了，请稍后再试。';
  if (status >= 500) console.error('[server]', error);
  sendJson(res, status, { ok: false, error: { code: error.code || 'server_error', message } });
}

async function readJson(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '请求内容过大。', 'payload_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new HttpError(400, '请求格式不正确。', 'invalid_json');
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (process.env.TRUST_PROXY === '1' && typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

const ipSalt = process.env.IP_SALT || 'oceans-muse-local-salt';
const hashIp = (ip) => crypto.createHash('sha256').update(`${ipSalt}:${ip}`).digest('hex').slice(0, 24);

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    bucket = { count: 0, reset: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (buckets.size > 5000) {
    for (const [entryKey, value] of buckets) if (value.reset < now) buckets.delete(entryKey);
  }
  if (bucket.count > max) throw new HttpError(429, '操作有点频繁，请稍后再试。', 'rate_limited');
}

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 5 || email.length > 160) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

function clean(value, max) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function normalizeSlug(raw, title) {
  let slug = String(raw || '').trim().toLowerCase();
  if (!slug) {
    slug = String(title || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug.length < 2) slug = `note-${Date.now().toString(36)}`;
  }
  slug = slug.replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 84) {
    throw new HttpError(400, '链接别名只能包含小写字母、数字和连字符。', 'invalid_slug');
  }
  return slug;
}

function uniqueSlug(db, base, excludeId = 0) {
  let candidate = base;
  let n = 2;
  while (slugExists(db, candidate, excludeId)) candidate = `${base}-${n++}`;
  return candidate;
}

function normalizePostInput(db, input, existing = null) {
  const title = clean(input.title, 140);
  if (!title) throw new HttpError(400, '标题不能为空。', 'title_required');
  const content = String(input.content ?? '').slice(0, 300000);
  const status = input.status === 'published' ? 'published' : 'draft';
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => clean(tag, 24)).filter(Boolean).slice(0, 8)
    : clean(input.tags, 160).split(/[,，]/).map((tag) => clean(tag.replace(/^#/, ''), 24)).filter(Boolean).slice(0, 8);
  const excerpt = clean(input.excerpt, 300) || plainText(content, 150);
  const category = clean(input.category, 24) || '随笔';
  const cover = COVER_NAMES.has(input.cover) ? input.cover : 'glass';
  const featured = input.featured === true || input.featured === 1 || input.featured === '1';
  let publishedAt = input.publishedAt ? Date.parse(input.publishedAt) : null;
  if (Number.isNaN(publishedAt)) publishedAt = null;
  if (status === 'published' && !publishedAt) publishedAt = existing?.publishedAt ? Date.parse(existing.publishedAt) : Date.now();
  if (status === 'draft' && !publishedAt) publishedAt = existing?.publishedAt ? Date.parse(existing.publishedAt) : null;
  const slug = uniqueSlug(db, normalizeSlug(input.slug, title), existing?.id || 0);
  return {
    title,
    slug,
    excerpt,
    content,
    category,
    tags,
    cover,
    status,
    featured,
    publishedAt,
  };
}

function requireAuth(req, db) {
  const cookies = parseCookies(req.headers.cookie || '');
  const user = getSessionUser(db, cookies.om_session);
  if (!user) throw new HttpError(401, '请先登录工作台。', 'unauthorized');
  return user;
}

function normalizeLaunch(input) {
  const statuses = new Set(['success', 'partial', 'fail']);
  const name = clean(input.name, 120);
  if (!name) throw new HttpError(400, '测试记录名称不能为空。', 'launch_name_required');
  const date = Date.parse(input.date || '');
  return {
    name,
    vehicle: clean(input.vehicle, 80),
    date: Number.isNaN(date) ? Date.now() : date,
    status: statuses.has(input.status) ? input.status : 'success',
    payload: clean(input.payload, 100),
    note: clean(input.note, 600),
  };
}

function normalizeEngine(input) {
  const statuses = new Set(['active', 'dev', 'retired']);
  const code = clean(input.code, 24).toUpperCase();
  const name = clean(input.name, 80);
  if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code)) throw new HttpError(400, '发动机编号格式不正确。', 'engine_code_invalid');
  if (!name) throw new HttpError(400, '发动机名称不能为空。', 'engine_name_required');
  return {
    code,
    name,
    status: statuses.has(input.status) ? input.status : 'dev',
    propellant: clean(input.propellant, 80),
    thrust: clean(input.thrust, 40),
    isp: clean(input.isp, 40),
    note: clean(input.note, 600),
  };
}

function normalizeMissionRequest(input) {
  const types = new Set(['comm', 'remote', 'nav', 'science', 'tech']);
  const type = String(input.type || '');
  if (!types.has(type)) throw new HttpError(400, '请选择卫星类型。', 'mission_type_required');
  const mass = Number(input.mass);
  const altitude = Number(input.altitude);
  const lifetime = Number(input.lifetime);
  if (!Number.isFinite(mass) || mass <= 0 || mass > 100000) {
    throw new HttpError(400, '卫星质量需要在 0 到 100,000 kg 之间。', 'invalid_mass');
  }
  if (!Number.isFinite(altitude) || altitude <= 0 || altitude > 100000) {
    throw new HttpError(400, '目标高度需要在 0 到 100,000 km 之间。', 'invalid_altitude');
  }
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 50) {
    throw new HttpError(400, '滞空时长需要在 0 到 50 年之间。', 'invalid_lifetime');
  }
  return {
    batch: clean(input.batch, 60),
    type,
    mass: Math.round(mass * 1000) / 1000,
    altitude: Math.round(altitude * 1000) / 1000,
    lifetime: Math.round(lifetime * 1000) / 1000,
  };
}

function ensureVisitor(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.om_visitor && /^[a-zA-Z0-9-]{8,64}$/.test(cookies.om_visitor)) return { id: cookies.om_visitor, setCookie: null };
  const id = crypto.randomUUID();
  return {
    id,
    setCookie: `om_visitor=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${SECURE_COOKIE ? '; Secure' : ''}`,
  };
}

function requireSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (origin !== requestOrigin(req)) throw new HttpError(403, '来源校验失败。', 'origin_mismatch');
}

async function serveFile(res, filePath, { status = 200, cache = 'public, max-age=300', headers = {} } = {}) {
  let body;
  try {
    body = await fs.readFile(filePath);
  } catch {
    send(res, 404, 'Not found', { type: 'text/plain; charset=utf-8' });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = status;
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', cache);
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

async function servePostPage(req, res, db, slug) {
  const post = getPostBySlug(db, slug);
  const status = post ? 200 : 404;
  const title = post ? `${post.title} · oceans-muse` : '文章未找到 · oceans-muse';
  const description = post ? post.excerpt : '这篇文章可能已经离开了当前轨道。';
  const canonical = `${requestOrigin(req)}/post/${encodeURIComponent(post?.slug || slug)}`;
  const noscript = post
    ? `<noscript><article><h1>${escapeHtml(post.title)}</h1><p>${escapeHtml(post.excerpt)}</p><p>${escapeHtml(plainText(post.content, 400))}</p></article></noscript>`
    : '<noscript><p>文章未找到。</p></noscript>';
  let html;
  try {
    html = await fs.readFile(path.join(PUBLIC_DIR, 'post.html'), 'utf8');
  } catch {
    send(res, 500, '模板缺失', { type: 'text/plain; charset=utf-8' });
    return;
  }
  html = html
    .replaceAll('__META_TITLE__', escapeHtml(title))
    .replaceAll('__META_DESCRIPTION__', escapeHtml(description))
    .replaceAll('__CANONICAL__', escapeHtml(canonical))
    .replaceAll('__OG_IMAGE__', `${requestOrigin(req)}/assets/media/og.svg`)
    .replaceAll('__NOSCRIPT__', noscript);
  send(res, status, html, { type: MIME['.html'], headers: { 'Cache-Control': 'no-cache' } });
}

function rssXml(req, db) {
  const { items } = listPosts(db, { limit: 30, sort: 'new' });
  const base = requestOrigin(req);
  const escape = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const itemsXml = items.map((post) => `
    <item>
      <title>${escape(post.title)}</title>
      <link>${base}/post/${encodeURIComponent(post.slug)}</link>
      <guid isPermaLink="true">${base}/post/${encodeURIComponent(post.slug)}</guid>
      <description>${escape(post.excerpt)}</description>
      <category>${escape(post.category)}</category>
      <pubDate>${new Date(post.publishedAt || Date.now()).toUTCString()}</pubDate>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>oceans-muse · 飞行日志</title>
    <link>${base}</link>
    <description>火箭设计师的个人手记：结构、推进、飞控，以及那些让复杂变简单的设计判断。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml"/>
    ${itemsXml}
  </channel>
</rss>`;
}

function sitemapXml(req, db) {
  const base = requestOrigin(req);
  const { items } = listPosts(db, { limit: 50 });
  const urls = [
    { loc: `${base}/`, priority: '1.0' },
    { loc: `${base}/#journal`, priority: '0.8' },
    ...items.map((post) => ({
      loc: `${base}/post/${encodeURIComponent(post.slug)}`,
      lastmod: (post.updatedAt || post.publishedAt || '').slice(0, 10),
      priority: post.featured ? '0.9' : '0.7',
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((entry) => `  <url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}<priority>${entry.priority}</priority></url>`).join('\n')}
</urlset>`;
}

async function handleApi(req, res, db, url) {
  const { pathname, searchParams } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return ok(res, { status: 'ok', time: new Date().toISOString() });
  }

  if (pathname === '/api/meta' && method === 'GET') {
    const settings = getSettings(db);
    return ok(res, {
      settings,
      stats: getStats(db),
      categories: getCategories(db),
      tags: getTags(db),
      years: Math.max(1, new Date().getFullYear() - 2020),
      now: new Date().toISOString(),
    });
  }

  if (pathname === '/api/posts' && method === 'GET') {
    const result = listPosts(db, {
      q: clean(searchParams.get('q'), 100),
      category: clean(searchParams.get('category'), 30),
      tag: clean(searchParams.get('tag'), 30),
      sort: searchParams.get('sort') || 'new',
      limit: searchParams.get('limit') || 9,
      offset: searchParams.get('offset') || 0,
      status: 'published',
    });
    return ok(res, {
      ...result,
      categories: getCategories(db),
      tags: getTags(db),
    });
  }

  const likeMatch = pathname.match(/^\/api\/posts\/([a-z0-9-]+)\/like$/);
  if (likeMatch && method === 'POST') {
    requireSameOrigin(req);
    rateLimit(`like:${clientIp(req)}`, 80, 10 * 60_000);
    const post = getPostBySlug(db, likeMatch[1]);
    if (!post) throw new HttpError(404, '文章不存在。', 'post_not_found');
    const visitor = ensureVisitor(req, res);
    const result = toggleLike(db, post.id, visitor.id);
    return ok(res, result, 200, visitor.setCookie ? [visitor.setCookie] : []);
  }

  const commentsMatch = pathname.match(/^\/api\/posts\/([a-z0-9-]+)\/comments$/);
  if (commentsMatch && method === 'GET') {
    const post = getPostBySlug(db, commentsMatch[1]);
    if (!post) throw new HttpError(404, '文章不存在。', 'post_not_found');
    return ok(res, { comments: listComments(db, post.id) });
  }
  if (commentsMatch && method === 'POST') {
    requireSameOrigin(req);
    const ip = clientIp(req);
    rateLimit(`comment:${hashIp(ip)}`, 6, 10 * 60_000);
    const post = getPostBySlug(db, commentsMatch[1]);
    if (!post) throw new HttpError(404, '文章不存在。', 'post_not_found');
    const body = await readJson(req);
    if (body.website) return ok(res, { pending: true, message: '评论已收到。' }, 201);
    const author = clean(body.author, 40);
    const text = clean(body.body, 2000);
    const email = body.email ? validEmail(body.email) : '';
    if (author.length < 2) throw new HttpError(400, '请留下至少 2 个字符的称呼。', 'author_required');
    if (text.length < 2) throw new HttpError(400, '评论内容太短了。', 'comment_too_short');
    if (body.email && !email) throw new HttpError(400, '邮箱格式不正确。', 'invalid_email');
    addComment(db, post.id, { author, email: email || '', body: text, ipHash: hashIp(ip) });
    return ok(res, { message: '评论已发布。' }, 201);
  }

  const postMatch = pathname.match(/^\/api\/posts\/([a-z0-9-]+)$/);
  if (postMatch && method === 'GET') {
    const post = getPostBySlug(db, postMatch[1]);
    if (!post) throw new HttpError(404, '这篇文章不存在，或已离开当前轨道。', 'post_not_found');
    incrementViews(db, post.id);
    post.views += 1;
    const rendered = renderMarkdown(post.content);
    post.readingMinutes = rendered.minutes;
    const visitor = ensureVisitor(req, res);
    const cookies = visitor.setCookie ? [visitor.setCookie] : [];
    return ok(res, {
      post: { ...post, html: rendered.html, toc: rendered.toc },
      liked: hasLiked(db, post.id, visitor.id),
      adjacent: getAdjacentPosts(db, post),
      related: getRelatedPosts(db, post, 3),
    }, 200, cookies);
  }

  if (pathname === '/api/subscribe' && method === 'POST') {
    requireSameOrigin(req);
    rateLimit(`subscribe:${clientIp(req)}`, 8, 60 * 60_000);
    const body = await readJson(req);
    const email = validEmail(body.email);
    if (!email) throw new HttpError(400, '请填写有效的邮箱地址。', 'invalid_email');
    const result = addSubscriber(db, email, body.source === 'footer' ? 'footer' : 'website');
    return ok(res, {
      created: result.created,
      message: result.created ? '订阅成功，下一封信会在合适的时候抵达。' : '这个邮箱已经在名单里了。',
    }, result.created ? 201 : 200);
  }

  if (pathname === '/api/contact' && method === 'POST') {
    requireSameOrigin(req);
    rateLimit(`contact:${clientIp(req)}`, 4, 60 * 60_000);
    const body = await readJson(req);
    const name = clean(body.name, 60);
    const email = validEmail(body.email);
    const message = clean(body.message, 3000);
    const subject = clean(body.subject, 120);
    if (name.length < 2) throw new HttpError(400, '请填写称呼。', 'name_required');
    if (!email) throw new HttpError(400, '请填写有效邮箱。', 'invalid_email');
    if (message.length < 10) throw new HttpError(400, '请把想说的话写得再具体一点。', 'message_too_short');
    addMessage(db, { name, email, subject, body: message });
    return ok(res, { message: '信号已收到，我会尽快回复。' }, 201);
  }

  if (pathname === '/api/projects' && method === 'GET') {
    return ok(res, getProjects(db));
  }

  if (pathname === '/api/mission-requests' && method === 'POST') {
    requireSameOrigin(req);
    rateLimit(`mission:${clientIp(req)}`, 6, 60 * 60_000);
    const body = await readJson(req);
    const data = normalizeMissionRequest(body);
    const id = addMissionRequest(db, data);
    return ok(res, {
      id,
      reference: `MSN-${String(id).padStart(4, '0')}`,
      message: '卫星参数已进入任务队列，可在工作台中继续评估。',
    }, 201);
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    requireSameOrigin(req);
    const ip = clientIp(req);
    rateLimit(`login:${ip}`, 8, 15 * 60_000);
    const body = await readJson(req);
    const username = clean(body.username, 60);
    const password = String(body.password || '');
    if (!username || !password) throw new HttpError(400, '请输入账号和密码。', 'credentials_required');
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const valid = row && await verifyPassword(password, row.password_hash);
    if (!valid) throw new HttpError(401, '账号或密码不正确。', 'invalid_credentials');
    const session = createSession(db, row.id);
    return ok(res, {
      user: { id: row.id, username: row.username, displayName: row.display_name },
    }, 200, [sessionCookie(session.token, session.maxAge, SECURE_COOKIE)]);
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    requireSameOrigin(req);
    const cookies = parseCookies(req.headers.cookie || '');
    destroySession(db, cookies.om_session);
    return ok(res, { message: '已退出登录。' }, 200, [clearSessionCookie(SECURE_COOKIE)]);
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = requireAuth(req, db);
    return ok(res, { user });
  }

  if (pathname.startsWith('/api/admin/')) {
    const user = requireAuth(req, db);

    if (pathname === '/api/admin/overview' && method === 'GET') {
      return ok(res, {
        user,
        stats: getStats(db),
        recent: adminRecent(db),
        settings: getSettings(db),
        categories: getCategories(db),
      });
    }

    if (pathname === '/api/admin/posts' && method === 'GET') {
      const result = listPosts(db, {
        status: searchParams.get('status') || 'all',
        q: clean(searchParams.get('q'), 100),
        sort: searchParams.get('sort') || 'updated',
        limit: 100,
      });
      return ok(res, result);
    }

    if (pathname === '/api/admin/posts' && method === 'POST') {
      requireSameOrigin(req);
      const input = await readJson(req, 1024 * 1024);
      const data = normalizePostInput(db, input);
      const id = insertPost(db, data);
      return ok(res, { post: getPostById(db, id) }, 201);
    }

    const adminPostMatch = pathname.match(/^\/api\/admin\/posts\/(\d+)$/);
    if (adminPostMatch) {
      const id = Number(adminPostMatch[1]);
      const existing = getPostById(db, id);
      if (!existing) throw new HttpError(404, '文章不存在。', 'post_not_found');
      if (method === 'GET') return ok(res, { post: existing });
      if (method === 'PUT') {
        requireSameOrigin(req);
        const input = await readJson(req, 1024 * 1024);
        const data = normalizePostInput(db, input, existing);
        updatePost(db, id, data);
        return ok(res, { post: getPostById(db, id) });
      }
      if (method === 'DELETE') {
        requireSameOrigin(req);
        deletePost(db, id);
        return ok(res, { deleted: true });
      }
    }

    if (pathname === '/api/admin/comments' && method === 'GET') {
      return ok(res, { comments: listAllComments(db, searchParams.get('status') || '') });
    }

    const adminCommentMatch = pathname.match(/^\/api\/admin\/comments\/(\d+)$/);
    if (adminCommentMatch) {
      const id = Number(adminCommentMatch[1]);
      if (method === 'PATCH') {
        requireSameOrigin(req);
        const body = await readJson(req);
        if (!['approved', 'pending', 'hidden'].includes(body.status)) {
          throw new HttpError(400, '评论状态不正确。', 'invalid_status');
        }
        setCommentStatus(db, id, body.status);
        return ok(res, { updated: true });
      }
      if (method === 'DELETE') {
        requireSameOrigin(req);
        deleteComment(db, id);
        return ok(res, { deleted: true });
      }
    }

    if (pathname === '/api/admin/subscribers' && method === 'GET') {
      return ok(res, { subscribers: listSubscribers(db) });
    }
    const subscriberMatch = pathname.match(/^\/api\/admin\/subscribers\/(\d+)$/);
    if (subscriberMatch && method === 'DELETE') {
      requireSameOrigin(req);
      deleteSubscriber(db, Number(subscriberMatch[1]));
      return ok(res, { deleted: true });
    }

    if (pathname === '/api/admin/messages' && method === 'GET') {
      return ok(res, { messages: listMessages(db) });
    }
    const messageMatch = pathname.match(/^\/api\/admin\/messages\/(\d+)$/);
    if (messageMatch) {
      if (method === 'PATCH') {
        requireSameOrigin(req);
        const body = await readJson(req);
        if (!['new', 'read', 'archived'].includes(body.status)) {
          throw new HttpError(400, '消息状态不正确。', 'invalid_status');
        }
        setMessageStatus(db, Number(messageMatch[1]), body.status);
        return ok(res, { updated: true });
      }
      if (method === 'DELETE') {
        requireSameOrigin(req);
        deleteMessage(db, Number(messageMatch[1]));
        return ok(res, { deleted: true });
      }
    }

    if (pathname === '/api/admin/projects' && method === 'GET') {
      return ok(res, getProjects(db));
    }

    if (pathname === '/api/admin/launches' && method === 'POST') {
      requireSameOrigin(req);
      const body = await readJson(req);
      const data = normalizeLaunch(body);
      const id = insertLaunch(db, data);
      return ok(res, { launch: getProjects(db).launches.find((item) => item.id === id) }, 201);
    }
    const launchMatch = pathname.match(/^\/api\/admin\/launches\/(\d+)$/);
    if (launchMatch) {
      const id = Number(launchMatch[1]);
      if (method === 'PUT') {
        requireSameOrigin(req);
        const body = await readJson(req);
        const data = normalizeLaunch(body);
        if (!updateLaunch(db, id, data)) throw new HttpError(404, '测试记录不存在。', 'launch_not_found');
        return ok(res, { launch: getProjects(db).launches.find((item) => item.id === id) });
      }
      if (method === 'DELETE') {
        requireSameOrigin(req);
        deleteLaunch(db, id);
        return ok(res, { deleted: true });
      }
    }

    if (pathname === '/api/admin/engines' && method === 'POST') {
      requireSameOrigin(req);
      const body = await readJson(req);
      const data = normalizeEngine(body);
      const duplicate = db.prepare('SELECT id FROM engines WHERE code = ?').get(data.code);
      if (duplicate) throw new HttpError(409, '这个发动机编号已经存在。', 'engine_code_exists');
      const id = insertEngine(db, data);
      return ok(res, { engine: getProjects(db).engines.find((item) => item.id === id) }, 201);
    }
    const engineMatch = pathname.match(/^\/api\/admin\/engines\/(\d+)$/);
    if (engineMatch) {
      const id = Number(engineMatch[1]);
      if (method === 'PUT') {
        requireSameOrigin(req);
        const body = await readJson(req);
        const data = normalizeEngine(body);
        const duplicate = db.prepare('SELECT id FROM engines WHERE code = ? AND id != ?').get(data.code, id);
        if (duplicate) throw new HttpError(409, '这个发动机编号已经存在。', 'engine_code_exists');
        if (!updateEngine(db, id, data)) throw new HttpError(404, '发动机不存在。', 'engine_not_found');
        return ok(res, { engine: getProjects(db).engines.find((item) => item.id === id) });
      }
      if (method === 'DELETE') {
        requireSameOrigin(req);
        deleteEngine(db, id);
        return ok(res, { deleted: true });
      }
    }

    if (pathname === '/api/admin/missions' && method === 'GET') {
      return ok(res, { missions: listMissionRequests(db) });
    }
    const missionMatch = pathname.match(/^\/api\/admin\/missions\/(\d+)$/);
    if (missionMatch) {
      if (method === 'PATCH') {
        requireSameOrigin(req);
        const body = await readJson(req);
        if (!['new', 'reviewed', 'closed'].includes(body.status)) {
          throw new HttpError(400, '任务状态不正确。', 'invalid_status');
        }
        setMissionRequestStatus(db, Number(missionMatch[1]), body.status);
        return ok(res, { updated: true });
      }
      if (method === 'DELETE') {
        requireSameOrigin(req);
        deleteMissionRequest(db, Number(missionMatch[1]));
        return ok(res, { deleted: true });
      }
    }

    if (pathname === '/api/admin/settings' && method === 'GET') {
      return ok(res, { settings: getSettings(db) });
    }
    if (pathname === '/api/admin/settings' && method === 'PUT') {
      requireSameOrigin(req);
      const body = await readJson(req);
      const values = {};
      for (const [key, value] of Object.entries(body.settings || {})) {
        if (ALLOWED_SETTINGS.has(key)) values[key] = clean(value, 600);
      }
      if (!Object.keys(values).length) throw new HttpError(400, '没有可保存的设置。', 'no_settings');
      setSettings(db, values);
      return ok(res, { settings: getSettings(db) });
    }

    if (pathname === '/api/admin/preview' && method === 'POST') {
      requireSameOrigin(req);
      const body = await readJson(req, 1024 * 1024);
      const rendered = renderMarkdown(String(body.content || ''));
      return ok(res, rendered);
    }

    if (pathname === '/api/admin/password' && method === 'POST') {
      requireSameOrigin(req);
      const body = await readJson(req);
      const current = String(body.currentPassword || '');
      const next = String(body.newPassword || '');
      if (next.length < 8 || next.length > 120) throw new HttpError(400, '新密码至少需要 8 个字符。', 'weak_password');
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      if (!row || !(await verifyPassword(current, row.password_hash))) {
        throw new HttpError(400, '当前密码不正确。', 'invalid_password');
      }
      await updatePassword(db, user.id, next);
      return ok(res, { message: '密码已更新，请重新登录。' }, 200, [clearSessionCookie(SECURE_COOKIE)]);
    }
  }

  throw new HttpError(404, '接口不存在。', 'not_found');
}

async function handleRequest(req, res, db) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, db, { pathname, searchParams: url.searchParams });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      throw new HttpError(405, '不支持该请求方法。', 'method_not_allowed');
    }

    if (pathname === '/' || pathname === '/index.html') {
      return await serveFile(res, path.join(PUBLIC_DIR, 'index.html'), {
        cache: 'no-cache',
      });
    }
    if (pathname === '/admin' || pathname === '/admin/') {
      return await serveFile(res, path.join(PUBLIC_DIR, 'admin.html'), {
        cache: 'no-cache',
      });
    }
    const postPageMatch = pathname.match(/^\/post\/([a-z0-9-]+)\/?$/);
    if (postPageMatch) return await servePostPage(req, res, db, postPageMatch[1]);

    if (pathname === '/feed.xml' || pathname === '/rss.xml') {
      return send(res, 200, rssXml(req, db), {
        type: MIME['.xml'],
        headers: { 'Cache-Control': 'public, max-age=300' },
      });
    }
    if (pathname === '/sitemap.xml') {
      return send(res, 200, sitemapXml(req, db), {
        type: MIME['.xml'],
        headers: { 'Cache-Control': 'public, max-age=600' },
      });
    }
    if (pathname === '/robots.txt') {
      const origin = requestOrigin(req);
      return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${origin}/sitemap.xml\n`, {
        type: MIME['.txt'],
        headers: { 'Cache-Control': 'public, max-age=600' },
      });
    }
    if (pathname === '/manifest.webmanifest') {
      return await serveFile(res, path.join(PUBLIC_DIR, 'manifest.webmanifest'), {
        cache: 'public, max-age=3600',
      });
    }
    if (pathname === '/favicon.ico') {
      return await serveFile(res, path.join(PUBLIC_DIR, 'assets', 'media', 'favicon.svg'), {
        cache: 'public, max-age=86400',
      });
    }

    if (pathname.startsWith('/assets/')) {
      const relative = pathname.replace(/^\/+/, '');
      const resolved = path.resolve(PUBLIC_DIR, relative);
      if (!resolved.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
        throw new HttpError(403, '禁止访问。', 'forbidden');
      }
      const ext = path.extname(resolved).toLowerCase();
      if (!MIME[ext]) throw new HttpError(404, '资源不存在。', 'not_found');
      return await serveFile(res, resolved, {
        cache: ext === '.svg' || ext === '.woff2' ? 'public, max-age=86400' : 'public, max-age=3600',
      });
    }

    return await serveFile(res, path.join(PUBLIC_DIR, '404.html'), { status: 404, cache: 'no-cache' });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    fail(res, error);
  }
}

export async function createBlogServer({ dbPath } = {}) {
  const db = await initDatabase(dbPath);
  const server = http.createServer((req, res) => {
    res.req = req;
    handleRequest(req, res, db).catch((error) => fail(res, error));
  });
  const close = () => new Promise((resolve) => {
    server.close(() => {
      try { db.close(); } catch { /* already closed */ }
      resolve();
    });
  });
  return { server, db, close };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const { server } = await createBlogServer();
  server.listen(PORT, HOST, () => {
    console.log(`\n  oceans-muse · liquid blog`);
    console.log(`  ${ORIGIN()}`);
    console.log(`  admin: ${ORIGIN()}/admin  (user: ${process.env.ADMIN_USER || 'admin'})\n`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
