import bcrypt from 'bcryptjs';
import { HttpError, type Env } from './types';

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function cookieName(request: Request) {
  return new URL(request.url).protocol === 'https:' ? '__Host-bluekite_session' : 'bluekite_session';
}

export function sessionCookie(request: Request, token: string, seconds = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`;
}

export async function getSession(request: Request, env: Env): Promise<string | null> {
  const name = cookieName(request);
  const token = request.headers.get('Cookie')?.split(';').map(s => s.trim())
    .find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const digest = await sha256(token);
  const row = await env.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(digest, Date.now()).first();
  return row ? digest : null;
}

export async function createSession(env: Env) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), Date.now() + SESSION_SECONDS * 1000, Date.now()).run();
  return token;
}

export function assertSameOrigin(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  const allowed = local
    ? [url.origin, 'http://localhost:8787', 'http://127.0.0.1:8787', 'http://localhost:5173', 'http://127.0.0.1:5173']
    : [env.PUBLIC_ORIGIN];
  if (!origin || !allowed.includes(origin) || request.headers.get('X-Bluekite-Request') !== '1') {
    throw new HttpError(403, '페이지를 새로고침한 뒤 다시 시도해 주세요.');
  }
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
    throw new HttpError(415, '지원하지 않는 요청 형식입니다.');
  }
  if (Number(request.headers.get('Content-Length')) > 4096) throw new HttpError(413, '입력 내용이 너무 깁니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '입력 내용을 확인해 주세요.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); throw new HttpError(413, '입력 내용이 너무 깁니다.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new HttpError(400, '입력 내용을 확인해 주세요.'); }
}

export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 8 || encoder.encode(password).length > 72) {
    throw new HttpError(400, '비밀번호는 8자 이상, 영문 기준 72자 이내로 입력해 주세요.');
  }
}

export async function limitLogin(request: Request, env: Env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (env.LOGIN_LIMITER && !(await env.LOGIN_LIMITER.limit({ key: ip })).success) {
    throw new HttpError(429, '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  const now = Date.now();
  const key = await sha256(ip);
  // Persist the attempt window across isolates; the edge limiter alone is per location.
  const attempt = await env.DB.prepare(`
    INSERT INTO login_attempts (ip_hash, attempts, window_start) VALUES (?, 1, ?)
    ON CONFLICT(ip_hash) DO UPDATE SET
      attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END
    RETURNING attempts
  `).bind(key, now, now - 900_000, now - 900_000).first<{ attempts: number }>();
  if (!attempt || attempt.attempts > 10) throw new HttpError(429, '15분 뒤에 다시 로그인해 주세요.');
  return key;
}

export async function login(request: Request, env: Env) {
  const key = await limitLogin(request, env);
  const { username, password } = await jsonBody(request);
  if (typeof username !== 'string' || username.length < 1 || username.length > 64) throw new HttpError(400, '아이디를 입력해 주세요.');
  if (typeof password !== 'string' || password.length > 128) throw new HttpError(400, '비밀번호를 입력해 주세요.');
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'password_hash'").first<{ value: string }>();
  if (!row) throw new HttpError(503, '수신함의 첫 비밀번호가 아직 설정되지 않았습니다.');
  const owner = await env.DB.prepare("SELECT value FROM settings WHERE key = 'login_username'").first<{ value: string }>();
  const passwordMatches = await bcrypt.compare(password, row.value);
  if (!passwordMatches || username.trim() !== (owner?.value || 'owner')) throw new HttpError(401, '아이디 또는 비밀번호가 맞지 않습니다.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash = ? OR window_start < ?').bind(key, Date.now() - 86_400_000),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
  ]);
  return createSession(env);
}

export async function changePassword(request: Request, env: Env) {
  await limitLogin(request, env);
  const { currentPassword, newPassword } = await jsonBody(request);
  validatePassword(newPassword);
  if (typeof currentPassword !== 'string' || currentPassword.length > 128) throw new HttpError(400, '현재 비밀번호를 입력해 주세요.');
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'password_hash'").first<{ value: string }>();
  if (!row || !(await bcrypt.compare(currentPassword, row.value))) throw new HttpError(400, '현재 비밀번호가 맞지 않습니다.');
  const hash = await bcrypt.hash(newPassword, 12);
  await env.DB.batch([
    env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'password_hash'").bind(hash),
    env.DB.prepare('DELETE FROM sessions'),
  ]);
  return createSession(env);
}
