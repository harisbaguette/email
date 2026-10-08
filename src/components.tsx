import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, CircleAlert, Eye, EyeOff, MoreHorizontal, X } from 'lucide-react';
import { ApiError, api, errorMessage } from './api';
import { normalizeAuthCode } from '../shared/auth-code';

export function Brand() {
  return <div className="brand" aria-label="Mailroom"><img className="brand-symbol" src="/brand/symbol.svg" alt="" width="42" height="42" /><span className="brand-wordmark">mailroom</span></div>;
}

export function Login({ onLogin, initialError }: { onLogin: () => void; initialError?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [code, setCode] = useState('');
  const [secondFactor, setSecondFactor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || '');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password, code }) }); onLogin(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 428) { setSecondFactor(true); setError(''); }
      else { setError(errorMessage(error)); if (secondFactor) { setCode(''); requestAnimationFrame(() => document.getElementById('login-code')?.focus()); } }
    }
    finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-card"><Brand /><h1>로그인</h1>
    <form onSubmit={submit}>
      <label htmlFor="username">아이디</label><input id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required maxLength={64} value={username} onChange={event => setUsername(event.target.value)} />
      <label htmlFor="password">비밀번호</label><div className="password-field"><input id="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} aria-describedby={error ? 'login-error' : undefined} /><button type="button" className="icon-button" onClick={() => setVisible(value => !value)} aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      {secondFactor && <><label htmlFor="login-code">인증 앱 코드 또는 복구 코드</label><input id="login-code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} autoFocus value={code} onChange={event => setCode(normalizeAuthCode(event.target.value))} required maxLength={32} /></>}
      {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
      <button className="primary-button login-submit" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
    </form>
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
  return <details className="action-menu" ref={ref} onToggle={() => { if (ref.current?.open) document.querySelectorAll<HTMLDetailsElement>('.action-menu[open]').forEach(menu => { if (menu !== ref.current) menu.open = false; }); }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) ref.current?.removeAttribute('open'); }} onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); ref.current!.open = true;
    const items = [...ref.current!.querySelectorAll<HTMLElement>('.menu-list button:not(:disabled), .menu-list a')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' || index < 0 && event.key === 'ArrowDown' ? 0 : event.key === 'End' || index < 0 ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }}><summary className="icon-button" aria-label={label} title={label}><MoreHorizontal size={20} /></summary><div className="menu-list" onClick={event => { if ((event.target as Element).closest('button:not(:disabled),a')) { ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); } }}>{children}</div></details>;
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

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmptyState({ query, onClear }: { query: string; onClear?: () => void }) {
  return <div className="empty-state"><img src="/brand/symbol.svg" alt="" width="40" height="40" /><h2>{query ? '검색 결과가 없습니다' : '메일이 없습니다'}</h2>{onClear && <button className="text-button" onClick={onClear}>검색 지우기</button>}</div>;
}

export function Toast({ text, undo, error }: { text: string; undo?: () => void; error?: boolean }) {
  return <div className="toast" role={error ? 'alert' : 'status'}>{error ? <CircleAlert size={18} /> : <Check size={18} />}<span>{text}</span>{undo && <button onClick={undo}>되돌리기</button>}</div>;
}
