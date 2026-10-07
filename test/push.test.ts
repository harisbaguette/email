/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, applyD1Migrations } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { receiveMail } from '../worker/mail';
import { sha256 } from '../worker/auth';
import { notificationFor, processNotifications, validEndpoint } from '../worker/push';
import type { Env } from '../worker/types';

const bindings = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
const origin = 'https://email.bluekite.co.kr';
const endpoint = 'https://fcm.googleapis.com/fcm/send/test-only-endpoint';
const token = 'ab'.repeat(32);
const b64 = (value: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let pushEnv: Env;
let client: CryptoKeyPair;
let clientPublic: ArrayBuffer;
let auth: Uint8Array;
let subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
async function request(path: string, method = 'GET', body?: unknown, authenticated = true, source = origin) {
  return worker.fetch(new Request(origin + path, { method, headers: {
    Origin: source, 'Content-Type': 'application/json', 'X-Bluekite-Request': '1',
    ...(authenticated ? { Cookie: `__Host-bluekite_session=${token}` } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) }), pushEnv);
}
async function register(mode = 'verification', preview = false) {
  const response = await request('/api/push', 'POST', { subscription, mode, preview });
  expect(response.status).toBe(200);
  return (await response.json() as { id: string }).id;
}
async function mail(subject = 'Your verification code', text = 'Your verification code is 482913.') {
  const raw = new TextEncoder().encode(`From: Example <sender@example.net>\r\nTo: hi@bluekite.co.kr\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\n${text}`);
  return (await receiveMail({ from: 'sender@example.net', to: 'hi@bluekite.co.kr', rawSize: raw.length,
    raw: new Blob([raw]).stream(), setReject: vi.fn() } as unknown as ForwardableEmailMessage, pushEnv))!;
}
beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  client = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  clientPublic = await crypto.subtle.exportKey('raw', client.publicKey);
  auth = crypto.getRandomValues(new Uint8Array(16));
  subscription = { endpoint, keys: { p256dh: b64(clientPublic), auth: b64(auth) } };
  pushEnv = { ...bindings, TYPESAFE_API_KEY: undefined, VAPID_PUBLIC_KEY: b64(await crypto.subtle.exportKey('raw', vapid.publicKey)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d! };
});
beforeEach(async () => {
  await bindings.DB.batch(['DELETE FROM push_deliveries', 'DELETE FROM push_subscriptions', 'DELETE FROM raw_chunks', 'DELETE FROM messages', 'DELETE FROM addresses', 'DELETE FROM sessions'].map(sql => bindings.DB.prepare(sql)));
  await bindings.DB.prepare('INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)').bind(await sha256(token), Date.now() + 3600000, Date.now()).run();
});
afterEach(() => vi.unstubAllGlobals());

describe('private Web Push', () => {
  it('requires login and same origin; blocks private, lookalike, credential and redirect destinations', async () => {
    expect((await request('/api/push', 'GET', undefined, false)).status).toBe(401);
    expect((await request('/api/push', 'POST', {}, true, 'https://evil.example')).status).toBe(403);
    for (const value of ['http://fcm.googleapis.com/push', 'https://127.0.0.1/push', 'https://fcm.googleapis.com.evil.example/push', 'https://evil.example@fcm.googleapis.com/push', 'https://fcm.googleapis.com:8443/push', 'https://fcm.googleapis.com/push#x']) {
      expect(validEndpoint(value)).toBe(false);
      expect((await request('/api/push', 'POST', { subscription: { ...subscription, endpoint: value }, mode: 'verification', preview: false })).status).toBe(400);
    }
    for (const value of [endpoint, 'https://web.push.apple.com/example', 'https://updates.push.services.mozilla.com/wpush/v2/example']) expect(validEndpoint(value)).toBe(true);
    expect((await request('/api/push', 'POST', { subscription: { ...subscription, keys: { ...subscription.keys, p256dh: b64(new Uint8Array(65)) } }, mode: 'verification', preview: false })).status).toBe(400);
  });
  it('persists preferences without disclosing endpoints or encryption secrets and revokes on logout', async () => {
    const id = await register();
    expect((await request(`/api/push/${id}`, 'PATCH', { mode: 'inbox', preview: true })).status).toBe(200);
    const status = await (await request('/api/push')).json();
    expect(status).toEqual({ configured: true, publicKey: pushEnv.VAPID_PUBLIC_KEY, devices: [{ id, mode: 'inbox', preview: 1 }] });
    expect(JSON.stringify(status)).not.toContain(subscription.keys.auth);
    expect((await request('/api/logout', 'POST', { pushId: id })).status).toBe(200);
    expect(await bindings.DB.prepare('SELECT * FROM push_subscriptions').first()).toBeNull();
  });
  it('encrypts a real RFC 8291 payload, hides code and sender by default, and deduplicates concurrent dispatch', async () => {
    await register(); const id = await mail();
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(_url).toBe(endpoint); expect(options.redirect).toBe('manual');
      const headers = new Headers(options.headers);
      expect(headers.get('Content-Encoding')).toBe('aes128gcm');
      expect(headers.get('Authorization')).toMatch(/^vapid /);
      const data = new Uint8Array(await new Response(options.body).arrayBuffer());
      expect(new TextDecoder().decode(data)).not.toContain('482913');
      const salt = data.slice(0, 16); const publicKey = data.slice(21, 21 + data[20]);
      const server = await crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: server }, client.privateKey, 256);
      async function hkdf(secret: ArrayBuffer, salt: Uint8Array, info: Uint8Array, length: number) {
        const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
        return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(salt).buffer, info: new Uint8Array(info).buffer }, key, length * 8);
      }
      const encoder = new TextEncoder();
      const ikm = await hkdf(shared, auth, new Uint8Array([...encoder.encode('WebPush: info\0'), ...new Uint8Array(clientPublic), ...publicKey]), 32);
      const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12);
      const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, data.slice(21 + data[20])));
      let end = plaintext.length - 1; while (plaintext[end] === 0) end--;
      expect(plaintext[end]).toBe(2);
      const notification = JSON.parse(new TextDecoder().decode(plaintext.slice(0, end)));
      expect(notification).toMatchObject({ title: '인증 메일 도착', body: 'Bluekite에서 확인할 수 있습니다.', url: `/?message=${id}` });
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal('fetch', fetcher);
    await Promise.all([processNotifications(pushEnv, id), processNotifications(pushEnv, id)]);
    await processNotifications(pushEnv, id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await bindings.DB.prepare('SELECT state FROM push_deliveries').first()).toEqual({ state: 'sent' });
  });
  it('never notifies read, advertising, deleted, pre-subscription or unclassified ordinary messages', async () => {
    await register('inbox');
    const id = await mail();
    const item = await bindings.DB.prepare('SELECT * FROM messages WHERE id=?').bind(id).first<any>();
    for (const change of [{ is_read: 1 }, { deleted_at: Date.now() }, { category: 'promotions' }, { subject: 'Hello', body_text: 'Ordinary mail', category_source: 'pending' }]) {
      expect(notificationFor({ ...item, ...change }, { mode: 'inbox', preview: 0 })).toBeNull();
    }
    expect(notificationFor(item, { mode: 'verification', preview: 1 })).toMatchObject({ title: 'Example', body: 'Your verification code' });
    await bindings.DB.prepare('UPDATE messages SET received_at=1').run();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await processNotifications(pushEnv); expect(fetcher).not.toHaveBeenCalled();
  });
  it('retries transient failures, skips mail read during retry, and deletes expired subscriptions', async () => {
    const subscriptionId = await register(); const id = await mail();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 })); vi.stubGlobal('fetch', fetcher);
    await processNotifications(pushEnv); await processNotifications(pushEnv);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await bindings.DB.prepare('UPDATE push_deliveries SET due_at=0').run();
    await bindings.DB.prepare('UPDATE messages SET is_read=1 WHERE id=?').bind(id).run();
    await processNotifications(pushEnv); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await bindings.DB.prepare('SELECT state FROM push_deliveries').first()).toEqual({ state: 'skipped' });
    fetcher.mockImplementation(async () => new Response(null, { status: 410 }));
    const another = await mail('Your verification code', 'Your verification code is 778822.');
    await processNotifications(pushEnv, another);
    expect(await bindings.DB.prepare('SELECT * FROM push_subscriptions WHERE id=?').bind(subscriptionId).first()).toBeNull();
  });
  it('rate limits notification checks and never follows redirects', async () => {
    const id = await register();
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.redirect).toBe('manual'); return new Response(null, { status: 302, headers: { Location: 'https://evil.example' } });
    }); vi.stubGlobal('fetch', fetcher);
    expect((await request(`/api/push/${id}/test`, 'POST')).status).toBe(503);
    expect((await request(`/api/push/${id}/test`, 'POST')).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
