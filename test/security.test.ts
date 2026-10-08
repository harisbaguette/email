/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, applyD1Migrations } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import bcrypt from 'bcryptjs';
import { createSession, getSession, changePassword, jsonBody, limitLogin, sha256, bumpAuthRevision } from '../worker/auth';
import { startTwoFactor, confirmTwoFactor, disableTwoFactor, totp } from '../worker/two-factor';
import { receiveMail, getRaw, MAX_EMAIL_BYTES } from '../worker/mail';
import { cleanSecurityState, reserveDelivery, STORAGE_MESSAGES, DAILY_MAIL_BYTES } from '../worker/abuse';
import { verificationLink } from '../worker/verification';
import { emailDocument, emailHeaders } from '../worker/html';
import type { Env } from '../worker/types';

const bindings = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
const allow = { limit: async () => ({ success: true }) } as RateLimit;
const testEnv: Env = { ...bindings, API_LIMITER: allow, LOGIN_LIMITER: allow, DOWNLOAD_LIMITER: allow, MFA_ENCRYPTION_KEY: btoa('x'.repeat(32)) };
const origin = 'https://email.bluekite.co.kr';
const recipient = 'safe@bluekite.co.kr';
let cookie: string;
function incoming(body = 'hello', to = recipient) {
  const raw = `From: sender@example.net\r\nSubject: Security test\r\nContent-Type: text/plain\r\n\r\n${body}`;
  return { from: 'sender@example.net', to, raw: new Blob([raw]).stream(), rawSize: new TextEncoder().encode(raw).length,
    headers: new Headers(), setReject: vi.fn() } as unknown as ForwardableEmailMessage;
}
async function request(path: string, init: RequestInit = {}, customEnv = testEnv) {
  return worker.fetch(new Request(origin + path, { ...init, headers: { Cookie: cookie, ...init.headers } }), customEnv);
}
beforeAll(() => applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS));
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  await bindings.DB.batch(['messages', 'addresses', 'sessions', 'login_attempts', 'settings', 'mail_limits', 'two_factor', 'recovery_codes', 'two_factor_setups', 'push_subscriptions'].map(table => bindings.DB.prepare(`DELETE FROM ${table}`)));
  await bindings.DB.prepare('UPDATE mail_storage SET messages=0,bytes=0 WHERE id=1').run();
  await bindings.DB.prepare('INSERT INTO addresses (address,created_at,managed) VALUES (?,0,1)').bind(recipient).run();
  cookie = `__Host-bluekite_session=${await createSession(testEnv)}`;
});

describe('session lifecycle', () => {
  it('does not serve content over deprecated TLS even with a valid session', async () => {
    const req = new Request(origin + '/api/inbox', { headers: { Cookie: cookie } });
    Object.defineProperty(req, 'cf', { value: { tlsVersion: 'TLSv1.1' } });
    expect((await worker.fetch(req, testEnv)).status).toBe(426);
  });
  it('rejects a session unused for seven days even before scheduled cleanup', async () => {
    await bindings.DB.prepare('UPDATE sessions SET last_seen_at=?').bind(Date.now() - 7 * 86_400_000 - 1).run();
    expect(await getSession(new Request(origin, { headers: { Cookie: cookie } }), testEnv)).toBeNull();
  });
  it('atomically keeps at most ten sessions and revokes the oldest', async () => {
    await Promise.all(Array.from({ length: 12 }, () => createSession(testEnv)));
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<any>()).n).toBe(10);
    expect(await getSession(new Request(origin, { headers: { Cookie: cookie } }), testEnv)).toBeNull();
  });
});

describe('mail bomb protection', () => {
  it('rejects unknown and disabled addresses without reading or storing any attacker bytes', async () => {
    for (const to of ['random@bluekite.co.kr', recipient]) {
      if (to === recipient) await bindings.DB.prepare('UPDATE addresses SET blocked=1').run();
      const message = incoming('untrusted', to);
      const reader = vi.fn();
      Object.defineProperty(message, 'raw', { get: reader });
      expect(await receiveMail(message, testEnv)).toBeUndefined();
      expect(message.setReject).toHaveBeenCalledOnce(); expect(reader).not.toHaveBeenCalled();
    }
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM addresses').first<any>()).n).toBe(1);
    expect(await bindings.DB.prepare('SELECT * FROM mail_limits').first()).toBeNull();
  });
  it('accepts a newly registered address and retains the exact original', async () => {
    const created = await request('/api/addresses', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bluekite-Request': '1' }, body: JSON.stringify({ local: 'fresh' }) });
    expect(created.status).toBe(201);
    const mail = incoming('new recipient', 'fresh@bluekite.co.kr');
    const id = await receiveMail(mail, testEnv);
    expect(id).toBeTruthy(); expect(mail.setReject).not.toHaveBeenCalled();
    expect(new TextDecoder().decode((await getRaw(testEnv, id!))!)).toContain('new recipient');
  });
  it('cancels a stream exceeding its declared size before buffering the entire payload', async () => {
    const cancel = vi.fn(); let pulls = 0;
    const message = incoming();
    Object.defineProperty(message, 'rawSize', { value: 64 });
    Object.defineProperty(message, 'raw', { value: new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024)); }, cancel }) });
    await receiveMail(message, testEnv);
    expect(cancel).toHaveBeenCalledOnce(); expect(pulls).toBeLessThan(4);
    expect(message.setReject).toHaveBeenCalledWith('Message exceeds its declared size.');
    expect(await bindings.DB.prepare('SELECT * FROM messages').first()).toBeNull();
  });
  it('rejects invalid declared sizes before allocation', async () => {
    for (const size of [-1, 0, NaN, Infinity, 1.1, MAX_EMAIL_BYTES + 1]) {
      const message = incoming(); Object.defineProperty(message, 'rawSize', { value: size });
      await receiveMail(message, testEnv); expect(message.setReject).toHaveBeenCalledOnce();
    }
  });
  it('holds the recipient limit across concurrent deliveries and resets an expired window', async () => {
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 25 }, () => reserveDelivery(testEnv, recipient, 100, now)));
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(await reserveDelivery(testEnv, recipient, 100, now + 60_001)).toBe(true);
    expect((await bindings.DB.prepare("SELECT messages FROM mail_limits WHERE key='global:day'").first<any>()).messages).toBe(21);
  });
  it('enforces global quotas even when the sender rotates recipients', async () => {
    await bindings.DB.prepare("INSERT INTO mail_limits VALUES ('global:minute',?,59,0)").bind(Date.now()).run();
    const result = await Promise.all(Array.from({ length: 8 }, (_, n) => reserveDelivery(testEnv, `alias${n}@bluekite.co.kr`, 100)));
    expect(result.filter(Boolean)).toHaveLength(1);
  });
  it('enforces daily byte and count budgets without charging further attempts after saturation', async () => {
    await bindings.DB.prepare("INSERT INTO mail_limits VALUES ('global:day',?,1,?)").bind(Date.now(), DAILY_MAIL_BYTES - 99).run();
    expect(await reserveDelivery(testEnv, recipient, 100)).toBe(false);
    expect((await bindings.DB.prepare("SELECT bytes FROM mail_limits WHERE key='global:day'").first<any>()).bytes).toBe(DAILY_MAIL_BYTES - 99);
    await bindings.DB.prepare("UPDATE mail_limits SET messages=1000,bytes=0 WHERE key='global:day'").run();
    expect(await reserveDelivery(testEnv, recipient, 1)).toBe(false);
  });
  it('rejects a delivery flood before reading its payload', async () => {
    await bindings.DB.prepare('INSERT INTO mail_limits VALUES (?,?,20,0)').bind(`recipient:${recipient}:minute`, Date.now()).run();
    const message = incoming(); const reader = vi.fn(); Object.defineProperty(message, 'raw', { get: reader });
    await receiveMail(message, testEnv);
    expect(message.setReject).toHaveBeenCalledOnce(); expect(reader).not.toHaveBeenCalled();
  });
  it('keeps storage accounting through trash and frees capacity only after explicit deletion', async () => {
    const id = (await receiveMail(incoming(), testEnv))!;
    const size = (await bindings.DB.prepare('SELECT stored_size FROM messages WHERE id=?').bind(id).first<any>()).stored_size;
    expect(await bindings.DB.prepare('SELECT messages,bytes FROM mail_storage').first()).toEqual({ messages: 1, bytes: size });
    await bindings.DB.prepare('UPDATE messages SET deleted_at=1 WHERE id=?').bind(id).run();
    expect((await bindings.DB.prepare('SELECT messages FROM mail_storage').first<any>()).messages).toBe(1);
    await bindings.DB.prepare('DELETE FROM messages WHERE id=?').bind(id).run();
    expect(await bindings.DB.prepare('SELECT messages,bytes FROM mail_storage').first()).toEqual({ messages: 0, bytes: 0 });
    expect(await getRaw(testEnv, id)).toBeNull();
  });
  it('enforces the storage ceiling atomically and rolls back raw chunks on competing inserts', async () => {
    await bindings.DB.prepare('UPDATE mail_storage SET messages=?').bind(STORAGE_MESSAGES - 1).run();
    const messages = [incoming('one'), incoming('two')];
    const result = await Promise.all(messages.map(mail => receiveMail(mail, testEnv)));
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(messages.flatMap(mail => (mail.setReject as ReturnType<typeof vi.fn>).mock.calls)).toHaveLength(1);
    expect((await bindings.DB.prepare('SELECT messages FROM mail_storage').first<any>()).messages).toBe(STORAGE_MESSAGES);
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM raw_chunks WHERE message_id NOT IN (SELECT id FROM messages)').first<any>()).n).toBe(0);
  });
  it('bounds MIME parsing and preserves an oversized header as a downloadable original', async () => {
    const raw = 'X-Large: ' + 'a'.repeat(70_000) + '\r\n\r\nhello';
    const message = incoming(); Object.defineProperty(message, 'raw', { value: new Blob([raw]).stream() }); Object.defineProperty(message, 'rawSize', { value: raw.length });
    const id = (await receiveMail(message, testEnv))!;
    expect(new TextDecoder().decode((await getRaw(testEnv, id))!)).toBe(raw);
    expect((await bindings.DB.prepare('SELECT body_text FROM messages WHERE id=?').bind(id).first<any>()).body_text).toContain('본문을 표시할 수 없습니다');
  });
});

describe('HTTP and account abuse boundaries', () => {
  it('preserves a message restored while a permanent deletion request is in flight', async () => {
    const id = (await receiveMail(incoming(), testEnv))!;
    await bindings.DB.prepare('UPDATE messages SET deleted_at=1 WHERE id=?').bind(id).run();
    const raceEnv = { ...testEnv, DB: {
      prepare(query: string) {
        const statement = bindings.DB.prepare(query);
        if (!query.startsWith('DELETE FROM messages WHERE id')) return statement;
        return { bind(...values: unknown[]) {
          return { async run() {
            await bindings.DB.prepare('UPDATE messages SET deleted_at=NULL WHERE id=?').bind(id).run();
            return statement.bind(...values).run();
          } };
        } } as D1PreparedStatement;
      },
    } as D1Database };
    const response = await request(`/api/messages/${id}`, { method: 'DELETE', headers: { Origin: origin, 'X-Bluekite-Request': '1' } }, raceEnv);
    expect(response.status).toBe(409);
    expect(await bindings.DB.prepare('SELECT deleted_at FROM messages WHERE id=?').bind(id).first()).toEqual({ deleted_at: null });
    expect(await getRaw(testEnv, id)).not.toBeNull();
  });
  it.each(['password', 'mfa-setup', 'mfa-disable'])('rolls back %s if the device is revoked during reauthentication', async action => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('0'.repeat(35) + ':0')));
    const password = 'test-security-password';
    const passwordHash = await bcrypt.hash(password,4);
    await bindings.DB.prepare("INSERT INTO settings VALUES ('password_hash',?)").bind(passwordHash).run();
    let session = await sha256(cookie.split('=')[1]);
    let recoveryCode = '';
    if (action === 'mfa-disable') {
      const setup = await startTwoFactor(testEnv,session,password);
      await confirmTwoFactor(testEnv,session,await totp(setup.secret,Math.floor(Date.now()/30000)));
      session = await sha256(await createSession(testEnv));
      recoveryCode = setup.recoveryCodes[0];
    }
    const raceEnv = { ...testEnv, DB: {
      prepare: bindings.DB.prepare.bind(bindings.DB),
      batch: async (queries: D1PreparedStatement[]) => {
        await bindings.DB.prepare('DELETE FROM sessions').run();
        return bindings.DB.batch(queries);
      },
    } as D1Database };
    const operation = action === 'password'
      ? changePassword(new Request(origin, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:password,newPassword:'unexpected-new-password'})}),raceEnv,session)
      : action === 'mfa-setup' ? startTwoFactor(raceEnv,session,password) : disableTwoFactor(raceEnv,session,password,recoveryCode);
    await expect(operation).rejects.toMatchObject({status:409});
    expect((await bindings.DB.prepare("SELECT value FROM settings WHERE key='password_hash'").first<any>()).value).toBe(passwordHash);
    expect(await bindings.DB.prepare('SELECT 1 FROM two_factor_setups').first()).toBeNull();
    expect(Boolean(await bindings.DB.prepare('SELECT 1 FROM two_factor').first())).toBe(action==='mfa-disable');
  });
  it('does not let an in-flight MFA confirmation override a later credential reset', async () => {
    const session = await sha256(cookie.split('=')[1]);
    await bindings.DB.prepare("INSERT INTO settings VALUES ('password_hash',?)").bind(await bcrypt.hash('test-security-password',4)).run();
    const setup = await startTwoFactor(testEnv,session,'test-security-password');
    const raceEnv = { ...testEnv, DB: {
      prepare: bindings.DB.prepare.bind(bindings.DB),
      batch: async (queries: D1PreparedStatement[]) => {
        await bindings.DB.batch([bumpAuthRevision(testEnv), bindings.DB.prepare('DELETE FROM sessions'), bindings.DB.prepare('DELETE FROM two_factor_setups')]);
        return bindings.DB.batch(queries);
      },
    } as D1Database };
    await expect(confirmTwoFactor(raceEnv,session,await totp(setup.secret,Math.floor(Date.now()/30000)))).rejects.toMatchObject({status:409});
    expect(await bindings.DB.prepare('SELECT 1 FROM two_factor').first()).toBeNull();
  });
  it('rate-limits anonymous requests before a D1 query or session lookup', async () => {
    const DB = { prepare: vi.fn(() => { throw new Error('unexpected DB access'); }) } as unknown as D1Database;
    const blocked = { ...testEnv, DB, API_LIMITER: { limit: async () => ({ success: false }) } as RateLimit };
    const result = await request('/api/inbox', {}, blocked);
    expect(result.status).toBe(429); expect(result.headers.get('Retry-After')).toBe('60');
    expect(DB.prepare).not.toHaveBeenCalled();
    expect(result.headers.get('Cache-Control')).toContain('no-store');
  });
  it('answers liveness without a database query', async () => {
    const DB = { prepare: vi.fn() } as unknown as D1Database;
    expect((await request('/api/health', {}, { ...testEnv, DB })).status).toBe(200);
    expect(DB.prepare).not.toHaveBeenCalled();
  });
  it('rejects alternate hosts, cross-site probes and oversized URLs', async () => {
    expect((await worker.fetch(new Request('https://attacker.example/api/session'), testEnv)).status).toBe(421);
    expect((await request('/api/inbox', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await request('/api/inbox?q=' + 'a'.repeat(9000))).status).toBe(413);
  });
  it('limits costly downloads after authentication and never returns partial attachment bytes', async () => {
    const id = await receiveMail(incoming(), testEnv);
    const blocked = { ...testEnv, DOWNLOAD_LIMITER: { limit: async () => ({ success: false }) } as RateLimit };
    const result = await request(`/api/messages/${id}/raw`, {}, blocked);
    expect(result.status).toBe(429); expect(result.headers.get('Retry-After')).toBe('60');
    expect((await result.json() as any).error).toContain('파일 요청');
  });
  it('stops a blocked IP from draining the account-wide login budget', async () => {
    const req = new Request(origin, { headers: { 'CF-Connecting-IP': '192.0.2.80' } });
    for (let n = 0; n < 10; n++) await limitLogin(req, testEnv);
    for (let n = 0; n < 5; n++) await expect(limitLogin(req, testEnv)).rejects.toMatchObject({ status: 429 });
    expect((await bindings.DB.prepare("SELECT attempts FROM login_attempts WHERE ip_hash='account'").first<any>()).attempts).toBe(10);
  });
  it('allows authenticated security operations during a distributed login lockout', async () => {
    await bindings.DB.prepare("INSERT INTO login_attempts VALUES ('account',50,?)").bind(Date.now()).run();
    const req = new Request(origin, { headers: { 'CF-Connecting-IP': '192.0.2.90' } });
    await expect(limitLogin(req, testEnv)).rejects.toMatchObject({ status: 429 });
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts').first<any>()).n).toBe(1);
    await expect(limitLogin(req, testEnv, 'security')).resolves.toBeTypeOf('string');
  });
  it('bounds JSON requests even without a Content-Length header', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(5000))); }, cancel });
    await expect(jsonBody(new Request(origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cleans expired attack counters and sessions without expiring mail or addresses', async () => {
    const id = await receiveMail(incoming(), testEnv);
    await bindings.DB.prepare("INSERT INTO login_attempts VALUES ('old',10,0)").run();
    await bindings.DB.prepare("INSERT INTO mail_limits VALUES ('old',0,1,100)").run();
    await cleanSecurityState(testEnv);
    expect(await bindings.DB.prepare("SELECT * FROM login_attempts WHERE ip_hash='old'").first()).toBeNull();
    expect(await bindings.DB.prepare("SELECT * FROM mail_limits WHERE key='old'").first()).toBeNull();
    expect(await getRaw(testEnv, id!)).not.toBeNull();
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM addresses').first<any>()).n).toBe(1);
  });
  it('handles deeply nested mail links without recursive DOM traversal', () => {
    const html = '<div>'.repeat(15_000) + '<a href="https://accounts.example.net/verify"><strong>Verify your email</strong></a>' + '</div>'.repeat(15_000);
    expect(verificationLink('', '', html)?.host).toBe('accounts.example.net');
    expect(verificationLink('', '', '<a href="https://accounts.example.net:8443/">Verify your email</a>')).toBeNull();
  });
  it('blocks active content, external stylesheet loads and tracking before image opt-in', () => {
    const html = emailDocument('<svg><script>alert(1)</script></svg><object data="https://evil.example"></object><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example"><img src="https://evil.example/pixel" onerror="alert(1)"><a href="jav&#x61;script:alert(1)">x</a>', false);
    expect(html).not.toMatch(/<svg|<script|<object|http-equiv|<link|<img|onerror|javascript:/);
    expect(emailHeaders(false)['Content-Security-Policy']).toContain("default-src 'none'");
    expect(emailHeaders(false)['Content-Security-Policy']).not.toContain('allow-scripts');
    expect(emailHeaders(false)['Content-Security-Policy']).not.toContain('allow-same-origin');
  });
});
