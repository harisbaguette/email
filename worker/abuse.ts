import { HttpError, type Env } from './types';

export const STORAGE_BYTES = 256 * 1024 * 1024;
export const STORAGE_MESSAGES = 20_000;
export const DAILY_MAIL_BYTES = 100 * 1024 * 1024;
export const DAILY_MAIL_COUNT = 1000;

export async function guardApi(request: Request, env: Env) {
  if (request.url.length > 8192 || (request.headers.get('Cookie')?.length || 0) > 8192) {
    throw new HttpError(413, '요청 내용이 너무 깁니다.');
  }
  // Reject browser cross-site probes before even looking up a session in D1.
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, '허용되지 않은 요청입니다.');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!(await env.API_LIMITER.limit({ key: ip })).success) {
    throw new HttpError(429, '요청이 많습니다. 1분 뒤 다시 시도해 주세요.', 60);
  }
}

export async function guardDownload(env: Env, session: string) {
  if (!(await env.DOWNLOAD_LIMITER.limit({ key: session })).success) {
    throw new HttpError(429, '파일 요청이 많습니다. 1분 뒤 다시 시도해 주세요.', 60);
  }
}

// Each compare-and-set is serialized by D1, so limits hold across regions and isolates.
// Charge delivery attempts, including duplicates and parse failures, to bound the work itself.
export async function reserveDelivery(env: Env, recipient: string, bytes: number, now = Date.now()) {
  const limits = [
    { key: `recipient:${recipient}:minute`, period: 60_000, count: 20, bytes: 20 * 1024 * 1024 },
    { key: `recipient:${recipient}:hour`, period: 3_600_000, count: 120, bytes: 50 * 1024 * 1024 },
    { key: 'global:minute', period: 60_000, count: 60, bytes: 30 * 1024 * 1024 },
    { key: 'global:hour', period: 3_600_000, count: 300, bytes: 75 * 1024 * 1024 },
    { key: 'global:day', period: 86_400_000, count: DAILY_MAIL_COUNT, bytes: DAILY_MAIL_BYTES },
  ];
  for (const limit of limits) {
    const cutoff = now - limit.period;
    const row = await env.DB.prepare(`INSERT INTO mail_limits (key,window_start,messages,bytes) VALUES (?,?,1,?)
      ON CONFLICT(key) DO UPDATE SET
        messages=CASE WHEN window_start<=? THEN 1 ELSE messages+1 END,
        bytes=CASE WHEN window_start<=? THEN excluded.bytes ELSE bytes+excluded.bytes END,
        window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END
      WHERE window_start<=? OR (messages<? AND bytes+excluded.bytes<=?) RETURNING key`)
      .bind(limit.key, now, bytes, cutoff, cutoff, cutoff, cutoff, limit.count, limit.bytes).first();
    if (!row) return false;
  }
  return true;
}

export async function storageFull(env: Env) {
  return Boolean(await env.DB.prepare('SELECT 1 FROM mail_storage WHERE id=1 AND (messages>=? OR bytes>=?)')
    .bind(STORAGE_MESSAGES, STORAGE_BYTES).first());
}

export async function receptionStatus(env: Env) {
  const usage = await env.DB.prepare('SELECT messages,bytes FROM mail_storage WHERE id=1').first<{ messages: number; bytes: number }>();
  const day = await env.DB.prepare("SELECT messages,bytes FROM mail_limits WHERE key='global:day' AND window_start>?")
    .bind(Date.now() - 86_400_000).first<{ messages: number; bytes: number }>();
  return { registeredOnly: true, storageLimit: STORAGE_BYTES, messageLimit: STORAGE_MESSAGES,
    storageFull: (usage?.bytes || 0) >= STORAGE_BYTES || (usage?.messages || 0) >= STORAGE_MESSAGES,
    dailyLimit: DAILY_MAIL_COUNT, dailyBytesLimit: DAILY_MAIL_BYTES, dailyReceived: day?.messages || 0, dailyBytes: day?.bytes || 0 };
}

export async function cleanSecurityState(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mail_limits WHERE window_start<?').bind(now - 86_400_000),
    env.DB.prepare('DELETE FROM login_attempts WHERE window_start<?').bind(now - 86_400_000),
    env.DB.prepare('DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM two_factor_setups WHERE expires_at<=?').bind(now),
  ]);
}
