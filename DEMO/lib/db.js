import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readingMinutes } from './markdown.js';
import { seedDatabase } from './seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB = path.join(ROOT, 'data', 'blog.db');

const parseTags = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : [];
  } catch {
    return [];
  }
};

const iso = (value) => (value ? new Date(Number(value)).toISOString() : null);

export function openDatabase(file = process.env.DB_PATH || DEFAULT_DB) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT 'oceans-muse',
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '随笔',
      tags TEXT NOT NULL DEFAULT '[]',
      cover TEXT NOT NULL DEFAULT 'glass',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      featured INTEGER NOT NULL DEFAULT 0,
      published_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status_date ON posts(status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending', 'hidden')),
      created_at INTEGER NOT NULL,
      ip_hash TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'website'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      visitor_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, visitor_id)
    );

    CREATE TABLE IF NOT EXISTS launches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      vehicle TEXT NOT NULL DEFAULT '',
      date INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'fail')),
      payload TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS engines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'dev' CHECK (status IN ('active', 'dev', 'retired')),
      propellant TEXT NOT NULL DEFAULT '',
      thrust TEXT NOT NULL DEFAULT '',
      isp TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mission_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      mass REAL NOT NULL DEFAULT 0,
      altitude REAL NOT NULL DEFAULT 0,
      lifetime REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'closed')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export async function initDatabase(file) {
  const db = openDatabase(file);
  await seedDatabase(db);
  return db;
}

export function rowToPost(row, { detail = false } = {}) {
  if (!row) return null;
  const post = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    category: row.category,
    tags: parseTags(row.tags),
    cover: row.cover,
    status: row.status,
    featured: Boolean(row.featured),
    publishedAt: iso(row.published_at),
    updatedAt: iso(row.updated_at),
    views: row.views,
    likes: row.likes,
    readingMinutes: row.reading_minutes ?? readingMinutes(row.content || ''),
  };
  if (detail) post.content = row.content;
  if (row.comment_count !== undefined) post.commentCount = row.comment_count;
  return post;
}

export function listPosts(db, options = {}) {
  const {
    status = 'published', q = '', category = '', tag = '', sort = 'new',
    limit = 10, offset = 0,
  } = options;
  const where = [];
  const params = [];
  if (status && status !== 'all') {
    where.push('p.status = ?');
    params.push(status);
  }
  if (!where.length) where.push('1 = 1');

  if (q) {
    where.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ? OR p.tags LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (category && category !== '全部' && category !== 'all') {
    where.push('p.category = ?');
    params.push(category);
  }
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(p.tags) WHERE value = ?)');
    params.push(tag);
  }

  const orders = {
    new: 'p.published_at DESC, p.id DESC',
    old: 'p.published_at ASC, p.id ASC',
    popular: '(p.views + p.likes * 5) DESC, p.published_at DESC',
    updated: 'p.updated_at DESC, p.id DESC',
  };
  const order = orders[sort] || orders.new;
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM posts p WHERE ${where.join(' AND ')}`
  ).get(...params).n;

  const rows = db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'approved') AS comment_count
       FROM posts p
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`
  ).all(...params, safeLimit, safeOffset);

  return { items: rows.map((row) => rowToPost(row)), total, limit: safeLimit, offset: safeOffset };
}

export function getPostBySlug(db, slug, { includeDraft = false } = {}) {
  const row = db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'approved') AS comment_count
       FROM posts p WHERE p.slug = ? ${includeDraft ? '' : "AND p.status = 'published'"}`
  ).get(slug);
  return rowToPost(row, { detail: true });
}

export function getPostById(db, id) {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(id));
  return rowToPost(row, { detail: true });
}

export function getAdjacentPosts(db, post) {
  const base = post.publishedAt ? Date.parse(post.publishedAt) : Date.now();
  const prev = db.prepare(
    `SELECT slug, title FROM posts WHERE status = 'published' AND published_at < ? AND id != ?
      ORDER BY published_at DESC LIMIT 1`
  ).get(base, post.id);
  const next = db.prepare(
    `SELECT slug, title FROM posts WHERE status = 'published' AND published_at > ? AND id != ?
      ORDER BY published_at ASC LIMIT 1`
  ).get(base, post.id);
  return {
    prev: prev ? { slug: prev.slug, title: prev.title } : null,
    next: next ? { slug: next.slug, title: next.title } : null,
  };
}

export function getRelatedPosts(db, post, limit = 3) {
  const rows = db.prepare(
    `SELECT * FROM posts
      WHERE status = 'published' AND id != ? AND category = ?
      ORDER BY (featured * 30 + views) DESC, published_at DESC LIMIT ?`
  ).all(post.id, post.category, limit);
  if (rows.length >= limit) return rows.map((row) => rowToPost(row));
  const fallback = db.prepare(
    `SELECT * FROM posts WHERE status = 'published' AND id != ?
      ORDER BY published_at DESC LIMIT ?`
  ).all(post.id, limit);
  const seen = new Set();
  return fallback.map((row) => rowToPost(row)).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, limit);
}

export function incrementViews(db, id) {
  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(id);
}

export function toggleLike(db, postId, visitorId) {
  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND visitor_id = ?')
    .get(postId, visitorId);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (existing) {
      db.prepare('DELETE FROM post_likes WHERE post_id = ? AND visitor_id = ?').run(postId, visitorId);
      db.prepare('UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?').run(postId);
    } else {
      db.prepare('INSERT INTO post_likes (post_id, visitor_id, created_at) VALUES (?, ?, ?)')
        .run(postId, visitorId, Date.now());
      db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(postId);
    }
    const likes = db.prepare('SELECT likes FROM posts WHERE id = ?').get(postId)?.likes || 0;
    db.exec('COMMIT');
    return { liked: !existing, likes };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function hasLiked(db, postId, visitorId) {
  if (!visitorId) return false;
  return Boolean(db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND visitor_id = ?')
    .get(postId, visitorId));
}

export function listComments(db, postId, { includeHidden = false } = {}) {
  const rows = includeHidden
    ? db.prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at DESC').all(postId)
    : db.prepare("SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at ASC").all(postId);
  return rows.map((row) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    status: row.status,
    createdAt: iso(row.created_at),
  }));
}

export function addComment(db, postId, { author, email, body, ipHash }) {
  const result = db.prepare(
    `INSERT INTO comments (post_id, author, email, body, status, created_at, ip_hash)
     VALUES (?, ?, ?, ?, 'approved', ?, ?)`
  ).run(postId, author, email || '', body, Date.now(), ipHash || '');
  return Number(result.lastInsertRowid);
}

export function listAllComments(db, status = '') {
  const where = status ? 'WHERE c.status = ?' : '';
  const params = status ? [status] : [];
  return db.prepare(
    `SELECT c.*, p.title AS post_title, p.slug AS post_slug
       FROM comments c JOIN posts p ON p.id = c.post_id
       ${where} ORDER BY c.created_at DESC LIMIT 300`
  ).all(...params).map((row) => ({
    id: row.id,
    postTitle: row.post_title,
    postSlug: row.post_slug,
    author: row.author,
    email: row.email,
    body: row.body,
    status: row.status,
    createdAt: iso(row.created_at),
  }));
}

export function setCommentStatus(db, id, status) {
  if (!['approved', 'pending', 'hidden'].includes(status)) throw new Error('invalid status');
  db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(status, Number(id));
}

export function deleteComment(db, id) {
  db.prepare('DELETE FROM comments WHERE id = ?').run(Number(id));
}

export function getCategories(db) {
  return db.prepare(
    `SELECT category AS name, COUNT(*) AS count FROM posts
      WHERE status = 'published' GROUP BY category ORDER BY count DESC, name ASC`
  ).all();
}

export function getTags(db) {
  const rows = db.prepare("SELECT tags FROM posts WHERE status = 'published'").all();
  const counts = new Map();
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

export function getSettings(db) {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map((row) => [row.key, row.value])
  );
}

export function setSettings(db, values) {
  const statement = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  db.exec('BEGIN');
  try {
    for (const [key, value] of Object.entries(values)) {
      if (typeof key === 'string' && key.length < 80) statement.run(key, String(value ?? ''));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getStats(db) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const posts = one("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'").n;
  const drafts = one("SELECT COUNT(*) AS n FROM posts WHERE status = 'draft'").n;
  const comments = one('SELECT COUNT(*) AS n FROM comments').n;
  const subscribers = one('SELECT COUNT(*) AS n FROM subscribers').n;
  const messages = one("SELECT COUNT(*) AS n FROM messages WHERE status = 'new'").n;
  const missionRequests = one("SELECT COUNT(*) AS n FROM mission_requests WHERE status = 'new'").n;
  const projects = one('SELECT (SELECT COUNT(*) FROM launches) + (SELECT COUNT(*) FROM engines) AS n').n;
  const totals = one('SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(likes),0) AS likes FROM posts');
  return {
    posts,
    drafts,
    comments,
    subscribers,
    messages,
    missionRequests,
    projects,
    views: totals.views,
    likes: totals.likes,
  };
}

export function addSubscriber(db, email, source = 'website') {
  const existing = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
  if (existing) return { created: false, id: existing.id };
  const result = db.prepare('INSERT INTO subscribers (email, created_at, source) VALUES (?, ?, ?)')
    .run(email, Date.now(), source);
  return { created: true, id: Number(result.lastInsertRowid) };
}

export function listSubscribers(db) {
  return db.prepare('SELECT id, email, source, created_at FROM subscribers ORDER BY created_at DESC')
    .all().map((row) => ({
      id: row.id,
      email: row.email,
      source: row.source,
      createdAt: iso(row.created_at),
    }));
}

export function deleteSubscriber(db, id) {
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(Number(id));
}

export function addMessage(db, { name, email, subject, body }) {
  const result = db.prepare(
    'INSERT INTO messages (name, email, subject, body, status, created_at) VALUES (?, ?, ?, ?, \'new\', ?)'
  ).run(name, email, subject || '', body, Date.now());
  return Number(result.lastInsertRowid);
}

export function listMessages(db) {
  return db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 300').all().map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: iso(row.created_at),
  }));
}

export function setMessageStatus(db, id, status) {
  if (!['new', 'read', 'archived'].includes(status)) throw new Error('invalid status');
  db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, Number(id));
}

export function deleteMessage(db, id) {
  db.prepare('DELETE FROM messages WHERE id = ?').run(Number(id));
}

export function slugExists(db, slug, excludeId = 0) {
  return Boolean(db.prepare('SELECT 1 FROM posts WHERE slug = ? AND id != ?').get(slug, Number(excludeId) || 0));
}

export function insertPost(db, data) {
  const now = Date.now();
  const result = db.prepare(
    `INSERT INTO posts
      (slug, title, excerpt, content, category, tags, cover, status, featured, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.slug, data.title, data.excerpt, data.content, data.category,
    JSON.stringify(data.tags || []), data.cover, data.status,
    data.featured ? 1 : 0, data.publishedAt || null, now, now
  );
  return Number(result.lastInsertRowid);
}

export function updatePost(db, id, data) {
  const existing = getPostById(db, id);
  if (!existing) return false;
  db.prepare(
    `UPDATE posts SET slug = ?, title = ?, excerpt = ?, content = ?, category = ?, tags = ?,
       cover = ?, status = ?, featured = ?, published_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    data.slug, data.title, data.excerpt, data.content, data.category,
    JSON.stringify(data.tags || []), data.cover, data.status,
    data.featured ? 1 : 0,
    data.publishedAt || existing.publishedAt || null,
    Date.now(), Number(id)
  );
  return true;
}

export function deletePost(db, id) {
  return db.prepare('DELETE FROM posts WHERE id = ?').run(Number(id)).changes > 0;
}

/* ── Projects & achievements ─────────────────────────────────── */

const rowToLaunch = (row) => ({
  id: row.id,
  name: row.name,
  vehicle: row.vehicle,
  date: iso(row.date),
  status: row.status,
  payload: row.payload,
  note: row.note,
});

const rowToEngine = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  status: row.status,
  propellant: row.propellant,
  thrust: row.thrust,
  isp: row.isp,
  note: row.note,
});

export function listLaunches(db) {
  return db.prepare('SELECT * FROM launches ORDER BY date DESC, id DESC').all().map(rowToLaunch);
}

export function listEngines(db) {
  return db.prepare('SELECT * FROM engines ORDER BY id ASC').all().map(rowToEngine);
}

export function getProjects(db) {
  return { launches: listLaunches(db), engines: listEngines(db) };
}

export function insertLaunch(db, data) {
  const now = Date.now();
  const result = db.prepare(
    `INSERT INTO launches (name, vehicle, date, status, payload, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.name, data.vehicle, data.date, data.status, data.payload, data.note, now, now);
  return Number(result.lastInsertRowid);
}

export function updateLaunch(db, id, data) {
  const result = db.prepare(
    `UPDATE launches SET name = ?, vehicle = ?, date = ?, status = ?, payload = ?, note = ?, updated_at = ?
     WHERE id = ?`
  ).run(data.name, data.vehicle, data.date, data.status, data.payload, data.note, Date.now(), Number(id));
  return result.changes > 0;
}

export function deleteLaunch(db, id) {
  return db.prepare('DELETE FROM launches WHERE id = ?').run(Number(id)).changes > 0;
}

export function insertEngine(db, data) {
  const now = Date.now();
  const result = db.prepare(
    `INSERT INTO engines (code, name, status, propellant, thrust, isp, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.code, data.name, data.status, data.propellant, data.thrust, data.isp, data.note, now, now);
  return Number(result.lastInsertRowid);
}

export function updateEngine(db, id, data) {
  const result = db.prepare(
    `UPDATE engines SET code = ?, name = ?, status = ?, propellant = ?, thrust = ?, isp = ?, note = ?, updated_at = ?
     WHERE id = ?`
  ).run(data.code, data.name, data.status, data.propellant, data.thrust, data.isp, data.note, Date.now(), Number(id));
  return result.changes > 0;
}

export function deleteEngine(db, id) {
  return db.prepare('DELETE FROM engines WHERE id = ?').run(Number(id)).changes > 0;
}

export function addMissionRequest(db, data) {
  const result = db.prepare(
    `INSERT INTO mission_requests (batch, type, mass, altitude, lifetime, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'new', ?)`
  ).run(data.batch, data.type, data.mass, data.altitude, data.lifetime, Date.now());
  return Number(result.lastInsertRowid);
}

export function listMissionRequests(db) {
  return db.prepare('SELECT * FROM mission_requests ORDER BY created_at DESC').all().map((row) => ({
    id: row.id,
    reference: `MSN-${String(row.id).padStart(4, '0')}`,
    batch: row.batch,
    type: row.type,
    mass: row.mass,
    altitude: row.altitude,
    lifetime: row.lifetime,
    status: row.status,
    createdAt: iso(row.created_at),
  }));
}

export function setMissionRequestStatus(db, id, status) {
  if (!['new', 'reviewed', 'closed'].includes(status)) throw new Error('invalid status');
  db.prepare('UPDATE mission_requests SET status = ? WHERE id = ?').run(status, Number(id));
}

export function deleteMissionRequest(db, id) {
  return db.prepare('DELETE FROM mission_requests WHERE id = ?').run(Number(id)).changes > 0;
}

export function adminRecent(db) {
  return {
    comments: db.prepare(
      `SELECT c.id, c.author, c.body, c.status, c.created_at, p.title AS post_title, p.slug AS post_slug
         FROM comments c JOIN posts p ON p.id = c.post_id
        ORDER BY c.created_at DESC LIMIT 6`
    ).all().map((row) => ({
      id: row.id,
      author: row.author,
      body: row.body,
      status: row.status,
      postTitle: row.post_title,
      postSlug: row.post_slug,
      createdAt: iso(row.created_at),
    })),
    messages: listMessages(db).slice(0, 5),
    missions: listMissionRequests(db).slice(0, 5),
  };
}
