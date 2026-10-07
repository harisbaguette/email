import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, Copy, Eye, EyeOff, LockKeyhole, Mail, Plus, X, ShieldCheck } from 'lucide-react';
import { api, copyText, errorMessage } from './api';
import { InstallApp } from './InstallApp';

export function Brand() {
  return <div className="brand" aria-label="Bluekite Mail"><img className="brand-symbol" src="/brand/symbol.svg" alt="" width="42" height="42" /><span>bluekite<span className="brand-mail">mail</span></span></div>;
}

export function Login({ onLogin, initialError }: { onLogin: () => void; initialError?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || '');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }); onLogin(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story" aria-label="Bluekite Mail 소개"><div className="login-brand"><Brand /></div>
      <div className="login-story-content"><span className="eyebrow">나만의 인증 수신함</span><h2>모든 주소를 한곳에.<br /><span>인증은 더 빠르게.</span></h2><p>필요한 메일에 집중하는<br />나만의 작은 수신함입니다.</p>
        <div className="brand-scene" aria-hidden="true"><div className="scene-orbit" /><img src="/brand/symbol.svg" alt="" /><div className="scene-receipt"><span className="scene-receipt-label"><ShieldCheck size={16} />인증번호 도착</span><strong>0 4 8 2 9 1</strong><span className="scene-receipt-footer">한 번 눌러 복사<Copy size={15} /></span></div></div>
      </div><div className="login-story-footer"><span>BLUEKITE.CO.KR</span><span>가볍고, 조용하고, 간편하게.</span></div>
    </section>
    <div className="login-form-area">
    <section className="login-card">
      <div className="login-icon"><LockKeyhole size={23} strokeWidth={1.7} /></div>
      <span className="eyebrow">반갑습니다</span>
      <h1>내 수신함에 로그인</h1>
      <p className="login-domain">내 주소의 모든 메일이 이곳에 도착합니다.</p>
      <form onSubmit={submit}>
        <label htmlFor="username">아이디</label><input id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required maxLength={64} value={username} onChange={e => setUsername(e.target.value)} />
        <label htmlFor="password">비밀번호</label>
        <div className="password-field"><input id="password" type={visible ? 'text' : 'password'} autoComplete="current-password"
          required value={password} onChange={e => setPassword(e.target.value)} aria-describedby={error ? 'login-error' : undefined} />
          <button type="button" className="icon-button" onClick={() => setVisible(v => !v)} aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
        </div>
        {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
        <button className="primary-button login-submit" disabled={busy}>{busy ? '확인 중…' : '수신함 열기'}<ArrowRight size={18} /></button>
      </form>
      <p className="login-security"><ShieldCheck size={15} />나만 접근할 수 있는 개인 수신함</p>
    </section>
    <div className="login-install"><InstallApp /><span>홈 화면에서 더 빠르게 열 수 있습니다.</span></div>
    </div>
  </main>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-inner"><header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={20} /></button></header>{children}</div>
  </dialog>;
}

export function AddressDialog({ domain, onClose, onCreated }: { domain: string; onClose: () => void; onCreated: (address: string) => void }) {
  const [local, setLocal] = useState(() => `mail-${Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('')}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { address } = await api<{ address: string }>('/api/addresses', { method: 'POST', body: JSON.stringify({ local: local.trim() }) });
      setCreated(address);
      try { await copyText(address); onCreated(address); }
      catch { setError('주소를 만들었습니다. 아래 주소를 선택해 직접 복사할 수 있습니다.'); }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Modal title="새 이메일 주소" onClose={onClose}>
    <form onSubmit={submit}>
      <label htmlFor="local-part">주소 이름</label>
      <div className="address-field"><input id="local-part" placeholder="예: pixiv" value={local} autoComplete="off" autoCapitalize="none" spellCheck={false}
        maxLength={64} required onFocus={e => e.target.select()} onChange={e => setLocal(e.target.value.toLowerCase())} aria-describedby="address-hint" /><span>@{domain}</span></div>
      <p className="field-hint" id="address-hint">자동 이름이나 원하는 이름으로 만들 수 있습니다.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {created && error && <input className="copy-fallback" aria-label="만든 이메일 주소" readOnly value={created} onFocus={e => e.target.select()} />}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" data-dialog-autofocus disabled={busy || !local.trim()}><Copy size={17} />{busy ? '만드는 중…' : '만들고 복사'}</button></div>
    </form>
  </Modal>;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsDialog({ domain, onClose, notify }: { domain: string; onClose: () => void; notify: (text: string) => void }) {
  const [stats, setStats] = useState<{ total: number; bytes: number; maxEmailBytes: number; sorting: { enabled: boolean; pending: number; delayed: number } } | null>(null);
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<typeof stats>('/api/settings').then(setStats).catch(e => setError(errorMessage(e))); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); notify('비밀번호를 변경했습니다. 다른 기기는 로그아웃됩니다.'); onClose(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <Modal title="수신함 설정" onClose={onClose}>
    <dl className="settings-stats"><div><dt>메일 도메인</dt><dd>{domain}</dd></div><div><dt>보관 중</dt><dd>{stats ? `${stats.total}개 / ${formatBytes(stats.bytes)}` : '불러오는 중…'}</dd></div><div><dt>보관 기간</dt><dd>자동 삭제 없음</dd></div><div><dt>메일 한 통 크기</dt><dd>첨부 포함 {stats ? formatBytes(stats.maxEmailBytes) : '10 MB'}까지</dd></div></dl>
    <div className="sorting-settings"><h3>광고 자동 정리</h3><p>{!stats ? '불러오는 중…' : !stats.sorting.enabled ? '아직 연결되지 않았습니다. 메일은 수신함에 보관합니다.' : stats.sorting.delayed ? `${stats.sorting.delayed}개 재시도 대기 / 메일은 안전하게 보관 중` : stats.sorting.pending ? `켜짐 / ${stats.sorting.pending}개 정리 중` : '켜짐 / 새 메일을 자동으로 정리합니다.'}</p>
      <p>광고와 뉴스레터는 광고와 소식으로, 인증, 결제, 보안 메일은 받은 메일로 모읍니다. 잘못 분류된 메일은 열어서 옮길 수 있습니다.</p>
      <p className="field-hint">분류할 때 제목과 본문 일부를 Jev에 보냅니다. 링크, 이메일 주소, 긴 숫자는 가리고, 첨부 파일은 보내지 않습니다.</p></div>
    <form onSubmit={submit} className="password-form"><h3>비밀번호 변경</h3>
      <label htmlFor="current-password">현재 비밀번호</label><input type="password" id="current-password" value={currentPassword} autoComplete="current-password" required onChange={e => setCurrent(e.target.value)} />
      <label htmlFor="new-password">새 비밀번호</label><input type="password" id="new-password" value={newPassword} autoComplete="new-password" minLength={8} maxLength={72} required onChange={e => setNew(e.target.value)} />
      <p className="field-hint">8자 이상으로 설정할 수 있습니다.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="primary-button" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</button></div>
    </form>
  </Modal>;
}

export function EmptyState({ filtered, query, waiting, onAdd }: { filtered: boolean; query: string; waiting?: boolean; onAdd?: () => void }) {
  return <div className="empty-state"><div className="empty-icon"><Mail size={30} strokeWidth={1.4} /></div>
    <h3>{query ? '검색 결과가 없습니다' : waiting ? '인증 메일을 기다리는 중입니다' : filtered ? '메일이 없습니다' : '첫 메일을 기다리는 중입니다'}</h3>
    <p>{query ? '다른 검색어나 이메일 주소로 찾을 수 있습니다.' : waiting ? '복사한 주소로 가입하면 메일이 이곳에 자동으로 표시됩니다.' : filtered ? '이곳에 표시할 메일이 아직 없습니다.' : '새 주소로 가입하면 인증 메일이 이곳에 도착합니다.'}</p>
    {!query && !filtered && onAdd && <button className="secondary-button" onClick={onAdd}><Plus size={17} />주소 만들기</button>}
  </div>;
}

export function Toast({ text, undo }: { text: string; undo?: () => void }) {
  return <div className="toast" role="status"><Check size={18} /><span>{text}</span>{undo && <button onClick={undo}>되돌리기</button>}</div>;
}
