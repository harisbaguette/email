import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { ApiError, api, errorMessage } from './api';
import { normalizeAuthCode } from '../shared/auth-code';
import { Modal } from './components';
import { clearBrowserPush } from './notifications';

interface Setup { secret: string; uri: string; recoveryCodes: string[] }
export function TwoFactor({ active, onState }: { active: boolean; onState: (enabled: boolean) => void }) {
  const [status, setStatus] = useState<{ enabled: boolean; configured: boolean; recoveryRemaining: number } | null>(null);
  const [dialog, setDialog] = useState(false); const [setup, setSetup] = useState<Setup | null>(null);
  const [password, setPassword] = useState(''); const [code, setCode] = useState(''); const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState('');
  async function load() { try { const result = await api<NonNullable<typeof status>>('/api/two-factor'); setStatus(result); onState(result.enabled); setError(''); } catch (error) { setError(errorMessage(error)); } }
  useEffect(() => { if (active) void load(); }, [active]);
  function close() { if (!busy) { setDialog(false); setSetup(null); setPassword(''); setCode(''); setSaved(false); setError(''); } }
  async function submit() {
    if (busy) return; setBusy(true); setError('');
    try {
      if (status?.enabled) { await api('/api/two-factor/disable', { method: 'POST', body: JSON.stringify({ password, code }) }); await clearBrowserPush(); setDialog(false); setPassword(''); setCode(''); setFeedback('2단계 인증을 해제했습니다.'); await load(); }
      else if (!setup) { setSetup(await api<Setup>('/api/two-factor/setup', { method: 'POST', body: JSON.stringify({ password }) })); setPassword(''); }
      else { await api('/api/two-factor/confirm', { method: 'POST', body: JSON.stringify({ code, recoverySaved: saved }) }); await clearBrowserPush(); setDialog(false); setSetup(null); setCode(''); setSaved(false); setFeedback('2단계 인증을 켰습니다. 다른 기기는 로그아웃됐습니다.'); await load(); }
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) { setSetup(null); setSaved(false); setCode(''); requestAnimationFrame(() => document.getElementById('mfa-password')?.focus()); }
      setError(errorMessage(error));
    }
    finally { setBusy(false); }
  }
  function download() {
    const blob = new Blob([`Mailroom 복구 코드\n각 코드는 한 번만 사용할 수 있습니다. 안전한 곳에 보관하세요.\n\n${setup!.recoveryCodes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'mailroom-recovery-codes.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  let qr = '';
  if (setup) { const image = qrcode(0, 'M'); image.addData(setup.uri); image.make(); qr = image.createDataURL(4, 16); }
  return <div className="two-factor"><div className="preference-row"><div><strong>2단계 인증</strong><p>{status?.enabled ? `켜짐 · 복구 코드 ${status.recoveryRemaining}개 남음` : '로그인할 때 인증 앱의 코드를 확인합니다.'}</p></div><button className="secondary-button" disabled={!status?.configured || busy} onClick={() => { setDialog(true); setError(''); setFeedback(''); }}>{status?.enabled ? '해제' : '설정'}</button></div>
    {error && !dialog && <div className="settings-error" role="alert"><p>{error}</p><button className="text-button" onClick={() => void load()}>다시 시도</button></div>}{feedback && <p className="settings-feedback" role="status">{feedback}</p>}
    {dialog && <Modal title={status?.enabled ? '2단계 인증 해제' : '2단계 인증 설정'} onClose={close}><form className="search-options" onSubmit={event => { event.preventDefault(); void submit(); }}>
      {!setup && <><label htmlFor="mfa-password">현재 비밀번호</label><input id="mfa-password" type="password" autoComplete="current-password" required autoFocus value={password} onChange={event => setPassword(event.target.value)} /></>}
      {setup && <><p className="delete-description">인증 앱에서 QR 코드를 스캔하세요.</p><img className="totp-qr" src={qr} alt="인증 앱 등록 QR 코드" /><details className="manual-totp"><summary>설정 키 직접 입력</summary><input aria-label="인증 앱 설정 키" readOnly value={setup.secret} onFocus={event => event.target.select()} /></details><div className="recovery-download"><button type="button" className="secondary-button" onClick={download}>복구 코드 다운로드</button><p className="field-hint">휴대폰을 잃어버렸을 때 필요합니다.</p><label className="selection-label"><input type="checkbox" required checked={saved} onChange={event => setSaved(event.target.checked)} />복구 코드를 안전한 곳에 저장했습니다.</label></div></>}
      {(setup || status?.enabled) && <><label htmlFor="mfa-code">{setup ? '인증 앱의 6자리 코드' : '인증 앱 코드 또는 복구 코드'}</label><input id="mfa-code" autoComplete="one-time-code" inputMode={setup ? 'numeric' : 'text'} autoCapitalize="none" spellCheck={false} required value={code} onChange={event => setCode(normalizeAuthCode(event.target.value))} maxLength={32} /></>}
      {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>취소</button><button className="primary-button" disabled={busy || Boolean(setup && !saved)}>{busy ? '확인 중…' : status?.enabled ? '인증 해제' : setup ? '인증 켜기' : '계속'}</button></div>
    </form></Modal>}
  </div>;
}
