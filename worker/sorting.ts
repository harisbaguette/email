import type { Env } from './types';
import { verificationFields, indexLegacyMessages } from './message-index';
import { sortingDecision, sortingRequest } from './sorting-policy';

const DAILY_LIMIT = 500;
const MINUTE = 60_000;
type PendingMail = { subject: string; body_text: string; body_html: string; sort_attempts: number };

async function setting(env: Env, key: string, value: string) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

export async function sortMessage(env: Env, id: string) {
  if (!env.TYPESAFE_API_KEY) return;
  const now = Date.now();
  const pause = await env.DB.prepare("SELECT value FROM settings WHERE key = 'sort_pause_until'").first<{ value: string }>();
  if (Number(pause?.value || 0) > now) return;
  const token = crypto.randomUUID();
  // D1 compare-and-set: concurrent deliveries/cron runs cannot classify the same mail twice.
  const mail = await env.DB.prepare(`UPDATE messages SET sort_token = ?, sort_due_at = ?
    WHERE id = ? AND category_source = 'pending' AND deleted_at IS NULL AND sort_due_at <= ?
    RETURNING subject, body_text, body_html, sort_attempts`).bind(token, now + 2 * MINUTE, id, now).first<PendingMail>();
  if (!mail) return;
  try {
    // Authentication codes and links stay local and remain in the inbox.
    if (verificationFields(mail.subject, mail.body_text, mail.body_html).verified) {
      await env.DB.prepare(`UPDATE messages SET category = 'inbox', category_source = 'protected', sorted_at = ?, sort_token = NULL
        WHERE id = ? AND sort_token = ? AND category_source = 'pending'`).bind(now, id, token).run();
      return;
    }
    const day = new Date(now).toISOString().slice(0, 10);
    const budget = await env.DB.prepare(`INSERT INTO sorting_usage (day, requests) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET requests = requests + 1 WHERE requests < ? RETURNING requests`).bind(day, DAILY_LIMIT).first();
    if (!budget) {
      await env.DB.prepare('UPDATE messages SET sort_due_at = ?, sort_token = NULL WHERE id = ? AND sort_token = ?')
        .bind(Date.parse(day) + 86_400_000, id, token).run();
      return;
    }
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      // Workers supports manual/follow only. Never follow redirects with the API credential.
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sortingRequest(mail.subject, mail.body_text)),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`sorting_http_${response.status}`);
    }
    const decision = sortingDecision(await response.json());
    await env.DB.prepare(`UPDATE messages SET category = ?, category_source = 'automatic', sorted_at = ?,
      sort_scores = ?, sort_token = NULL WHERE id = ? AND sort_token = ? AND category_source = 'pending'`)
      .bind(decision.category, Date.now(), JSON.stringify(decision), id, token).run();
    await setting(env, 'sort_last_success', String(Date.now()));
    await env.DB.prepare("DELETE FROM settings WHERE key = 'sort_last_error'").run();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = /^sorting_http_\d{3}$/.test(message) || message === 'invalid_sorting_response' ? message : 'sorting_unavailable';
    const delay = Math.min(6 * 60 * MINUTE, 5 * MINUTE * 2 ** Math.min(mail.sort_attempts, 7));
    await env.DB.prepare(`UPDATE messages SET sort_attempts = sort_attempts + 1, sort_due_at = ?, sort_token = NULL
      WHERE id = ? AND sort_token = ? AND category_source = 'pending'`).bind(Date.now() + delay, id, token).run();
    // A shared circuit breaker avoids hammering an unavailable or exhausted API account.
    await setting(env, 'sort_pause_until', String(Date.now() + (/_(401|402|403)$/.test(reason) ? 6 * 60 * MINUTE : 5 * MINUTE)));
    const errorType = error instanceof Error ? error.name.slice(0, 60) : 'Error';
    const detail = errorType === 'TypeError' ? message.replaceAll(env.TYPESAFE_API_KEY, '[secret]').slice(0, 240) : undefined;
    await setting(env, 'sort_last_error', JSON.stringify({ reason, errorType, detail, at: Date.now() }));
    console.warn(JSON.stringify({ event: 'mail_sorting_deferred', reason, errorType }));
  }
}

export async function sortPending(env: Env) {
  await indexLegacyMessages(env);
  await setting(env, 'sort_last_run', String(Date.now()));
  const { results } = await env.DB.prepare(`SELECT id FROM messages WHERE category_source = 'pending'
    AND deleted_at IS NULL AND sort_due_at <= ? ORDER BY received_at ASC LIMIT 50`).bind(Date.now()).all<{ id: string }>();
  for (const row of results) await sortMessage(env, row.id);
  await env.DB.prepare('DELETE FROM sorting_usage WHERE day < ?').bind(new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)).run();
}

export async function sortingStatus(env: Env) {
  const counts = await env.DB.prepare(`SELECT COUNT(*) AS pending, COALESCE(SUM(sort_attempts > 0 OR (sort_due_at > ? AND sort_token IS NULL)), 0) AS delayed
    FROM messages WHERE category_source = 'pending' AND deleted_at IS NULL`).bind(Date.now()).first<{ pending: number; delayed: number }>();
  return { enabled: Boolean(env.TYPESAFE_API_KEY), pending: counts?.pending || 0, delayed: counts?.delayed || 0 };
}
