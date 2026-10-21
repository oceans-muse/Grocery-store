import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(String(password), salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, salt, digest] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !digest) return false;
    const derived = await scrypt(String(password), salt, 64);
    const expected = Buffer.from(digest, 'hex');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, expires, Date.now());
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function getSessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.username, u.display_name, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  ).get(sha256(token), Date.now());
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function updatePassword(db, userId, password) {
  return hashPassword(password).then((hash) => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hash, Date.now(), userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  });
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

export function sessionCookie(token, maxAge, secure = false) {
  return `om_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = false) {
  return `om_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
