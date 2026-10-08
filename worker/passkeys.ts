import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, decodeAttestationObject } from '@simplewebauthn/server/helpers';
import { atomicAuthChange, authRevision, completeLogin, deviceName, sha256 } from './auth';
import { verifyCurrentPassword, verifyTwoFactor } from './two-factor';
import { HttpError, type Env } from './types';

const TTL = 5 * 60_000;
const algorithms = [-7, -257];
interface Challenge {
  challenge: string;
  revision: string;
}
interface CredentialRow {
  id: string;
  public_key: string;
  counter: number;
  transports: string;
  name: string;
}
function site(request: Request, env: Env) {
  const url = new URL(request.url);
  // Wrangler rewrites both URL and Origin to dev.host, without the browser port.
  // Local WebAuthn uses the documented localhost:8787 URL; production is fixed.
  const origin = ['localhost', '127.0.0.1'].includes(url.hostname)
    ? 'http://localhost:8787'
    : env.PUBLIC_ORIGIN;
  return { origin, rpID: new URL(origin).hostname };
}
function cookieName(request: Request) {
  return new URL(request.url).protocol === 'https:'
    ? '__Host-mailroom_webauthn'
    : 'mailroom_webauthn';
}
function challengeToken(request: Request) {
  const value = request.headers
    .get('Cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName(request) + '='))
    ?.split('=')[1];
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function challengeCookie(request: Request, value = '') {
  return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? TTL / 1000 : 0}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function userID(env: Env) {
  await env.DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('passkey_user_id',?)")
    .bind(crypto.randomUUID())
    .run();
  return (await env.DB.prepare("SELECT value FROM settings WHERE key='passkey_user_id'").first<{
    value: string;
  }>())!.value;
}
async function freshAuthentication(env: Env, session: string, body: Record<string, unknown>) {
  const row = await env.DB.prepare('SELECT created_at FROM sessions WHERE token_hash=?')
    .bind(session)
    .first<{ created_at: number }>();
  if (row && row.created_at > Date.now() - TTL) return;
  if (typeof body.password !== 'string' || !body.password)
    throw new HttpError(428, '본인 확인 후 계속할 수 있습니다.');
  await verifyCurrentPassword(env, body.password);
  await verifyTwoFactor(env, body.code);
}
export async function listPasskeys(env: Env, session: string) {
  const results = await env.DB.batch([
    env.DB.prepare(
      'SELECT id,name,created_at,last_used_at,backed_up FROM passkeys ORDER BY created_at DESC',
    ),
    env.DB.prepare('SELECT created_at FROM sessions WHERE token_hash=?').bind(session),
  ]);
  const created = (results[1].results[0] as { created_at?: number } | undefined)?.created_at;
  return {
    passkeys: results[0].results,
    reauthenticationRequired: typeof created !== 'number' || created <= Date.now() - TTL,
  };
}
async function remember(
  request: Request,
  env: Env,
  challenge: string,
  kind: string,
  session: string | null,
  revision: string,
) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const previous = challengeToken(request);
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM passkey_challenges WHERE expires_at<=? OR id=?').bind(
        Date.now(),
        previous ? await sha256(previous) : '',
      ),
      env.DB.prepare(
        'INSERT INTO passkey_challenges (id,challenge,kind,session_hash,revision,expires_at) VALUES (?,?,?,?,?,?)',
      ).bind(await sha256(token), challenge, kind, session, revision, Date.now() + TTL),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('passkey_challenges_capacity'))
      throw new HttpError(429, '인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.', 60);
    throw error;
  }
  return challengeCookie(request, token);
}
async function consume(request: Request, env: Env, kind: string, session: string | null) {
  const token = challengeToken(request);
  if (!token) throw new HttpError(400, '로그인 버튼을 다시 눌러 주세요.');
  const row = await env.DB.prepare(
    'DELETE FROM passkey_challenges WHERE id=? AND kind=? AND session_hash IS ? AND expires_at>? RETURNING challenge,revision',
  )
    .bind(await sha256(token), kind, session, Date.now())
    .first<Challenge>();
  if (!row) throw new HttpError(410, '확인 시간이 지났습니다. 다시 시도해 주세요.');
  if (row.revision !== (await authRevision(env)))
    throw new HttpError(409, '보안 설정이 변경됐습니다. 다시 시도해 주세요.');
  return row;
}
function credentialResponse(value: unknown): RegistrationResponseJSON | AuthenticationResponseJSON {
  try {
    if (!value || typeof value !== 'object') throw new Error();
    const r = value as RegistrationResponseJSON | AuthenticationResponseJSON;
    if (
      typeof r.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,2048}$/.test(r.id) ||
      r.rawId !== r.id ||
      r.type !== 'public-key'
    )
      throw new Error();
    const client = JSON.parse(isoBase64URL.toUTF8String(r.response.clientDataJSON));
    // A private inbox has no embedded or cross-origin authentication flow.
    if (client.crossOrigin === true || client.topOrigin !== undefined) throw new Error();
    return r;
  } catch {
    throw new HttpError(400, '패스키 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
  }
}
export async function registrationOptions(
  request: Request,
  env: Env,
  session: string,
  body: Record<string, unknown>,
) {
  const revision = await authRevision(env);
  await freshAuthentication(env, session, body);
  const credentials = (await env.DB.prepare('SELECT id FROM passkeys').all<{ id: string }>())
    .results;
  if (credentials.length >= 20)
    throw new HttpError(409, '사용하지 않는 패스키를 삭제한 뒤 추가해 주세요.');
  const owner = await env.DB.prepare(
    "SELECT value FROM settings WHERE key='login_username'",
  ).first<{ value: string }>();
  const options = await generateRegistrationOptions({
    rpName: 'Mailroom',
    rpID: site(request, env).rpID,
    userName: owner?.value || 'owner',
    userDisplayName: owner?.value || 'owner',
    userID: new TextEncoder().encode(await userID(env)),
    attestationType: 'none',
    supportedAlgorithmIDs: algorithms,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    preferredAuthenticatorType: 'localDevice',
    timeout: 60_000,
    excludeCredentials: credentials.map((c) => ({ id: c.id })),
  });
  return {
    options,
    cookie: await remember(request, env, options.challenge, 'register', session, revision),
  };
}
export async function registerPasskey(
  request: Request,
  env: Env,
  session: string,
  body: Record<string, unknown>,
) {
  const pending = await consume(request, env, 'register', session);
  let result;
  try {
    const response = credentialResponse(body.credential) as RegistrationResponseJSON;
    // We requested no identifying attestation and never fetch authenticator certificate chains.
    if (
      decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject)).get(
        'fmt',
      ) !== 'none'
    )
      throw new Error();
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: site(request, env).origin,
      expectedRPID: site(request, env).rpID,
      requireUserVerification: true,
      requireUserPresence: true,
      supportedAlgorithmIDs: algorithms,
    });
  } catch {
    throw new HttpError(400, '기기 확인에 실패했습니다. 패스키 추가를 다시 시도해 주세요.');
  }
  if (!result.verified || !result.registrationInfo)
    throw new HttpError(400, '패스키를 확인하지 못했습니다.');
  const { credential, credentialBackedUp } = result.registrationInfo;
  try {
    await atomicAuthChange(env, session, pending.revision, [
      env.DB.prepare(
        'INSERT INTO passkeys (id,public_key,counter,transports,name,created_at,backed_up) VALUES (?,?,?,?,?,?,?)',
      ).bind(
        credential.id,
        isoBase64URL.fromBuffer(credential.publicKey),
        credential.counter,
        JSON.stringify(
          (credential.transports || []).filter((t) =>
            ['internal', 'hybrid', 'usb', 'nfc', 'ble', 'smart-card'].includes(t),
          ),
        ),
        deviceName(request.headers.get('User-Agent') || ''),
        Date.now(),
        Number(credentialBackedUp),
      ),
      env.DB.prepare('DELETE FROM passkey_challenges'),
    ]);
  } catch (error) {
    if (error instanceof Error && /passkeys_capacity|UNIQUE constraint/.test(error.message))
      throw new HttpError(
        409,
        '이미 등록됐거나 등록 가능한 수를 넘었습니다. 목록을 확인해 주세요.',
      );
    throw error;
  }
}
export async function authenticationOptions(request: Request, env: Env) {
  const revision = await authRevision(env);
  const options = await generateAuthenticationOptions({
    rpID: site(request, env).rpID,
    userVerification: 'required',
    timeout: 60_000,
  });
  return {
    options,
    cookie: await remember(request, env, options.challenge, 'login', null, revision),
  };
}
export async function authenticatePasskey(
  request: Request,
  env: Env,
  body: Record<string, unknown>,
) {
  const pending = await consume(request, env, 'login', null);
  const response = credentialResponse(body.credential) as AuthenticationResponseJSON;
  const row = await env.DB.prepare('SELECT * FROM passkeys WHERE id=?')
    .bind(response.id)
    .first<CredentialRow>();
  const owner = await env.DB.prepare(
    "SELECT value FROM settings WHERE key='passkey_user_id'",
  ).first<{ value: string }>();
  if (!row || !owner || response.response.userHandle !== isoBase64URL.fromUTF8String(owner.value))
    throw new HttpError(
      400,
      '등록된 패스키를 확인하지 못했습니다. 비밀번호로 로그인할 수 있습니다.',
    );
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: site(request, env).origin,
      expectedRPID: site(request, env).rpID,
      requireUserVerification: true,
      credential: {
        id: row.id,
        publicKey: isoBase64URL.toBuffer(row.public_key),
        counter: row.counter,
      },
    });
  } catch {
    throw new HttpError(
      400,
      '기기 확인에 실패했습니다. 다시 시도하거나 비밀번호로 로그인해 주세요.',
    );
  }
  if (!result.verified) throw new HttpError(400, '패스키를 확인하지 못했습니다.');
  const updated = await env.DB.prepare(
    'UPDATE passkeys SET counter=?,last_used_at=?,backed_up=? WHERE id=? AND counter=?',
  )
    .bind(
      result.authenticationInfo.newCounter,
      Date.now(),
      Number(result.authenticationInfo.credentialBackedUp),
      row.id,
      row.counter,
    )
    .run();
  if (!updated.meta.changes)
    throw new HttpError(409, '패스키 상태가 바뀌었습니다. 다시 시도해 주세요.');
  const key = await sha256(`login:${request.headers.get('CF-Connecting-IP') || 'local'}`);
  return completeLogin(request, env, pending.revision, key);
}
export async function removePasskey(
  request: Request,
  env: Env,
  session: string,
  id: string,
  body: Record<string, unknown>,
) {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(id)) throw new HttpError(400, '패스키를 확인해 주세요.');
  const revision = await authRevision(env);
  await freshAuthentication(env, session, body);
  await atomicAuthChange(env, session, revision, [
    env.DB.prepare('DELETE FROM passkeys WHERE id=?').bind(id),
    env.DB.prepare('DELETE FROM passkey_challenges'),
    env.DB.prepare('DELETE FROM push_subscriptions WHERE session_hash != ?').bind(session),
    env.DB.prepare('DELETE FROM sessions WHERE token_hash != ?').bind(session),
  ]);
}
