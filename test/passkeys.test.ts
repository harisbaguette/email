/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { isoBase64URL as b64, isoCBOR } from '@simplewebauthn/server/helpers';
import worker from '../worker/index';
import { authRevision, bumpAuthRevision, createSession, sha256 } from '../worker/auth';
import { totp } from '../worker/two-factor';
import type { Env } from '../worker/types';

const bindings = env as unknown as Env & {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};
const testEnv = {
  ...bindings,
  MFA_ENCRYPTION_KEY: btoa('k'.repeat(32)),
  API_LIMITER: { limit: async () => ({ success: true }) },
  LOGIN_LIMITER: { limit: async () => ({ success: true }) },
} as Env;
const origin = 'https://email.bluekite.co.kr';
const password = 'passkey-test-password';
let pair: CryptoKeyPair;
let publicKey: Uint8Array<ArrayBuffer>;
let jar: Record<string, string>;
let credentialID: string;
const bytes = (value: string) => new TextEncoder().encode(value);
const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
};

async function call(
  path: string,
  body?: unknown,
  cookies = jar,
  method = body === undefined ? 'GET' : 'POST',
) {
  const response = await worker.fetch(
    new Request(origin + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
        'Content-Type': 'application/json',
        'X-Bluekite-Request': '1',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    testEnv,
  );
  for (const cookie of response.headers.getSetCookie()) {
    const [key, value] = cookie.split(';')[0].split('=');
    if (value) cookies[key] = value;
    else delete cookies[key];
  }
  return response;
}
async function authData(flags: number, counter: number, rpID = 'email.bluekite.co.kr') {
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, counter);
  return join(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(rpID))),
    new Uint8Array([flags]),
    count,
  );
}
async function registration(
  challenge: string,
  overrides: Record<string, unknown> = {},
  flags = 0x45,
  rpID?: string,
) {
  const id = b64.toBuffer(credentialID);
  const length = new Uint8Array(2);
  new DataView(length.buffer).setUint16(0, id.length);
  const data = join(await authData(flags, 0, rpID), new Uint8Array(16), length, id, publicKey);
  const attestation = isoCBOR.encode(
    new Map<string, any>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', data],
    ]),
  );
  return {
    id: credentialID,
    rawId: credentialID,
    type: 'public-key',
    clientExtensionResults: { credProps: { rk: true } },
    response: {
      clientDataJSON: b64.fromUTF8String(
        JSON.stringify({
          type: 'webauthn.create',
          challenge,
          origin,
          crossOrigin: false,
          ...overrides,
        }),
      ),
      attestationObject: b64.fromBuffer(attestation),
      transports: ['internal'],
    },
  };
}
async function assertion(
  challenge: string,
  counter = 1,
  overrides: Record<string, unknown> = {},
  flags = 5,
  rpID?: string,
) {
  const client = bytes(
    JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false, ...overrides }),
  );
  const data = await authData(flags, counter, rpID);
  const signed = join(data, new Uint8Array(await crypto.subtle.digest('SHA-256', client)));
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, signed),
  );
  const user = (await bindings.DB.prepare(
    "SELECT value FROM settings WHERE key='passkey_user_id'",
  ).first<{ value: string }>())!.value;
  return {
    id: credentialID,
    rawId: credentialID,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64.fromBuffer(client),
      authenticatorData: b64.fromBuffer(data),
      signature: b64.fromBuffer(signature),
      userHandle: b64.fromUTF8String(user),
    },
  };
}
async function register() {
  const options = await call('/api/passkeys/register/options', {});
  expect(options.status).toBe(200);
  const payload = (await options.json()) as any;
  expect(payload.authenticatorSelection).toMatchObject({
    residentKey: 'required',
    userVerification: 'required',
  });
  const response = await call('/api/passkeys/register/verify', {
    credential: await registration(payload.challenge),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}
async function loginOptions(cookies: Record<string, string> = jar) {
  const response = await call('/api/passkeys/login/options', {}, cookies);
  expect(response.status).toBe(200);
  return (await response.json()) as any;
}
beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  publicKey = isoCBOR.encode(
    new Map<number, any>([
      [1, 3],
      [3, -257],
      [-1, b64.toBuffer(jwk.n!)],
      [-2, b64.toBuffer(jwk.e!)],
    ]),
  );
});
beforeEach(async () => {
  await bindings.DB.batch(
    [
      'passkey_challenges',
      'passkeys',
      'sessions',
      'push_subscriptions',
      'login_attempts',
      'settings',
      'two_factor',
      'two_factor_setups',
      'recovery_codes',
    ].map((t) => bindings.DB.prepare(`DELETE FROM ${t}`)),
  );
  await bindings.DB.prepare("INSERT INTO settings VALUES ('password_hash',?)")
    .bind(await bcrypt.hash(password, 4))
    .run();
  jar = { '__Host-bluekite_session': await createSession(testEnv) };
  credentialID = b64.fromBuffer(crypto.getRandomValues(new Uint8Array(32)));
});

describe('passkey registration and authentication in Workers and D1', () => {
  it('verifies the browser origin when Wrangler strips the local port', async () => {
    let cookie = 'bluekite_session=' + jar['__Host-bluekite_session'];
    const request = (path: string, body: unknown) =>
      new Request('http://localhost' + path, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: cookie,
          'X-Bluekite-Request': '1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const optionsResponse = await worker.fetch(
      request('/api/passkeys/register/options', {}),
      testEnv,
    );
    expect(optionsResponse.status).toBe(200);
    const options = (await optionsResponse.json()) as any;
    expect(options.rp.id).toBe('localhost');
    cookie += '; ' + optionsResponse.headers.getSetCookie()[0].split(';')[0];
    const credential = await registration(
      options.challenge,
      { origin: 'http://localhost:8787' },
      0x45,
      'localhost',
    );
    expect(
      (await worker.fetch(request('/api/passkeys/register/verify', { credential }), testEnv))
        .status,
    ).toBe(200);
  });
  it('registers after recent login and verifies a real signature, UV and discoverable user handle', async () => {
    await register();
    const row = await bindings.DB.prepare('SELECT * FROM passkeys').first<any>();
    expect(row.public_key).toBe(b64.fromBuffer(publicKey));
    const loginJar: Record<string, string> = {};
    const options = await loginOptions(loginJar);
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials || []).toHaveLength(0);
    const response = await call(
      '/api/passkeys/login/verify',
      { credential: await assertion(options.challenge) },
      loginJar,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      response.headers.getSetCookie().find((c) => c.startsWith('__Host-bluekite_session=')),
    ).toMatch(/HttpOnly; SameSite=Strict;.*Secure/);
    expect(loginJar['__Host-mailroom_webauthn']).toBeUndefined();
    expect((await call('/api/inbox', undefined, loginJar)).status).toBe(200);
    expect((await bindings.DB.prepare('SELECT counter FROM passkeys').first<any>()).counter).toBe(
      1,
    );
  });
  it('rejects anonymous enrollment and requires password again after five minutes', async () => {
    expect((await call('/api/passkeys/register/options', {}, {})).status).toBe(401);
    await bindings.DB.prepare('UPDATE sessions SET created_at=?')
      .bind(Date.now() - 360000)
      .run();
    expect((await call('/api/passkeys/register/options', {})).status).toBe(428);
    expect((await call('/api/passkeys/register/options', { password: 'wrong' })).status).toBe(400);
    expect((await call('/api/passkeys/register/options', { password })).status).toBe(200);
  });
  it('rejects registration without device verification and embedded registration', async () => {
    for (const [overrides, flags] of [
      [{}, 0x41],
      [{ crossOrigin: true, topOrigin: 'https://evil.example' }, 0x45],
    ] as const) {
      const options = (await (await call('/api/passkeys/register/options', {})).json()) as any;
      expect(
        (
          await call('/api/passkeys/register/verify', {
            credential: await registration(options.challenge, overrides, flags),
          })
        ).status,
      ).toBe(400);
    }
    expect(await bindings.DB.prepare('SELECT 1 FROM passkeys').first()).toBeNull();
  });
  it('binds enrollment to its session and invalidates it after another security change', async () => {
    const options = (await (await call('/api/passkeys/register/options', {})).json()) as any;
    const credential = await registration(options.challenge);
    const other = { ...jar, '__Host-bluekite_session': await createSession(testEnv) };
    expect((await call('/api/passkeys/register/verify', { credential }, other)).status).toBe(410);
    await bumpAuthRevision(testEnv).run();
    expect((await call('/api/passkeys/register/verify', { credential })).status).toBe(409);
    expect(await bindings.DB.prepare('SELECT 1 FROM passkeys').first()).toBeNull();
  });
  it('keeps existing TOTP on password login while a verified passkey needs no extra code', async () => {
    await register();
    const setup = (await (await call('/api/two-factor/setup', { password })).json()) as any;
    expect(
      (
        await call('/api/two-factor/confirm', {
          code: await totp(setup.secret, Math.floor(Date.now() / 30000)),
          recoverySaved: true,
        })
      ).status,
    ).toBe(200);
    await bindings.DB.prepare('UPDATE sessions SET created_at=?')
      .bind(Date.now() - 360000)
      .run();
    expect((await call('/api/passkeys/register/options', { password })).status).toBe(428);
    expect((await call('/api/login', { username: 'owner', password }, {})).status).toBe(428);
    const client: Record<string, string> = {};
    const options = await loginOptions(client);
    expect(
      (
        await call(
          '/api/passkeys/login/verify',
          { credential: await assertion(options.challenge) },
          client,
        )
      ).status,
    ).toBe(200);
    expect(await bindings.DB.prepare('SELECT 1 FROM two_factor').first()).not.toBeNull();
  });
  it('binds challenges to the browser and consumes them only once', async () => {
    await register();
    const options = await loginOptions();
    const credential = await assertion(options.challenge);
    expect((await call('/api/passkeys/login/verify', { credential }, {})).status).toBe(400);
    const cookies = { ...jar };
    expect((await call('/api/passkeys/login/verify', { credential })).status).toBe(200);
    expect((await call('/api/passkeys/login/verify', { credential }, cookies)).status).toBe(410);
  });
  it('rejects forged origins, RP hashes, UV flags, signatures and user handles', async () => {
    await register();
    for (const scenario of ['origin', 'rp', 'uv', 'signature', 'user', 'challenge', 'embedded']) {
      const options = await loginOptions();
      const credential = await assertion(
        options.challenge,
        1,
        scenario === 'origin'
          ? { origin: 'https://evil.example' }
          : scenario === 'challenge'
            ? { challenge: 'forged' }
            : scenario === 'embedded'
              ? { crossOrigin: true }
              : {},
        scenario === 'uv' ? 1 : 5,
        scenario === 'rp' ? 'evil.example' : undefined,
      );
      if (scenario === 'signature')
        credential.response.signature = b64.fromBuffer(new Uint8Array(256));
      if (scenario === 'user') credential.response.userHandle = b64.fromUTF8String('someone-else');
      expect((await call('/api/passkeys/login/verify', { credential })).status, scenario).toBe(400);
    }
  });
  it('rejects expired and pre-revocation challenges', async () => {
    await register();
    let options = await loginOptions();
    await bindings.DB.prepare('UPDATE passkey_challenges SET expires_at=0').run();
    expect(
      (await call('/api/passkeys/login/verify', { credential: await assertion(options.challenge) }))
        .status,
    ).toBe(410);
    options = await loginOptions();
    await bumpAuthRevision(testEnv).run();
    expect(
      (await call('/api/passkeys/login/verify', { credential: await assertion(options.challenge) }))
        .status,
    ).toBe(409);
  });
  it('atomically advances counters when two valid requests race', async () => {
    await register();
    const a: Record<string, string> = {},
      b: Record<string, string> = {};
    const first = await loginOptions(a),
      second = await loginOptions(b);
    const [one, two] = await Promise.all([assertion(first.challenge), assertion(second.challenge)]);
    const responses = await Promise.all([
      call('/api/passkeys/login/verify', { credential: one }, a),
      call('/api/passkeys/login/verify', { credential: two }, b),
    ]);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => [400, 409].includes(r.status))).toHaveLength(1);
  });
  it('deleting a passkey revokes other sessions and pending login challenges', async () => {
    await register();
    const other = await createSession(testEnv);
    await loginOptions();
    const revision = await authRevision(testEnv);
    expect((await call('/api/passkeys/' + credentialID, {}, jar, 'DELETE')).status).toBe(200);
    expect(await bindings.DB.prepare('SELECT 1 FROM passkeys').first()).toBeNull();
    expect(await bindings.DB.prepare('SELECT 1 FROM passkey_challenges').first()).toBeNull();
    expect(
      await bindings.DB.prepare('SELECT 1 FROM sessions WHERE token_hash=?')
        .bind(await sha256(other))
        .first(),
    ).toBeNull();
    expect(Number(await authRevision(testEnv))).toBeGreaterThan(Number(revision));
    expect((await call('/api/inbox')).status).toBe(200);
  });
  it('bounds request bodies and the number of stored passkeys', async () => {
    expect(
      (await call('/api/passkeys/register/verify', { credential: 'x'.repeat(17000) })).status,
    ).toBe(413);
    for (let i = 0; i < 20; i++)
      await bindings.DB.prepare(
        'INSERT INTO passkeys (id,public_key,name,created_at) VALUES (?,?,?,0)',
      )
        .bind('id' + i, 'public', 'test')
        .run();
    expect((await call('/api/passkeys/register/options', {})).status).toBe(409);
    await expect(
      bindings.DB.prepare(
        "INSERT INTO passkeys (id,public_key,name,created_at) VALUES ('overflow','public','test',0)",
      ).run(),
    ).rejects.toThrow('passkeys_capacity');
  });
});
