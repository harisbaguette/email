import { timingSafeEqual } from 'node:crypto';
import { STORAGE_BYTES, STORAGE_MESSAGES } from './abuse';
import type { Env } from './types';

export type SecurityEvent = 'login_failed' | 'login_succeeded' | 'password_changed' | 'mfa_changed'
  | 'session_revoked' | 'mail_limited' | 'storage_full' | 'api_error' | 'mail_error' | 'cron_error';

export async function recordEvent(env: Env, kind: SecurityEvent, requestId = crypto.randomUUID()) {
  const now = Date.now();
  // A closed event vocabulary and one row per ten minutes bound storage under attack.
  // No IP, email address, URL, token, user agent, request body or exception text is kept.
  const entry = { timestamp: new Date(now).toISOString(), level: kind.endsWith('error') ? 'error' : 'info', event: kind, requestId };
  console.log(JSON.stringify(entry));
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO security_events (kind,window_start,request_id) VALUES (?,?,?)')
      .bind(kind, Math.floor(now / 600_000) * 600_000, requestId).run();
  } catch { console.error(JSON.stringify({ timestamp: entry.timestamp, level: 'error', event: 'audit_storage_unavailable', requestId })); }
}

export function monitorAuthorized(request: Request, env: Env) {
  if (!env.MONITOR_TOKEN || env.MONITOR_TOKEN.length < 32) return false;
  const actual = new TextEncoder().encode(request.headers.get('Authorization') || '');
  const expected = new TextEncoder().encode(`Bearer ${env.MONITOR_TOKEN}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function operationStatus(env: Env, now = Date.now()) {
  const result = await env.DB.batch([
    env.DB.prepare("SELECT value FROM monitor_state WHERE key='cron_success'"),
    env.DB.prepare('SELECT kind,MAX(window_start) AS at FROM security_events WHERE window_start>=? GROUP BY kind').bind(now - 30 * 60_000),
    env.DB.prepare('SELECT messages,bytes FROM mail_storage WHERE id=1'),
    env.DB.prepare("SELECT attempts FROM login_attempts WHERE ip_hash='account' AND window_start>=?").bind(now - 900_000),
  ]);
  const cron = (result[0].results[0] as { value: number } | undefined)?.value;
  const events = result[1].results as { kind: SecurityEvent; at: number }[];
  const usage = result[2].results[0] as { messages: number; bytes: number } | undefined;
  const issues: string[] = [];
  if (!cron || now - cron > 20 * 60_000) issues.push('scheduled_jobs_stale');
  if ((usage?.bytes || 0) >= STORAGE_BYTES * 0.9 || (usage?.messages || 0) >= STORAGE_MESSAGES * 0.9) issues.push('storage_near_limit');
  if (Number((result[3].results[0] as { attempts: number } | undefined)?.attempts || 0) >= 20) issues.push('login_attack');
  for (const event of events) if (['api_error', 'mail_error', 'cron_error', 'storage_full', 'mail_limited'].includes(event.kind)) issues.push(event.kind);
  return { ok: issues.length === 0, checkedAt: now, cronLastSuccess: cron || null, issues, events };
}

export async function finishScheduled(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM security_events WHERE window_start<?').bind(now - 30 * 86_400_000),
    env.DB.prepare("INSERT INTO monitor_state VALUES ('cron_success',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(now),
  ]);
}
