import bcrypt from 'bcryptjs';
import { sha256, bumpAuthRevision } from './auth';
import { HttpError, type Env } from './types';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes: Uint8Array) {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function unbase32(secret: string) {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of secret) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); } }
  return new Uint8Array(bytes);
}
export async function totp(secret: string, counter: number, digits = 6) {
  const message = new Uint8Array(8); new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', unbase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = digest[19] & 15;
  const value = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  return (value % 10 ** digits).toString().padStart(digits, '0');
}
async function encryptionKey(env: Env) {
  if (!env.MFA_ENCRYPTION_KEY) throw new HttpError(503, '2단계 인증을 준비하고 있습니다.');
  return crypto.subtle.importKey('raw', Uint8Array.from(atob(env.MFA_ENCRYPTION_KEY), char => char.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env: Env, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('bluekite-totp-v1') }, await encryptionKey(env), new TextEncoder().encode(secret));
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)));
}
async function open(env: Env, data: string) {
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode('bluekite-totp-v1') }, await encryptionKey(env), bytes.slice(12)));
}
async function matchingCounter(secret: string, code: unknown) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(Date.now() / 30000);
  for (const offset of [0, -1, 1]) if (await totp(secret, current + offset) === code) return current + offset;
  return null;
}
export async function twoFactorStatus(env: Env) {
  return { enabled: Boolean(await env.DB.prepare('SELECT 1 FROM two_factor').first()), configured: Boolean(env.MFA_ENCRYPTION_KEY), recoveryRemaining: (await env.DB.prepare('SELECT COUNT(*) AS n FROM recovery_codes').first<{ n: number }>())?.n || 0 };
}
export async function verifyTwoFactor(env: Env, code: unknown) {
  const row = await env.DB.prepare('SELECT secret,last_counter FROM two_factor WHERE id=1').first<{ secret: string; last_counter: number }>();
  if (!row) return;
  if (!code) throw new HttpError(428, '인증 앱 코드 또는 복구 코드를 입력해 주세요.');
  if (typeof code === 'string' && /^(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{4}$/.test(code)) {
    const result = await env.DB.prepare('DELETE FROM recovery_codes WHERE code_hash=? RETURNING code_hash').bind(await sha256(code.toLowerCase())).first();
    if (result) return;
  } else {
    const counter = await matchingCounter(await open(env, row.secret), code);
    if (counter !== null) {
      const result = await env.DB.prepare('UPDATE two_factor SET last_counter=? WHERE id=1 AND secret=? AND last_counter<? RETURNING id').bind(counter, row.secret, counter).first();
      if (result) return;
    }
  }
  throw new HttpError(400, '코드가 맞지 않거나 이미 사용됐습니다. 다음 코드로 다시 시도해 주세요.');
}
export async function verifyCurrentPassword(env: Env, password: unknown) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='password_hash'").first<{ value: string }>();
  if (typeof password !== 'string' || new TextEncoder().encode(password).length > 72 || !row || !await bcrypt.compare(password, row.value)) throw new HttpError(400, '현재 비밀번호가 맞지 않습니다.');
}
export async function startTwoFactor(env: Env, session: string, password: unknown) {
  await verifyCurrentPassword(env, password);
  if ((await twoFactorStatus(env)).enabled) throw new HttpError(409, '이미 2단계 인증이 켜져 있습니다.');
  const secret = base32(crypto.getRandomValues(new Uint8Array(20)));
  const codes = Array.from({ length: 8 }, () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('').match(/.{4}/g)!.join('-'));
  const hashes = await Promise.all(codes.map(sha256));

  const owner = await env.DB.prepare("SELECT value FROM settings WHERE key='login_username'").first<{ value: string }>();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM two_factor_setups WHERE expires_at<?').bind(Date.now()),
    env.DB.prepare('INSERT INTO two_factor_setups (session_hash,secret,expires_at,recovery_hashes) VALUES (?,?,?,?) ON CONFLICT(session_hash) DO UPDATE SET secret=excluded.secret,expires_at=excluded.expires_at,recovery_hashes=excluded.recovery_hashes').bind(session, await seal(env, secret), Date.now() + 600000, JSON.stringify(hashes)),
  ]);
  return { secret, recoveryCodes: codes, uri: `otpauth://totp/${encodeURIComponent('Bluekite:' + (owner?.value || 'owner'))}?secret=${secret}&issuer=Bluekite&algorithm=SHA1&digits=6&period=30` };
}
export async function confirmTwoFactor(env: Env, session: string, code: unknown) {
  const setup = await env.DB.prepare('SELECT secret,recovery_hashes FROM two_factor_setups WHERE session_hash=? AND expires_at>?').bind(session, Date.now()).first<{ secret: string; recovery_hashes: string }>();
  if (!setup) throw new HttpError(410, '등록 시간이 지났습니다. 처음부터 다시 연결해 주세요.');
  if ((await twoFactorStatus(env)).enabled) throw new HttpError(409, '이미 2단계 인증이 켜져 있습니다.');
  const counter = await matchingCounter(await open(env, setup.secret), code);
  if (counter === null) throw new HttpError(400, '인증 앱의 6자리 코드를 확인해 주세요.');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO two_factor (id,secret,last_counter) VALUES (1,?,?)').bind(setup.secret, counter),
    env.DB.prepare('DELETE FROM recovery_codes'),
    ...(JSON.parse(setup.recovery_hashes) as string[]).map(hash => env.DB.prepare('INSERT INTO recovery_codes (code_hash) VALUES (?)').bind(hash)),
    env.DB.prepare('DELETE FROM two_factor_setups'),
    bumpAuthRevision(env),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM push_subscriptions'),
  ]);
  return { enabled: true };
}
export async function disableTwoFactor(env: Env, password: unknown, code: unknown) {
  await verifyCurrentPassword(env, password); await verifyTwoFactor(env, code);
  await env.DB.batch([bumpAuthRevision(env), ...['DELETE FROM two_factor', 'DELETE FROM two_factor_setups', 'DELETE FROM recovery_codes', 'DELETE FROM sessions', 'DELETE FROM push_subscriptions'].map(sql => env.DB.prepare(sql))]);
}
