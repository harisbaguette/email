import PostalMime from 'postal-mime';
import { assertSameOrigin, changePassword, getSession, jsonBody, login, sessionCookie } from './auth';
import { getInbox } from './inbox';
import { getRaw, MAX_EMAIL_BYTES, normalizeAddress, receiveMail } from './mail';
import { HttpError, type Env } from './types';
import { emailDocument, emailHeaders } from './html';
import { sortMessage, sortPending, sortingStatus } from './sorting';
import { verificationCode } from '../shared/verification';
import { verificationLink } from './verification';
import { processNotifications, pushStatus, saveSubscription, testNotification, updateSubscription } from './push';

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function secured(response: Response): Response {
  const result = new Response(response.body, response);
  // Keep Cloudflare's email obfuscation and injected scripts out of private mail documents.
  result.headers.set('Cache-Control', 'no-store, no-transform');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'no-referrer');
  if (!result.headers.has('X-Frame-Options')) result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('X-Robots-Tag', 'noindex, nofollow');
  result.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return result;
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(request, env);
  if (path === '/api/health' && method === 'GET') {
    await env.DB.prepare('SELECT 1 FROM settings LIMIT 1').all();
    return json({ ok: true });
  }
  if (path === '/api/login' && method === 'POST') {
    const token = await login(request, env);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, token) });
  }
  const session = await getSession(request, env);
  if (path === '/api/session' && method === 'GET') return json({ authenticated: Boolean(session), domain: env.MAIL_DOMAIN });
  if (!session) throw new HttpError(401, '다시 로그인해 주세요.');
  if (path === '/api/logout' && method === 'POST') {
    const body = request.body ? await jsonBody(request) : {};
    const pushId = typeof body.pushId === 'string' && /^[a-f0-9]{64}$/.test(body.pushId) ? body.pushId : '';
    await env.DB.batch([
      env.DB.prepare('DELETE FROM push_subscriptions WHERE session_hash = ? OR id = ?').bind(session, pushId),
      env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session),
    ]);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }
  if (path === '/api/password' && method === 'POST') {
    const token = await changePassword(request, env);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, token) });
  }
  if (path === '/api/inbox' && method === 'GET') return json(await getInbox(url, env));
  if (path === '/api/push' && method === 'GET') return json(await pushStatus(env));
  if (path === '/api/push' && method === 'POST') return json(await saveSubscription(env, session, await jsonBody(request)));
  const pushMatch = path.match(/^\/api\/push\/([a-f0-9]{64})(\/test)?$/);
  if (pushMatch) {
    if (pushMatch[2] && method === 'POST') { await testNotification(env, pushMatch[1]); return json({ ok: true }); }
    if (!pushMatch[2] && method === 'PATCH') { await updateSubscription(env, pushMatch[1], await jsonBody(request)); return json({ ok: true }); }
    if (!pushMatch[2] && method === 'DELETE') { await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(pushMatch[1]).run(); return json({ ok: true }); }
  }
  if (path === '/api/addresses' && method === 'POST') {
    const { local } = await jsonBody(request);
    const address = typeof local === 'string' ? normalizeAddress(`${local}@${env.MAIL_DOMAIN}`, env.MAIL_DOMAIN) : null;
    if (!address) throw new HttpError(400, '영문, 숫자, 점(.), 밑줄(_), +, -로 1~64자를 입력해 주세요.');
    const result = await env.DB.prepare('INSERT OR IGNORE INTO addresses (address, created_at) VALUES (?, ?)').bind(address, Date.now()).run();
    return json({ address, created: result.meta.changes > 0 }, result.meta.changes > 0 ? 201 : 200);
  }
  if (path === '/api/settings' && method === 'GET') {
    const stats = await env.DB.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(stored_size), 0) AS bytes, MAX(received_at) AS lastReceived FROM messages').first();
    const owner = await env.DB.prepare("SELECT value FROM settings WHERE key='login_username'").first<{ value: string }>();
    return json({ username: owner?.value || 'owner', domain: env.MAIL_DOMAIN, maxEmailBytes: MAX_EMAIL_BYTES, ...stats, sorting: await sortingStatus(env) });
  }
  const match = path.match(/^\/api\/messages\/([a-f0-9-]{36})(?:\/(raw|body|attachments\/\d+))?$/);
  if (match) {
    const [, id, action] = match;
    const row = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
    if (!row) throw new HttpError(404, '메일을 찾을 수 없습니다.');
    if (action === 'body' && method === 'GET') {
      const images = url.searchParams.get('images') === '1';
      return new Response(emailDocument(row.body_html as string, images), { headers: emailHeaders(images) });
    }
    if (action && method === 'GET') {
      const raw = await getRaw(env, id);
      if (!raw) throw new HttpError(404, '원본 파일을 찾을 수 없습니다.');
      if (action === 'raw') return new Response(raw, {
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${id}.eml"` },
      });
      const index = Number(action.split('/')[1]);
      const parsed = await PostalMime.parse(raw);
      const attachment = parsed.attachments[index];
      if (!attachment) throw new HttpError(404, '첨부 파일을 찾을 수 없습니다.');
      const name = (attachment.filename || 'attachment').replace(/[\r\n\x00-\x1f]/g, '').slice(0, 255);
      const content = typeof attachment.content === 'string' ? new TextEncoder().encode(attachment.content).buffer
        : attachment.content instanceof ArrayBuffer ? attachment.content : new Uint8Array(attachment.content).buffer;
      return new Response(content, {
        headers: { 'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}` },
      });
    }
    if (!action && method === 'GET') {
      const { fingerprint: _fingerprint, stored_size: _storedSize, sort_token: _sortToken, sort_scores: _sortScores, ...message } = row;
      return json({ ...message, attachments: JSON.parse(row.attachments as string),
        verification_code: verificationCode(row.subject as string, row.body_text as string),
        verification_link: verificationLink(row.subject as string, row.body_text as string, row.body_html as string) });
    }
    if (!action && method === 'PATCH') {
      const body = await jsonBody(request);
      if (body.action === 'read' || body.action === 'unread') {
        await env.DB.prepare('UPDATE messages SET is_read = ? WHERE id = ?').bind(Number(body.action === 'read'), id).run();
      } else if (body.action === 'trash' || body.action === 'restore') {
        await env.DB.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').bind(body.action === 'trash' ? Date.now() : null, id).run();
      } else if (body.action === 'inbox' || body.action === 'promotions') {
        await env.DB.prepare(`UPDATE messages SET category = ?, category_source = 'manual', sorted_at = ?, sort_token = NULL WHERE id = ?`)
          .bind(body.action, Date.now(), id).run();
      } else throw new HttpError(400, '지원하지 않는 작업입니다.');
      return json({ ok: true });
    }
    if (!action && method === 'DELETE') {
      if (row.deleted_at === null) throw new HttpError(409, '먼저 휴지통으로 이동해 주세요.');
      await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, '요청한 항목을 찾을 수 없습니다.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      return Response.redirect(env.PUBLIC_ORIGIN + url.pathname + url.search, 308);
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return secured(await api(request, env)); }
    catch (error) {
      if (error instanceof HttpError) return secured(json({ error: error.message }, error.status,
        error.status === 429 ? { 'Retry-After': new URL(request.url).pathname.startsWith('/api/push/') ? '60' : '900' } : undefined));
      console.error(JSON.stringify({ event: 'api_error', error: error instanceof Error ? error.name : 'Error' }));
      return secured(json({ error: '잠시 연결이 원활하지 않습니다. 다시 시도해 주세요.' }, 500));
    }
  },
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const id = await receiveMail(message, env);
    // SMTP delivery succeeds once safely stored. Classification failures never lose mail.
    if (id) ctx.waitUntil((async () => {
      try { await sortMessage(env, id); } catch { console.warn(JSON.stringify({ event: 'mail_sorting_deferred', reason: 'storage_unavailable' })); }
      await processNotifications(env, id);
    })().catch(() => console.warn(JSON.stringify({ event: 'notification_deferred' }))));
  },
  async scheduled(_event: ScheduledController, env: Env) { await sortPending(env); await processNotifications(env); },
} satisfies ExportedHandler<Env>;
