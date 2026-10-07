import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, Copy, Eye, EyeOff, LockKeyhole, Mail, Plus, X } from 'lucide-react';
import { api, copyText, errorMessage } from './api';

export function Brand() {
  return <div className="brand"><span className="brand-symbol"><Mail size={22} strokeWidth={1.8} /></span><span>bluekite<span className="brand-mail">mail</span></span></div>;
}

export function Login({ onLogin, initialError }: { onLogin: () => void; initialError?: string }) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || '');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) }); onLogin(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <div className="login-brand"><Brand /></div>
    <section className="login-card">
      <div className="login-icon"><LockKeyhole size={28} strokeWidth={1.5} /></div>
      <h1>내 수신함에 로그인</h1>
      <p className="login-domain">bluekite.co.kr</p>
      <form onSubmit={submit}>
        <label htmlFor="password">비밀번호</label>
        <div className="password-field"><input id="password" type={visible ? 'text' : 'password'} autoComplete="current-password"
          autoFocus required value={password} onChange={e => setPassword(e.target.value)} aria-describedby={error ? 'login-error' : undefined} />
          <button type="button" className="icon-button" onClick={() => setVisible(v => !v)} aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
        </div>
        {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
        <button className="primary-button login-submit" disabled={busy}>{busy ? '확인 중…' : '수신함 열기'}<ArrowRight size={18} /></button>
      </form>
    </section>
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
      catch { setError('주소를 만들었습니다. 아래 주소를 선택해 직접 복사해 주세요.'); }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Modal title="새 이메일 주소" onClose={onClose}>
    <form onSubmit={submit}>
      <label htmlFor="local-part">주소 이름</label>
      <div className="address-field"><input id="local-part" placeholder="예: pixiv" value={local} autoComplete="off" autoCapitalize="none" spellCheck={false}
        maxLength={64} required onFocus={e => e.target.select()} onChange={e => setLocal(e.target.value.toLowerCase())} aria-describedby="address-hint" /><span>@{domain}</span></div>
      <p className="field-hint" id="address-hint">그대로 만들거나 원하는 이름으로 바꾸세요.</p>
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
  const [stats, setStats] = useState<{ total: number; bytes: number; maxEmailBytes: number } | null>(null);
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<typeof stats>('/api/settings').then(setStats).catch(e => setError(errorMessage(e))); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); notify('비밀번호를 변경했어요. 다른 기기는 로그아웃됩니다.'); onClose(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <Modal title="수신함 설정" onClose={onClose}>
    <dl className="settings-stats"><div><dt>메일 도메인</dt><dd>{domain}</dd></div><div><dt>보관 중</dt><dd>{stats ? `${stats.total}개 · ${formatBytes(stats.bytes)}` : '불러오는 중…'}</dd></div><div><dt>보관 기간</dt><dd>자동 삭제 없음</dd></div><div><dt>메일 한 통 크기</dt><dd>첨부 포함 {stats ? formatBytes(stats.maxEmailBytes) : '10 MB'}까지</dd></div></dl>
    <form onSubmit={submit} className="password-form"><h3>비밀번호 변경</h3>
      <label htmlFor="current-password">현재 비밀번호</label><input type="password" id="current-password" value={currentPassword} autoComplete="current-password" required onChange={e => setCurrent(e.target.value)} />
      <label htmlFor="new-password">새 비밀번호</label><input type="password" id="new-password" value={newPassword} autoComplete="new-password" minLength={12} maxLength={72} required onChange={e => setNew(e.target.value)} />
      <p className="field-hint">12자 이상으로 입력해 주세요.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="primary-button" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</button></div>
    </form>
  </Modal>;
}

export function EmptyState({ filtered, query, waiting, onAdd }: { filtered: boolean; query: string; waiting?: boolean; onAdd?: () => void }) {
  return <div className="empty-state"><div className="empty-icon"><Mail size={30} strokeWidth={1.4} /></div>
    <h3>{query ? '검색 결과가 없어요' : waiting ? '인증 메일을 기다리고 있어요' : filtered ? '메일이 없어요' : '첫 메일을 기다리고 있어요'}</h3>
    <p>{query ? '다른 검색어나 이메일 주소로 찾아보세요.' : waiting ? '복사한 주소를 가입할 곳에 붙여 넣으세요. 메일이 도착하면 자동으로 표시됩니다.' : filtered ? '이곳에 표시할 메일이 아직 없습니다.' : '내 주소로 가입하고, 인증 메일을 여기서 확인하세요.'}</p>
    {!query && !filtered && onAdd && <button className="secondary-button" onClick={onAdd}><Plus size={17} />주소 만들기</button>}
  </div>;
}

export function Toast({ text, undo }: { text: string; undo?: () => void }) {
  return <div className="toast" role="status"><Check size={18} /><span>{text}</span>{undo && <button onClick={undo}>되돌리기</button>}</div>;
}
