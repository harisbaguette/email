import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronRight, Copy, Eye, EyeOff, LogOut, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import type { AddressInfo } from '../shared/types';
import { api, copyText, errorMessage } from './api';
import { InstallApp } from './InstallApp';

export function Brand() {
  return <div className="brand" aria-label="Bluekite Mail"><img className="brand-symbol" src="/brand/symbol.svg" alt="" width="42" height="42" /><span>bluekite</span></div>;
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
  return <main className="login-page"><section className="login-card"><Brand /><h1>로그인</h1>
    <form onSubmit={submit}>
      <label htmlFor="username">아이디</label><input id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required maxLength={64} value={username} onChange={event => setUsername(event.target.value)} />
      <label htmlFor="password">비밀번호</label><div className="password-field"><input id="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} aria-describedby={error ? 'login-error' : undefined} /><button type="button" className="icon-button" onClick={() => setVisible(value => !value)} aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
      <button className="primary-button login-submit" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
    </form><InstallApp />
  </section></main>;
}

export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute('open'); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && ref.current?.open) { ref.current.removeAttribute('open'); ref.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  return <details className="action-menu" ref={ref}><summary className="icon-button" aria-label={label} title={label}><MoreHorizontal size={20} /></summary><div className="menu-list" onClick={event => { if ((event.target as Element).closest('button,a')) ref.current?.removeAttribute('open'); }}>{children}</div></details>;
}

export function AddressBook({ addresses, onClose, onNew, onSelect }: { addresses: AddressInfo[]; onClose: () => void; onNew: () => void; onSelect: (address: string) => void }) {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  async function copy(address: string) {
    try { await copyText(address); setCopied(address); setError(''); }
    catch { setError('복사하지 못했습니다. 주소를 직접 선택해 복사할 수 있습니다.'); }
  }
  const visible = addresses.filter(item => item.address.includes(search.toLowerCase())).sort((a, b) => a.address.length - b.address.length || a.address.localeCompare(b.address));
  return <Modal title="이메일 주소" onClose={onClose}>
    {addresses.length > 8 && <div className="search-field address-search"><Search size={17} /><input type="search" aria-label="주소 검색" placeholder="주소 검색" value={search} onChange={event => setSearch(event.target.value)} /></div>}
    <div className="address-book">{visible.map(item => <div className="address-book-row" key={item.address}><button className="address-book-copy" onClick={() => void copy(item.address)} aria-label={`${item.address} 복사`}><span>{item.address}</span>{copied === item.address ? <Check size={17} /> : <Copy size={16} />}</button><button className="icon-button" title="이 주소의 메일 보기" aria-label={`${item.address} 메일 보기`} onClick={() => onSelect(item.address)}><ChevronRight size={18} /></button></div>)}{!visible.length && <p className="address-empty">{search ? '검색 결과가 없습니다.' : '주소가 없습니다.'}</p>}</div>
    <span className="sr-only" role="status">{copied && `${copied} 복사됨`}</span>{error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="primary-button" onClick={onNew}><Plus size={16} />새 주소</button></div>
  </Modal>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-inner"><header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={20} /></button></header>{children}</div>
  </dialog>;
}

export function AddressDialog({ domain, onClose, onCreated }: { domain: string; onClose: () => void; onCreated: (address: string) => void }) {
  const [local, setLocal] = useState(() => `m${Array.from(crypto.getRandomValues(new Uint8Array(4)), byte => byte.toString(16).padStart(2, '0')).join('')}`);
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
        maxLength={64} required onFocus={e => e.target.select()} onChange={e => setLocal(e.target.value.toLowerCase())} /><span>@{domain}</span></div>
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

export function SettingsDialog({ domain, onClose, notify, onLogout }: { domain: string; onClose: () => void; notify: (text: string) => void; onLogout: () => void }) {
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
  return <Modal title="설정" onClose={onClose}>
    <dl className="settings-stats"><div><dt>도메인</dt><dd>{domain}</dd></div><div><dt>보관 중</dt><dd>{stats ? `${stats.total}개 / ${formatBytes(stats.bytes)}` : '…'}</dd></div><div><dt>광고 자동 정리</dt><dd>{!stats ? '…' : !stats.sorting.enabled ? '꺼짐' : stats.sorting.delayed ? `${stats.sorting.delayed}개 재시도 대기` : stats.sorting.pending ? `${stats.sorting.pending}개 정리 중` : '켜짐'}</dd></div></dl>
    <details className="settings-section"><summary>비밀번호 변경</summary><form onSubmit={submit} className="password-form">
      <label htmlFor="current-password">현재 비밀번호</label><input type="password" id="current-password" value={currentPassword} autoComplete="current-password" required onChange={event => setCurrent(event.target.value)} />
      <label htmlFor="new-password">새 비밀번호</label><input type="password" id="new-password" value={newPassword} autoComplete="new-password" minLength={8} maxLength={72} required onChange={event => setNew(event.target.value)} />
      <p className="field-hint">8자 이상</p><div className="modal-actions"><button className="primary-button" disabled={busy}>{busy ? '변경 중…' : '변경'}</button></div>
    </form></details>
    <details className="settings-section"><summary>보관과 개인정보</summary><div className="settings-info"><p>메일과 주소는 자동 삭제하지 않습니다. 메일 한 통은 첨부 포함 {stats ? formatBytes(stats.maxEmailBytes) : '10 MB'}까지 받습니다.</p><p>광고 분류에는 Jev를 사용합니다. 제목과 본문 일부를 보내며 링크, 이메일 주소, 긴 숫자를 가립니다. 첨부 파일은 보내지 않습니다.</p></div></details>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="settings-footer"><InstallApp /><button className="text-button" onClick={onLogout}><LogOut size={16} />로그아웃</button></div>
  </Modal>;
}

export function EmptyState({ filtered, query, onAdd }: { filtered: boolean; query: string; onAdd?: () => void }) {
  return <div className="empty-state"><h2>{query ? '검색 결과가 없습니다' : '메일이 없습니다'}</h2>{!query && !filtered && onAdd && <button className="text-button" onClick={onAdd}>주소 만들기</button>}</div>;
}

export function Toast({ text, undo }: { text: string; undo?: () => void }) {
  return <div className="toast" role="status"><Check size={18} /><span>{text}</span>{undo && <button onClick={undo}>되돌리기</button>}</div>;
}
