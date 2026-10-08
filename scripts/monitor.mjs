import tls from 'node:tls';

const origin = 'https://email.bluekite.co.kr';
async function get(url, options = {}) {
  return fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'manual', ...options });
}
async function certificateDays() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: 'email.bluekite.co.kr', port: 443, servername: 'email.bluekite.co.kr', minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', rejectUnauthorized: true }, () => {
      const days = (Date.parse(socket.getPeerCertificate().valid_to) - Date.now()) / 86_400_000;
      socket.end(); resolve(days);
    });
    socket.setTimeout(15_000, () => socket.destroy(new Error('TLS timeout')));
    socket.on('error', reject);
  });
}
export async function requireProtocolRejection(version, options = {}) {
  return new Promise((resolve, reject) => {
    // Probe the handshake only: never send cookies, tokens or application data.
    const socket = tls.connect({ host: 'email.bluekite.co.kr', port: 443, servername: 'email.bluekite.co.kr',
      ...options, minVersion: version, maxVersion: version, ciphers: 'DEFAULT@SECLEVEL=0', rejectUnauthorized: true }, () => {
      socket.destroy(); reject(new Error('구형 TLS 연결이 허용되었습니다.'));
    });
    socket.setTimeout(15_000, () => socket.destroy(new Error('TLS timeout')));
    socket.on('error', error => {
      // A local cipher error, timeout or failed certificate check does not prove edge rejection.
      if (error.code === 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION') resolve();
      else reject(error);
    });
  });
}
export function checkStatus(status) {
  if (!status || status.ok !== true || !Array.isArray(status.issues) || status.issues.length) {
    // Accept only machine event identifiers; never print arbitrary server response text.
    const issues = Array.isArray(status?.issues) ? status.issues.filter(value => typeof value === 'string' && /^[a-z_]{1,40}$/.test(value)) : [];
    throw new Error(`Mailroom 운영 확인 필요: ${issues.join(', ') || 'invalid_health_response'}`);
  }
}
async function main() {
  if (process.argv.includes('--drill')) {
    checkStatus({ ok: false, issues: ['alert_delivery_drill'] });
    return;
  }
  const token = process.env.MAILROOM_MONITOR_TOKEN;
  if (!token || token.length < 32) throw new Error('감시 토큰이 설정되지 않았습니다.');
  const redirect = await get('http://email.bluekite.co.kr/?monitor=redirect');
  if (![301, 308].includes(redirect.status) || redirect.headers.get('location') !== `${origin}/?monitor=redirect`) throw new Error('HTTPS 전환 오류');
  await redirect.body?.cancel();
  const days = await certificateDays();
  if (!Number.isFinite(days) || days < 14) throw new Error('TLS 인증서 갱신 확인 필요');
  await Promise.all(['TLSv1', 'TLSv1.1'].map(version => requireProtocolRejection(version)));
  const health = await get(`${origin}/api/health`);
  if (!health.ok || (await health.json()).ok !== true) throw new Error('앱 연결 실패');
  const status = await get(`${origin}/api/monitor`, { headers: { Authorization: `Bearer ${token}` } });
  if (!status.ok) throw new Error(`운영 상태 조회 실패 (${status.status})`);
  checkStatus(await status.json());
  const disclosure = await get(`${origin}/.well-known/security.txt`);
  const text = await disclosure.text();
  const expiry = /^Expires:\s*(.+)$/m.exec(text)?.[1];
  if (!disclosure.ok || !/^Contact: https:\/\/github.com\/harisbaguette\/email\/security\/advisories\/new$/m.test(text)
    || !expiry || Date.parse(expiry) - Date.now() < 30 * 86_400_000) throw new Error('취약점 신고 창구 갱신 확인 필요');
  console.log(`Mailroom 정상 · TLS 유효기간 ${Math.floor(days)}일`);
}
if (process.argv[1]?.endsWith('/monitor.mjs')) main().catch(error => {
  // Network exceptions can contain request URLs. Keep logs to fixed labels.
  const safeIssue = error instanceof Error && /^Mailroom 운영 확인 필요: [a-z_, ]+$/.test(error.message) ? error.message : 'Mailroom 점검 실패. 운영 상태와 HTTPS 인증서, 예약 작업, 보안 사건을 확인해 주세요.';
  console.error(`::error::${safeIssue}`);
  process.exitCode = 1;
});
