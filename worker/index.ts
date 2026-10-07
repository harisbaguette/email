import PostalMime from 'postal-mime';
import { assertSameOrigin, changePassword, getSession, jsonBody, login, sessionCookie } from './auth';
import { getInbox } from './inbox';
import { getRaw, MAX_EMAIL_BYTES, normalizeAddress, receiveMail } from './mail';
import { HttpError, type Env } from './types';
import { emailDocument, emailHeaders } from './html';

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
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }
  if (path === '/api/password' && method === 'POST') {
    const token = await changePassword(request, env);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, token) });
  }
  if (path === '/api/inbox' && method === 'GET') return json(await getInbox(url, env));
  if (path === '/api/addresses' && method === 'POST') {
    const { local } = await jsonBody(request);
    const address = typeof local === 'string' ? normalizeAddress(`${local}@${env.MAIL_DOMAIN}`, env.MAIL_DOMAIN) : null;
    if (!address) throw new HttpError(400, '영문, 숫자, 점(.), 밑줄(_), +, -로 1~64자를 입력해 주세요.');
    const result = await env.DB.prepare('INSERT OR IGNORE INTO addresses (address, created_at) VALUES (?, ?)').bind(address, Date.now()).run();
    return json({ address, created: result.meta.changes > 0 }, result.meta.changes > 0 ? 201 : 200);
  }
  if (path === '/api/settings' && method === 'GET') {
    const stats = await env.DB.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(stored_size), 0) AS bytes, MAX(received_at) AS lastReceived FROM messages').first();
    return json({ domain: env.MAIL_DOMAIN, maxEmailBytes: MAX_EMAIL_BYTES, ...stats });
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
      const { fingerprint: _fingerprint, stored_size: _storedSize, ...message } = row;
      return json({ ...message, attachments: JSON.parse(row.attachments as string) });
    }
    if (!action && method === 'PATCH') {
      const body = await jsonBody(request);
      if (body.action === 'read' || body.action === 'unread') {
        await env.DB.prepare('UPDATE messages SET is_read = ? WHERE id = ?').bind(Number(body.action === 'read'), id).run();
      } else if (body.action === 'trash' || body.action === 'restore') {
        await env.DB.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').bind(body.action === 'trash' ? Date.now() : null, id).run();
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
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return secured(await api(request, env)); }
    catch (error) {
      if (error instanceof HttpError) return secured(json({ error: error.message }, error.status,
        error.status === 429 ? { 'Retry-After': '900' } : undefined));
      console.error(JSON.stringify({ event: 'api_error', error: error instanceof Error ? error.name : 'Error' }));
      return secured(json({ error: '잠시 연결이 원활하지 않습니다. 다시 시도해 주세요.' }, 500));
    }
  },
  email: receiveMail,
} satisfies ExportedHandler<Env>;
