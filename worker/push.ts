import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sha256, deviceName } from './auth';
import { HttpError, type Env } from './types';
import { verificationFields } from './message-index';

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string; mode: 'verification' | 'inbox'; preview: number; created_at: number };
type Mail = { id: string; subject: string; sender_name: string; sender_address: string; body_text: string; body_html: string; category: string; category_source: string; received_at: number; is_read: number; deleted_at: number | null };
export function pushConfigured(env: Env) { return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY); }
function bytes(value: unknown, size: number) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new HttpError(400, '알림 연결 정보가 올바르지 않습니다.');
  let decoded: Uint8Array;
  try { decoded = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)); }
  catch { throw new HttpError(400, '알림 연결 정보가 올바르지 않습니다.'); }
  if (decoded.length !== size) throw new HttpError(400, '알림 연결 정보가 올바르지 않습니다.');
  return decoded;
}
export function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.pathname.length > 1
      && (host === 'fcm.googleapis.com' || host === 'web.push.apple.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}
function preferences(body: Record<string, unknown>) {
  if (!['verification', 'inbox'].includes(body.mode as string) || typeof body.preview !== 'boolean') throw new HttpError(400, '알림 설정을 확인해 주세요.');
  return { mode: body.mode as string, preview: Number(body.preview) };
}
export async function saveSubscription(env: Env, session: string, body: Record<string, unknown>, agent = '') {
  if (!pushConfigured(env)) throw new HttpError(503, '알림 연결을 준비하고 있습니다.');
  const sub = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  if (!sub || !validEndpoint(sub.endpoint) || !sub.keys) throw new HttpError(400, '지원하지 않는 알림 연결입니다.');
  const key = bytes(sub.keys.p256dh, 65); bytes(sub.keys.auth, 16);
  try { await crypto.subtle.importKey('raw', new Uint8Array(key).buffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []); }
  catch { throw new HttpError(400, '알림 암호화 키가 올바르지 않습니다.'); }
  const id = await sha256(sub.endpoint);
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE id != ?').bind(id).first<{ total: number }>();
  if ((count?.total || 0) >= 10) throw new HttpError(409, '알림은 최대 10개 기기에서 받을 수 있습니다.');
  const { mode, preview } = preferences(body);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, mode, preview, session_hash, created_at, updated_at, device_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth,
    mode=excluded.mode, preview=excluded.preview, session_hash=excluded.session_hash, updated_at=excluded.updated_at, device_name=excluded.device_name`)
    .bind(id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, mode, preview, session, now, now, deviceName(agent)).run();
  return { id };
}
export async function updateSubscription(env: Env, id: string, body: Record<string, unknown>) {
  const { mode, preview } = preferences(body);
  const result = await env.DB.prepare('UPDATE push_subscriptions SET mode=?, preview=?, updated_at=? WHERE id=?').bind(mode, preview, Date.now(), id).run();
  if (!result.meta.changes) throw new HttpError(404, '이 기기의 알림을 다시 연결해 주세요.');
}
export async function pushStatus(env: Env) {
  await cleanSubscriptions(env);
  const result = await env.DB.prepare('SELECT id,mode,preview,device_name,created_at,updated_at,last_success_at FROM push_subscriptions ORDER BY updated_at DESC').all();
  return { configured: pushConfigured(env), publicKey: env.VAPID_PUBLIC_KEY || '', devices: result.results };
}
export function notificationFor(mail: Mail, sub: Pick<Subscription, 'mode' | 'preview'>) {
  if (mail.deleted_at !== null || mail.is_read || mail.category === 'promotions') return null;
  const verification = Boolean(verificationFields(mail.subject, mail.body_text, mail.body_html).verified);
  if (sub.mode === 'verification' && !verification) return null;
  if (!verification && mail.category_source === 'pending') return null;
  return {
    title: sub.preview ? (mail.sender_name || mail.sender_address).slice(0, 80) : verification ? '인증 메일 도착' : '새 메일 도착',
    body: sub.preview ? mail.subject.slice(0, 150) : 'Mailroom에서 확인할 수 있습니다.',
    url: `/?message=${mail.id}`, tag: mail.id,
  };
}
async function send(env: Env, sub: Subscription, data: unknown) {
  if (!validEndpoint(sub.endpoint)) return 400;
  const payload = await buildPushPayload({ data: JSON.stringify(data), options: { ttl: 300 } },
    { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    { subject: env.PUBLIC_ORIGIN, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! });
  const response = await fetch(sub.endpoint, { ...payload, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(sub.id).run();
  if (response.ok) await env.DB.prepare('UPDATE push_subscriptions SET last_success_at=? WHERE id=?').bind(Date.now(), sub.id).run();
  return response.status;
}
export async function testNotification(env: Env, id: string) {
  if (!pushConfigured(env)) throw new HttpError(503, '알림 서버가 연결되지 않았습니다.');
  const sub = await env.DB.prepare('UPDATE push_subscriptions SET last_test_at=? WHERE id=? AND last_test_at < ? RETURNING *')
    .bind(Date.now(), id, Date.now() - 60_000).first<Subscription>();
  if (!sub) {
    const exists = await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE id=?').bind(id).first();
    throw new HttpError(exists ? 429 : 404, exists ? '1분 후 다시 확인해 주세요.' : '이 기기의 알림을 다시 연결해 주세요.');
  }
  let status = 0;
  try { status = await send(env, sub, { title: 'Mailroom', body: '이 기기의 알림이 연결되었습니다.', url: '/?settings=notifications', tag: 'bluekite-connection' }); }
  catch { throw new HttpError(503, '알림을 보내지 못했습니다. 다시 시도해 주세요.'); }
  if (status === 404 || status === 410) throw new HttpError(410, '알림 연결이 만료되었습니다. 다시 켜 주세요.');
  if (status < 200 || status >= 300) throw new HttpError(503, '알림을 보내지 못했습니다. 다시 시도해 주세요.');
}
export async function processNotifications(env: Env, messageId?: string) {
  if (!pushConfigured(env)) return;
  await cleanSubscriptions(env);
  const { results: subscriptions } = await env.DB.prepare('SELECT * FROM push_subscriptions').all<Subscription>();
  if (!subscriptions.length) return;
  const now = Date.now();
  const { results: messages } = await env.DB.prepare(`SELECT * FROM messages WHERE received_at >= ? AND deleted_at IS NULL AND is_read=0 AND category='inbox' ${messageId ? 'AND id=?' : ''} ORDER BY received_at DESC LIMIT 50`)
    .bind(...(messageId ? [now - 86_400_000, messageId] : [now - 86_400_000])).all<Mail>();
  const inserts = messages.flatMap(mail => subscriptions.filter(sub => sub.created_at <= mail.received_at && notificationFor(mail, sub)).map(sub =>
    env.DB.prepare('INSERT OR IGNORE INTO push_deliveries (message_id, subscription_id) VALUES (?, ?)').bind(mail.id, sub.id)));
  if (inserts.length) await env.DB.batch(inserts);
  const { results: pending } = await env.DB.prepare("SELECT message_id,subscription_id FROM push_deliveries WHERE state='pending' AND due_at<=? AND attempts<6 LIMIT 20").bind(now).all<{ message_id: string; subscription_id: string }>();
  await Promise.all(pending.map(async row => {
    const claim = await env.DB.prepare("UPDATE push_deliveries SET due_at=?, attempts=attempts+1 WHERE message_id=? AND subscription_id=? AND state='pending' AND due_at<=? RETURNING attempts")
      .bind(now + 120_000, row.message_id, row.subscription_id, now).first<{ attempts: number }>();
    if (!claim) return;
    const sub = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE id=?').bind(row.subscription_id).first<Subscription>();
    const mail = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(row.message_id).first<Mail>();
    const data = sub && mail && mail.received_at >= now - 86_400_000 ? notificationFor(mail, sub) : null;
    let state = 'skipped';
    if (sub && data) {
      try { const status = await send(env, sub, data); state = status >= 200 && status < 300 ? 'sent' : status === 404 || status === 410 ? 'skipped' : 'pending'; }
      catch { state = 'pending'; }
    }
    await env.DB.prepare('UPDATE push_deliveries SET state=?, due_at=? WHERE message_id=? AND subscription_id=? AND attempts=?')
      .bind(state, now + Math.min(3600000, 60_000 * 2 ** claim.attempts), row.message_id, row.subscription_id, claim.attempts).run();
  }));
  await env.DB.prepare('DELETE FROM push_deliveries WHERE message_id IN (SELECT id FROM messages WHERE received_at < ?)').bind(now - 86_400_000).run();
}

async function cleanSubscriptions(env: Env) {
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE token_hash=session_hash AND expires_at>? AND last_seen_at>?)').bind(Date.now(), Date.now() - 7 * 86_400_000).run();
}
