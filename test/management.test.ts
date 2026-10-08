/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import worker from '../worker/index';
import { sha256, createSession, authRevision, bumpAuthRevision } from '../worker/auth';
import { receiveMail } from '../worker/mail';
import { processNotifications } from '../worker/push';
import { sortMessage } from '../worker/sorting';
import { verificationCode } from '../shared/verification';
import { verificationLink } from '../worker/verification';
import { totp } from '../worker/two-factor';
import type { Env } from '../worker/types';

const bindings = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
const testEnv: Env = { ...bindings, LOGIN_LIMITER: { limit: async () => ({ success: true }) } as Env['LOGIN_LIMITER'], MFA_ENCRYPTION_KEY: btoa('x'.repeat(32)) };
const origin = 'https://email.bluekite.co.kr'; const password = 'management-test-password';
let cookie = '';
async function request(path: string, method = 'GET', body?: unknown, source = origin, customCookie = cookie) {
  return worker.fetch(new Request(origin + path, { method, headers: { Origin: source, Cookie: customCookie, 'Content-Type': 'application/json', 'X-Bluekite-Request': '1', 'CF-Connecting-IP': '192.0.2.40' }, body: body === undefined ? undefined : JSON.stringify(body) }), testEnv);
}
async function mail(text: string, to = 'test@bluekite.co.kr', sender = 'sender@example.net', html = false) {
  const raw = new TextEncoder().encode(`From: ${sender}\r\nSubject: Test\r\nContent-Type: text/${html ? 'html' : 'plain'}; charset=utf-8\r\n\r\n${text}`);
  const reject = vi.fn();
  const id = await receiveMail({ from: sender, to, rawSize: raw.length, raw: new Blob([raw]).stream(), headers: new Headers(), setReject: reject } as unknown as ForwardableEmailMessage, testEnv);
  return { id, reject };
}
beforeAll(() => applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS));
beforeEach(async () => {
  await bindings.DB.batch(['push_deliveries','push_subscriptions','messages','addresses','sender_rules','sessions','login_attempts','settings','two_factor','two_factor_setups','recovery_codes'].map(table => bindings.DB.prepare(`DELETE FROM ${table}`)));
  await bindings.DB.prepare("INSERT INTO settings VALUES ('password_hash',?)").bind(await bcrypt.hash(password, 4)).run();
  cookie = `__Host-bluekite_session=${await createSession(testEnv)}`;
});
afterEach(() => vi.unstubAllGlobals());

describe('mail management and security boundaries', () => {
  it('recognizes grouped, mixed and full-width codes without selecting dates or prose', () => {
    for (const [body, code] of [['Login code: A2B3C4', 'A2B3C4'], ['인증번호: 123 456', '123456'], ['OTP: 1 2 3 4 5 6', '123456'], ['確認コード：１２３４５６', '123456'], ['Security code: AB12-CD34', 'AB12CD34'], ['Verification code 1234 is valid', '1234']]) expect(verificationCode('', body)).toBe(code);
    for (const body of ['Verification code expires in 1234 seconds', 'Verification code: 2026-10-08', 'OTP: 1234567890', 'OTP: 1234\nOTP: 5678', 'Order: AB1234']) expect(verificationCode('', body)).toBeNull();
  });
  it('rejects private and local verification shortcut destinations', () => {
    for (const url of ['https://127.0.0.1/', 'https://2130706433/', 'https://[::1]/', 'https://localhost/', 'https://router.local/', 'https://intranet/']) expect(verificationLink('', '', `<a href="${url}">Verify your email</a>`)).toBeNull();
  });
  it('separates automatic and managed addresses, preserves hidden state, and rejects disabled recipients', async () => {
    await mail('hello');
    let item = (await (await request('/api/inbox')).json() as any).addresses[0]; expect(item.managed).toBe(0);
    expect((await request('/api/addresses','POST',{ local:'test' })).status).toBe(200);
    expect((await request('/api/addresses','PATCH',{ address:'test@bluekite.co.kr', label:'개인', hidden:true })).status).toBe(200);
    await mail('second');
    item = (await (await request('/api/inbox')).json() as any).addresses[0]; expect(item).toMatchObject({ managed:1, hidden:1, label:'개인', count:2 });
    await request('/api/addresses','PATCH',{ address:item.address, blocked:true });
    expect((await mail('blocked')).reject).toHaveBeenCalledOnce();
    expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<any>()).n).toBe(2);
    expect((await request('/api/addresses','PATCH',{ address:item.address, hidden:'false' })).status).toBe(400);
  });
  it('filters verification, stars and archive; supports sender and attachment search without SQL injection', async () => {
    const auth = (await mail('Login code: AB12CD')).id!; await mail('ordinary');
    const inbox = async (query: string) => (await (await request('/api/inbox?'+query)).json() as any).messages;
    expect((await inbox('folder=verification')).map((m: any) => m.id)).toEqual([auth]);
    await request(`/api/messages/${auth}`, 'PATCH', { action:'star' });
    expect((await inbox('folder=starred')).length).toBe(1);
    await request(`/api/messages/${auth}`, 'PATCH', { action:'archive' });
    expect((await inbox('folder=inbox')).length).toBe(1); expect((await inbox('folder=archive')).length).toBe(1);
    expect((await inbox('folder=all&q='+encodeURIComponent('from:sender@example.net is:starred'))).length).toBe(1);
    expect((await inbox('folder=all&q='+encodeURIComponent("from:' OR 1=1--"))).length).toBe(0);
    expect((await inbox('folder=all&q=has:attachment')).length).toBe(0);
    expect((await request('/api/inbox?q=before:not-a-date')).status).toBe(400);
    expect((await request('/api/inbox?cursor=invalid')).status).toBe(400);
  });
  it('bulk updates only explicit IDs and permanently deletes only mail already in trash', async () => {
    const a = (await mail('a')).id!; const b = (await mail('b')).id!;
    expect((await request('/api/messages/bulk','POST',{ ids:[a,b], action:'read' })).status).toBe(200);
    await request('/api/messages/bulk','POST',{ ids:[a], action:'trash' });
    await request('/api/messages/bulk','POST',{ ids:[a,b], action:'delete' });
    expect((await request(`/api/messages/${a}`)).status).toBe(404); expect((await request(`/api/messages/${b}`)).status).toBe(200);
    expect((await request('/api/messages/bulk','POST',{ ids:Array(101).fill(b), action:'read' })).status).toBe(400);
    expect((await request('/api/messages/bulk','POST',{ ids:[b], action:'read' },'https://evil.example')).status).toBe(403);
    expect((await request('/api/messages/bulk','POST',{ ids:[b], action:'read' },origin,'')).status).toBe(401);
  });
  it('applies explicit sender rules only to future mail without calling a classifier', async () => {
    const old = (await mail('old')).id!;
    await request('/api/rules','POST',{ sender:'Sender@Example.net', action:'trash' });
    const fresh = (await mail('new')).id!;
    expect((await bindings.DB.prepare('SELECT deleted_at FROM messages WHERE id=?').bind(old).first<any>()).deleted_at).toBeNull();
    expect((await bindings.DB.prepare('SELECT deleted_at,category_source FROM messages WHERE id=?').bind(fresh).first<any>()).category_source).toBe('manual');
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher); await sortMessage({ ...testEnv,TYPESAFE_API_KEY:'test' }, fresh); expect(fetcher).not.toHaveBeenCalled();
    await request('/api/rules','DELETE',{ sender:'sender@example.net' });
    expect((await (await request('/api/rules')).json() as any).rules).toEqual([]);
  });
  it('never sends authentication codes or links to the classifier', async () => {
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher);
    for (const body of ['Login code: AB12CD', 'OTP: AB12CD\nOTP: EF34GH','<a href="https://accounts.example.net/verify?secret=abc">Verify your email</a>']) {
      const { id }=await mail(body,'test@bluekite.co.kr','sender@example.net',body.startsWith('<'));
      await sortMessage({ ...testEnv,TYPESAFE_API_KEY:'test' },id!);
      expect((await bindings.DB.prepare('SELECT category_source FROM messages WHERE id=?').bind(id).first<any>()).category_source).toBe('protected');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cannot create a login session using authentication checked before a security change', async () => {
    const revision = await authRevision(testEnv);
    await bumpAuthRevision(testEnv).run();
    await expect(createSession(testEnv, undefined, revision)).rejects.toMatchObject({ status: 409 });
    expect(await createSession(testEnv)).toHaveLength(64);
  });
  it('rejects bcrypt-truncated passwords instead of accepting a matching 72-byte prefix', async () => {
    const long = 'a'.repeat(72);
    await bindings.DB.prepare("UPDATE settings SET value=? WHERE key='password_hash'").bind(await bcrypt.hash(long, 4)).run();
    expect((await request('/api/login', 'POST', { username:'owner',password:long+'extra' })).status).toBe(400);
  });
  it('session management reveals no token hashes and revokes another session plus its push connection', async () => {
    const second=await createSession(testEnv); const hash=await sha256(second);
    await bindings.DB.prepare("INSERT INTO push_subscriptions (id,endpoint,p256dh,auth,session_hash,created_at,updated_at) VALUES ('sub','https://fcm.googleapis.com/sub','x','x',?,1,1)").bind(hash).run();
    const sessions=(await (await request('/api/sessions')).json() as any).sessions;
    expect(JSON.stringify(sessions)).not.toContain(hash); expect(sessions.filter((s:any)=>s.current)).toHaveLength(1);
    const target=sessions.find((s:any)=>!s.current);
    await request(`/api/sessions/${target.id}`,'DELETE');
    expect((await request('/api/inbox','GET',undefined,origin,`__Host-bluekite_session=${second}`)).status).toBe(401);
    expect(await bindings.DB.prepare('SELECT 1 FROM push_subscriptions').first()).toBeNull();
    expect((await request('/api/inbox')).status).toBe(200);
  });
  it('expired login sessions cannot keep receiving push notifications', async () => {
    await bindings.DB.prepare("INSERT INTO push_subscriptions (id,endpoint,p256dh,auth,session_hash,created_at,updated_at) VALUES ('sub','https://fcm.googleapis.com/sub','x','x','expired',1,1)").run();
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher);
    await processNotifications({ ...testEnv,VAPID_PUBLIC_KEY:'test',VAPID_PRIVATE_KEY:'test' });
    expect(fetcher).not.toHaveBeenCalled(); expect(await bindings.DB.prepare('SELECT 1 FROM push_subscriptions').first()).toBeNull();
  });
});

describe('two factor authentication', () => {
  const seed='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  it('matches RFC 6238 SHA-1 vectors, including counters beyond 2038', async () => {
    for (const [time,code] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']] as const) expect(await totp(seed,Math.floor(time/30),8)).toBe(code);
  });
  async function enable() {
    const response=await request('/api/two-factor/setup','POST',{ password }); expect(response.status).toBe(200);
    const setup=await response.json() as any;
    const stored=await bindings.DB.prepare('SELECT * FROM two_factor_setups').first<any>();
    expect(stored.secret).not.toContain(setup.secret); expect(stored.recovery_hashes).not.toContain(setup.recoveryCodes[0]);
    const code=await totp(setup.secret,Math.floor(Date.now()/30000));
    expect((await request('/api/two-factor/confirm','POST',{ code })).status).toBe(400);
    const confirmed=await request('/api/two-factor/confirm','POST',{ code,recoverySaved:true }); expect(confirmed.status).toBe(200);
    cookie=confirmed.headers.get('Set-Cookie')!.split(';')[0];
    return { ...setup, code };
  }
  it('requires password reauthentication and never enables an unconfirmed setup', async () => {
    expect((await request('/api/two-factor/setup','POST',{ password:'wrong' })).status).toBe(400);
    expect((await (await request('/api/two-factor')).json() as any).enabled).toBe(false);
    const setup=await (await request('/api/two-factor/setup','POST',{ password })).json() as any;
    expect((await (await request('/api/two-factor')).json() as any).enabled).toBe(false);
    await bindings.DB.prepare('UPDATE two_factor_setups SET expires_at=0').run();
    expect((await request('/api/two-factor/confirm','POST',{ code:await totp(setup.secret,Math.floor(Date.now()/30000)),recoverySaved:true })).status).toBe(410);
  });
  it('blocks password-only login, code replay and reused recovery codes; rotates sessions on enable and disable', async () => {
    const oldCookie=cookie; const setup=await enable();
    expect((await request('/api/inbox','GET',undefined,origin,oldCookie)).status).toBe(401);
    expect((await request('/api/login','POST',{ username:'owner',password })).status).toBe(428);
    expect((await request('/api/login','POST',{ username:'owner',password,code:setup.code })).status).toBe(400);
    const login=await request('/api/login','POST',{ username:'owner',password,code:setup.recoveryCodes[0] }); expect(login.status).toBe(200);
    expect((await request('/api/login','POST',{ username:'owner',password,code:setup.recoveryCodes[0] })).status).toBe(400);
    expect((await (await request('/api/two-factor')).json() as any).recoveryRemaining).toBe(7);
    expect((await request('/api/password','POST',{ currentPassword:password,newPassword:'new-password-test' })).status).toBe(428);
    expect((await request('/api/two-factor/disable','POST',{ password,code:setup.recoveryCodes[1] })).status).toBe(200);
    expect((await request('/api/inbox')).status).toBe(401);
    expect((await request('/api/login','POST',{ username:'owner',password })).status).toBe(200);
  });
  it('consumes a recovery code at most once under simultaneous attempts', async () => {
    const setup=await enable();
    const results=await Promise.all([1,2].map(()=>request('/api/login','POST',{ username:'owner',password,code:setup.recoveryCodes[0] })));
    expect(results.map(r=>r.status).sort()).toEqual([200,400]);
  });
});
