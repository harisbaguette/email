/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, applyD1Migrations } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import worker from '../worker/index';
import { receiveMail, getRaw, MAX_EMAIL_BYTES } from '../worker/mail';
import { sha256 } from '../worker/auth';
import type { Env } from '../worker/types';
import { verificationCode } from '../shared/verification';
import { sortMessage, sortPending } from '../worker/sorting';
import { sortingDecision, sortingRequest } from '../worker/sorting-policy';
import { verificationLink } from '../worker/verification';

const bindings = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
const testEnv = { ...bindings, LOGIN_LIMITER: { limit: async () => ({ success: true }) }, API_LIMITER: { limit: async () => ({ success: true }) }, DOWNLOAD_LIMITER: { limit: async () => ({ success: true }) } } as Env;
const origin = 'https://email.bluekite.co.kr';
const password = 'local-test-only-password';
let cookie = '';

async function request(path: string, method = 'GET', body?: unknown, auth = true, extra: Record<string, string> = {}) {
  return worker.fetch(new Request(origin + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Bluekite-Request': '1', Origin: origin,
      'CF-Connecting-IP': '192.0.2.1', ...(auth ? { Cookie: cookie } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(path === '/api/login' ? { username: 'owner', ...(body as object) } : body),
  }), testEnv);
}

function incoming(raw: string | Uint8Array, to = 'pixiv@bluekite.co.kr') {
  const rawBytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
  return {
    from: 'sender@example.net', to, headers: new Headers(), rawSize: rawBytes.length,
    raw: new Blob([new Uint8Array(rawBytes).buffer]).stream(), setReject: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

const simpleRaw = 'From: Example <sender@example.net>\r\nTo: pixiv@bluekite.co.kr\r\nSubject: Your verification code\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n인증번호 482913\r\n';

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await bindings.DB.batch(['DELETE FROM push_deliveries', 'DELETE FROM push_subscriptions', 'DELETE FROM raw_chunks', 'DELETE FROM messages', 'DELETE FROM addresses', 'DELETE FROM settings', 'DELETE FROM sessions', 'DELETE FROM login_attempts', 'DELETE FROM sorting_usage', 'DELETE FROM mail_limits'].map(sql => bindings.DB.prepare(sql)));
  await bindings.DB.prepare("INSERT INTO settings (key, value) VALUES ('password_hash', ?)").bind(await bcrypt.hash(password, 4)).run();
  await bindings.DB.prepare("INSERT INTO addresses (address,created_at,managed) VALUES ('pixiv@bluekite.co.kr',0,1),('shop@bluekite.co.kr',0,1)").run();
  const response = await request('/api/login', 'POST', { password }, false);
  expect(response.status).toBe(200);
  cookie = response.headers.get('Set-Cookie')!.split(';')[0];
});

afterEach(() => vi.unstubAllGlobals());

describe('automatic sorting without mail loss', () => {
  const sortingEnv = { ...testEnv, TYPESAFE_API_KEY: 'test-only-not-a-real-key' };
  const answer = (promotional = 0.97, important = 0.02) => ({ model: 'jev-1.13.0', answers: {
    promotional: { type: 'noul', noul: promotional }, important: { type: 'noul', noul: important },
  } });
  const advert = 'From: Shop <shop@example.net>\r\nSubject: Special sale\r\nContent-Type: text/plain\r\n\r\nGet 50% off everything today. Shop now!';
  const list = async (folder = 'inbox') => await (await request(`/api/inbox?folder=${folder}`)).json() as any;

  it('separates advertising across addresses while retaining the original and all-mail view', async () => {
    const fetcher = vi.fn(async () => Response.json(answer())); vi.stubGlobal('fetch', fetcher);
    const id = (await receiveMail(incoming(advert, 'shop@bluekite.co.kr'), testEnv))!;
    await receiveMail(incoming(simpleRaw), testEnv);
    await sortPending(sortingEnv);
    expect(fetcher).toHaveBeenCalledTimes(1); // numeric auth code never leaves Cloudflare
    expect((await list()).messages.map((m: any) => m.recipient)).toEqual(['pixiv@bluekite.co.kr']);
    expect((await list('promotions')).messages.map((m: any) => m.id)).toEqual([id]);
    expect((await list('all')).messages).toHaveLength(2);
    expect((await list()).counts).toMatchObject({ inbox: 1, promotions: 1, all: 2, unread: 1 });
    expect(new TextDecoder().decode((await getRaw(testEnv, id))!)).toBe(advert);
    expect((await list()).sorting.pending).toBe(0);
    await request(`/api/messages/${id}`, 'PATCH', { action: 'inbox' });
    await sortPending(sortingEnv);
    expect((await list('promotions')).messages).toHaveLength(0);
    expect((await list()).messages).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps ambiguous and transactional emails even when promotional probability is high', () => {
    expect(sortingDecision(answer(0.84, 0.01)).category).toBe('inbox');
    expect(sortingDecision(answer(0.99, 0.2)).category).toBe('inbox');
    expect(sortingDecision(answer(0.91, 0.04)).category).toBe('promotions');
    for (const bad of [null, {}, answer(NaN), answer(1.1), { answers: { promotional: { type: 'noul', noul: 1 } } }]) {
      expect(() => sortingDecision(bad)).toThrow('invalid_sorting_response');
    }
  });

  it('sends only a bounded redacted excerpt, without credentials, recipients, HTML or attachments', () => {
    const payload = sortingRequest('Hello user@example.com 482913', 'https://example.com/reset?token=SECRET-token-12345 ' + 'x'.repeat(9000) + ' end');
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/user@example|482913|SECRET-token|example.com\/reset/);
    const long = sortingRequest('긴 메일', '긴 본문을 보냅니다. '.repeat(1000));
    expect(long.state.body.length).toBeLessThanOrEqual(6100);
    expect(long.state.body).toContain('[excerpt omitted]');
    expect(Object.keys(payload.state)).toEqual(['subject', 'body']);
  });

  it('stores mail before classification, then retries an outage with a shared backoff', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429 })); vi.stubGlobal('fetch', fetcher);
    const id = (await receiveMail(incoming(advert), testEnv))!;
    await sortMessage(sortingEnv, id);
    expect((await list()).messages).toHaveLength(1);
    expect((await list()).sorting).toMatchObject({ pending: 1, delayed: 1 });
    expect(await getRaw(testEnv, id)).not.toBeNull();
    await sortMessage(sortingEnv, id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await bindings.DB.prepare("DELETE FROM settings WHERE key = 'sort_pause_until'").run();
    await bindings.DB.prepare('UPDATE messages SET sort_due_at = 0 WHERE id = ?').bind(id).run();
    fetcher.mockImplementation(async () => Response.json(answer()));
    await sortPending(sortingEnv);
    expect((await list('promotions')).messages).toHaveLength(1);
    expect((await list()).sorting.pending).toBe(0);
  });

  it('rejects malformed model output and leaves the message in the inbox for retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ answers: { promotional: 'delete everything' } })));
    const id = (await receiveMail(incoming(advert), testEnv))!;
    await sortMessage(sortingEnv, id);
    expect((await list()).messages[0]).toMatchObject({ category: 'inbox', category_source: 'pending' });
    expect((await list()).sorting.delayed).toBe(1);
  });

  it('uses the Workers-supported manual redirect mode and never forwards API credentials', async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } });
    });
    vi.stubGlobal('fetch', fetcher);
    const id = (await receiveMail(incoming(advert), testEnv))!;
    await sortMessage(sortingEnv, id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
    expect((await list()).messages[0].category).toBe('inbox');
    expect((await list()).sorting.delayed).toBe(1);
  });

  it('does not let an in-flight automatic result undo a manual correction', async () => {
    const id = (await receiveMail(incoming(advert), testEnv))!;
    vi.stubGlobal('fetch', vi.fn(async () => {
      expect((await request(`/api/messages/${id}`, 'PATCH', { action: 'inbox' })).status).toBe(200);
      return Response.json(answer());
    }));
    await sortMessage(sortingEnv, id);
    expect((await list()).messages[0]).toMatchObject({ category: 'inbox', category_source: 'manual' });
  });

  it('claims a message once across concurrent jobs and recovers an expired lease', async () => {
    const fetcher = vi.fn(async () => Response.json(answer())); vi.stubGlobal('fetch', fetcher);
    const id = (await receiveMail(incoming(advert), testEnv))!;
    await bindings.DB.prepare('UPDATE messages SET sort_token = ?, sort_due_at = ? WHERE id = ?').bind('abandoned-worker', Date.now() - 1, id).run();
    await Promise.all([sortMessage(sortingEnv, id), sortMessage(sortingEnv, id)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await list('promotions')).messages).toHaveLength(1);
  });

  it('bounds daily API spending and leaves excess mail safely queued', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const day = new Date().toISOString().slice(0, 10);
    await bindings.DB.prepare('INSERT INTO sorting_usage (day, requests) VALUES (?, 500)').bind(day).run();
    const id = (await receiveMail(incoming(advert), testEnv))!;
    await sortMessage(sortingEnv, id);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await list()).messages).toHaveLength(1);
    expect((await list()).sorting).toMatchObject({ pending: 1, delayed: 1 });
  });

  it('preserves a promotional category through trash/restore and skips trashed mail', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const id = (await receiveMail(incoming(advert), testEnv))!;
    await request(`/api/messages/${id}`, 'PATCH', { action: 'promotions' });
    await request(`/api/messages/${id}`, 'PATCH', { action: 'trash' });
    await sortPending(sortingEnv);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await list('all')).messages).toHaveLength(0);
    await request(`/api/messages/${id}`, 'PATCH', { action: 'restore' });
    expect((await list('promotions')).messages[0]).toMatchObject({ category: 'promotions', category_source: 'manual' });
  });
});

describe('private inbox', () => {
  it('requires the configured username as well as the password without revealing which one failed', async () => {
    const response = await request('/api/login', 'POST', { username: 'wrong-user', password }, false);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '아이디 또는 비밀번호가 맞지 않습니다.' });
    await bindings.DB.prepare("INSERT INTO settings (key,value) VALUES ('login_username','configured-owner')").run();
    expect((await request('/api/login', 'POST', { username: 'owner', password }, false)).status).toBe(401);
    expect((await request('/api/login', 'POST', { username: 'configured-owner', password }, false)).status).toBe(200);
  });
  it('redirects production HTTP pages and API calls before credentials can be submitted', async () => {
    for (const path of ['/?address=pixiv%40bluekite.co.kr', '/api/login']) {
      const response = await worker.fetch(new Request('http://email.bluekite.co.kr' + path,
        path === '/api/login' ? { method: 'POST', body: '{"password":"test-only"}' } : undefined), testEnv);
      expect(response.status).toBe(308);
      expect(response.headers.get('Location')).toBe(origin + path);
      expect(response.headers.has('Set-Cookie')).toBe(false);
    }
    const local = await worker.fetch(new Request('http://127.0.0.1:8787/api/session'), testEnv);
    expect(local.status).toBe(200);
    expect((await request('/api/session')).headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });
  it('requires a login for every mail, attachment, address and settings endpoint', async () => {
    for (const path of ['/api/inbox', '/api/settings', '/api/messages/00000000-0000-0000-0000-000000000000/body', '/api/messages/00000000-0000-0000-0000-000000000000/raw', '/api/messages/00000000-0000-0000-0000-000000000000/attachments/0']) {
      expect((await request(path, 'GET', undefined, false)).status).toBe(401);
    }
    expect((await request('/api/addresses', 'POST', { local: 'private' }, false)).status).toBe(401);
  });

  it('sets a host-only HttpOnly Secure cookie, stores its hash, and revokes logout sessions', async () => {
    const response = await request('/api/login', 'POST', { password }, false);
    const setCookie = response.headers.get('Set-Cookie')!;
    expect(setCookie).toContain('__Host-bluekite_session=');
    expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('Secure'); expect(setCookie).toContain('SameSite=Strict');
    const token = cookie.split('=')[1];
    expect(await bindings.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').bind(await sha256(token)).first()).not.toBeNull();
    expect((await request('/api/logout', 'POST')).status).toBe(200);
    expect((await request('/api/inbox')).status).toBe(401);
  });

  it('rejects cross-origin writes and oversized JSON before mutation', async () => {
    expect((await request('/api/addresses', 'POST', { local: 'bad' }, true, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await request('/api/addresses', 'POST', { local: 'bad' }, true, { 'X-Bluekite-Request': '' })).status).toBe(403);
    expect((await request('/api/addresses', 'POST', { local: 'a'.repeat(5000) })).status).toBe(413);
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM addresses').first<{ n: number }>())!.n).toBe(2);
  });

  it('rate-limits wrong passwords across worker instances', async () => {
    for (let i = 0; i < 10; i++) expect((await request('/api/login', 'POST', { password: 'wrong' }, false)).status).toBe(401);
    expect((await request('/api/login', 'POST', { password }, false)).status).toBe(429);
  });

  it('changes the password and revokes every previous session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('0'.repeat(35) + ':0')));
    expect((await request('/api/password', 'POST', { currentPassword: 'wrong', newPassword: 'new-local-test-password' })).status).toBe(400);
    const response = await request('/api/password', 'POST', { currentPassword: password, newPassword: 'new-local-test-password' });
    expect(response.status).toBe(200);
    expect((await request('/api/inbox')).status).toBe(401);
    cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    expect((await request('/api/inbox')).status).toBe(200);
    expect((await request('/api/login', 'POST', { password }, false)).status).toBe(401);
    expect((await request('/api/login', 'POST', { password: 'new-local-test-password' }, false)).status).toBe(200);
  });

  it('keeps the current credential and session when a new password is breached or the check fails', async () => {
    const candidate = 'unsafe-new-password';
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(candidate));
    const suffix = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().slice(5);
    for (const [upstream, expected] of [[new Response(`${suffix}:200`), 400], [new Response('', { status: 503 }), 503]] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => upstream));
      expect((await request('/api/password', 'POST', { currentPassword: password, newPassword: candidate })).status).toBe(expected);
      expect((await request('/api/inbox')).status).toBe(200);
      const row = await bindings.DB.prepare("SELECT value FROM settings WHERE key='password_hash'").first<{ value: string }>();
      expect(await bcrypt.compare(password, row!.value)).toBe(true);
    }
  });

  it('normalizes addresses without creating provider accounts and rejects invalid addresses', async () => {
    const response = await request('/api/addresses', 'POST', { local: 'Pixiv+art' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ address: 'pixiv+art@bluekite.co.kr', created: true });
    expect((await request('/api/addresses', 'POST', { local: 'pixiv+art' })).status).toBe(200);
    for (const local of ['bad@elsewhere.com', '.a', 'a..b', '한글', 'x'.repeat(65)]) expect((await request('/api/addresses', 'POST', { local })).status).toBe(400);
  });
});

describe('verification shortcuts', () => {
  it('recognizes explicitly labelled codes and preserves leading zeroes', () => {
    expect(verificationCode('[서비스] 인증번호', '인증번호는 004829입니다. 10분 이내에 입력해 주세요.')).toBe('004829');
    expect(verificationCode('Your verification code: 482913', 'Verification code: 482913')).toBe('482913');
    expect(verificationCode('482913 is your security code', '')).toBe('482913');
    expect(verificationCode('OTP', 'OTP\n12345678')).toBe('12345678');
    expect(verificationCode('ログイン', '認証コードは 004829 です。')).toBe('004829');
  });
  it('extracts one explicit HTTPS verification link and rejects ambiguous or unsafe links', () => {
    expect(verificationLink('', '', '<a href="https://accounts.example.net/verify?token=a&amp;b=2"><strong>이메일 확인</strong></a>'))
      .toEqual({ url: 'https://accounts.example.net/verify?token=a&b=2', host: 'accounts.example.net', label: '이메일 확인' });
    expect(verificationLink('Confirm your email', 'https://example.net/confirm?t=abc', '')?.url).toBe('https://example.net/confirm?t=abc');
    for (const href of ['javascript:alert(1)', 'http://example.net/', 'https://user:pass@example.net/', '/verify']) {
      expect(verificationLink('', '', `<a href="${href}">Verify your email</a>`)).toBeNull();
    }
    expect(verificationLink('', '', '<a href="https://one.example">이메일 확인</a><a href="https://two.example">Verify your email</a>')).toBeNull();
    expect(verificationLink('Hello', 'https://example.net/', '<a href="https://example.net">Unsubscribe</a>')).toBeNull();
  });
  it('offers verification codes in the list without leaking full body text into summaries', async () => {
    await receiveMail(incoming(simpleRaw), testEnv);
    const response = await (await request('/api/inbox')).json() as any;
    expect(response.messages[0].verification_code).toBe('482913');
    expect(response.messages[0]).not.toHaveProperty('body_text');
  });
  it('does not promote order numbers, dates, link tokens or ambiguous codes', () => {
    for (const body of ['주문번호: 123456', '2026년 10월 7일', '인증번호: https://example.com/123456',
      '인증번호: 123456789', 'Verification code: 2026-10-07',
      '인증번호: 123456\n보안 코드: 654321']) expect(verificationCode('', body)).toBeNull();
  });
});

describe('actual MIME and D1 storage', () => {
  it('serves an isolated HTML document without active content or unapproved remote images', async () => {
    const html = '<script>evil()</script><form><input></form><iframe src="https://evil.example"></iframe><base href="https://evil.example"><a href="javascript:evil()" onclick="evil()">bad</a><a href="https://example.com/verify">verify</a><img src="https://example.com/pixel" onerror="evil()"><img src="data:image/svg+xml;base64,PHN2Zz4=">';
    await receiveMail(incoming('From: sender@example.net\r\nContent-Type: text/html\r\n\r\n' + html), testEnv);
    const { id } = (await bindings.DB.prepare('SELECT id FROM messages').first<{ id: string }>())!;
    const response = await request(`/api/messages/${id}/body`);
    const body = await response.text();
    expect(body).not.toMatch(/<script|<form|<input|<iframe|<base|javascript:|onclick|onerror|<img/);
    expect(body).toContain('rel="noopener noreferrer"');
    expect(response.headers.get('Content-Security-Policy')).toContain("img-src data:;");
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox allow-popups');
    expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(response.headers.get('Cache-Control')).toBe('no-store, no-transform');
    const allowed = await request(`/api/messages/${id}/body?images=1`);
    expect(await allowed.text()).toContain('src="https://example.com/pixel"');
    expect(allowed.headers.get('Content-Security-Policy')).toContain('img-src data: https:;');
  });
  it('makes HTML-only mail searchable and provides a text fallback', async () => {
    await receiveMail(incoming('From: sender@example.net\r\nSubject: HTML only\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h1>가입 확인</h1><p>코드는 987654입니다.</p><script>evil()</script>'), testEnv);
    const result = await (await request('/api/inbox?q=987654')).json() as any;
    expect(result.messages).toHaveLength(1);
    const detail = await (await request(`/api/messages/${result.messages[0].id}`)).json() as any;
    expect(detail.body_text).toContain('가입 확인');
    expect(detail.body_text).not.toContain('evil()');
  });
  it('receives a registered address, preserves the raw mail, and deduplicates retries', async () => {
    await receiveMail(incoming(simpleRaw), testEnv);
    await receiveMail(incoming(simpleRaw), testEnv);
    const inbox = await (await request('/api/inbox')).json() as any;
    expect(inbox.messages).toHaveLength(1);
    expect(inbox.addresses[0].address).toBe('pixiv@bluekite.co.kr');
    const id = inbox.messages[0].id;
    const detail = await (await request(`/api/messages/${id}`)).json() as any;
    expect(detail.body_text).toContain('인증번호 482913');
    expect(new TextDecoder().decode((await getRaw(testEnv, id))!)).toBe(simpleRaw);
    expect((await request(`/api/messages/${id}/raw`)).headers.get('Content-Disposition')).toContain('attachment');
  });

  it('handles MIME attachments and returns exact binary content as a download', async () => {
    const raw = 'From: Example <sender@example.net>\r\nSubject: Attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="sample.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECA/8=\r\n--b--\r\n';
    await receiveMail(incoming(raw), testEnv);
    const { id } = (await bindings.DB.prepare('SELECT id FROM messages').first<{ id: string }>())!;
    const response = await request(`/api/messages/${id}/attachments/0`);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3, 255]);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect((await request(`/api/messages/${id}/attachments/99`)).status).toBe(404);
  });

  it('round-trips multiple storage chunks without silently truncating an email', async () => {
    const random = new Uint8Array(400000);
    for (let i = 0; i < random.length; i += 65536) crypto.getRandomValues(random.subarray(i, i + 65536));
    const raw = new Uint8Array(new TextEncoder().encode(simpleRaw).length + random.length);
    raw.set(new TextEncoder().encode(simpleRaw)); raw.set(random, new TextEncoder().encode(simpleRaw).length);
    await receiveMail(incoming(raw), testEnv);
    const { id } = (await bindings.DB.prepare('SELECT id FROM messages').first<{ id: string }>())!;
    const { n } = (await bindings.DB.prepare('SELECT COUNT(*) AS n FROM raw_chunks').first<{ n: number }>())!;
    expect(n).toBeGreaterThan(1);
    expect(new Uint8Array((await getRaw(testEnv, id))!)).toEqual(raw);
  });

  it('rejects unsupported recipients and oversized mail before storing any data', async () => {
    const foreign = incoming(simpleRaw, 'x@other.example'); await receiveMail(foreign, testEnv);
    expect(foreign.setReject).toHaveBeenCalled();
    const large = incoming(simpleRaw); Object.defineProperty(large, 'rawSize', { value: MAX_EMAIL_BYTES + 1 });
    await receiveMail(large, testEnv); expect(large.setReject).toHaveBeenCalled();
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>())!.n).toBe(0);
  });

  it('keeps old messages, searches and filters, then allows trash, restore and intentional deletion', async () => {
    await receiveMail(incoming(simpleRaw), testEnv);
    const { id } = (await bindings.DB.prepare('SELECT id FROM messages').first<{ id: string }>())!;
    await bindings.DB.prepare('UPDATE messages SET received_at = ? WHERE id = ?').bind(1000, id).run();
    const found = await (await request('/api/inbox?q=' + encodeURIComponent('인증번호'))).json() as any;
    expect(found.messages).toHaveLength(1);
    expect((await (await request('/api/inbox?q=%25')).json() as any).messages).toHaveLength(0);
    expect((await request(`/api/messages/${id}`, 'DELETE')).status).toBe(409);
    await request(`/api/messages/${id}`, 'PATCH', { action: 'read' });
    expect((await (await request('/api/inbox?folder=unread')).json() as any).messages).toHaveLength(0);
    await request(`/api/messages/${id}`, 'PATCH', { action: 'trash' });
    expect((await (await request('/api/inbox?folder=trash')).json() as any).messages).toHaveLength(1);
    await request(`/api/messages/${id}`, 'PATCH', { action: 'restore' });
    expect((await (await request('/api/inbox')).json() as any).messages).toHaveLength(1);
    await request(`/api/messages/${id}`, 'PATCH', { action: 'trash' });
    expect((await request(`/api/messages/${id}`, 'DELETE')).status).toBe(200);
    expect(await getRaw(testEnv, id)).toBeNull();
  });
});
