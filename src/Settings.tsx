import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Bell, Check, ChevronRight, Copy, LogOut, Mail, Plus, Search, UserRound, X } from 'lucide-react';
import type { AddressInfo } from '../shared/types';
import { ApiError, api, copyText, errorMessage } from './api';
import { formatBytes } from './components';
import { clearBrowserPush, disablePush, enablePush, pushRegistration, needsHomeScreen, pushSupported, rememberPush, subscriptionId, type PushDevice, type PushMode, type PushStatus } from './notifications';
function randomAddress(existing: AddressInfo[] = []) {
  const letters = ['bdfghjkmnprstvz', 'aeou', 'bdfghjkmnprstvz', 'aeou', '23456789', '23456789'];
  let local: string;
  do { local = [...crypto.getRandomValues(new Uint8Array(6))].map((byte, index) => letters[index][byte % letters[index].length]).join(''); } while (existing.some(item => item.address.split('@')[0] === local));
  return local;
}
export type SettingsTab = 'addresses' | 'notifications' | 'account';
interface SettingsProps { loading: boolean; error: string; onRetry: () => void; domain: string; addresses: AddressInfo[]; tab: SettingsTab; createInitially: boolean; onTab: (tab: SettingsTab) => void; onClose: () => void; onCreated: () => void; onSelect: (address: string) => void; onLogout: () => void }

export function SettingsPage(props: SettingsProps) {
  const visited = useRef(new Set<SettingsTab>());
  visited.current.add(props.tab);
  return <main className="settings-page"><div className="settings-title"><button className="text-button" onClick={props.onClose}><ArrowLeft size={17} />수신함</button><h1 tabIndex={-1}>설정</h1></div>
    <div className="settings-layout"><nav className="settings-nav" aria-label="설정 메뉴">{([['addresses', '이메일 주소', Mail], ['notifications', '알림', Bell], ['account', '계정', UserRound]] as const).map(([key, label, Icon]) => <button key={key} aria-current={props.tab === key ? 'page' : undefined} onClick={() => props.onTab(key)}><Icon size={18} />{label}</button>)}</nav>
      <div className="settings-content">{visited.current.has('addresses') && <section hidden={props.tab !== 'addresses'} aria-label="주소 설정"><Addresses {...props} /></section>}{visited.current.has('notifications') && <section hidden={props.tab !== 'notifications'} aria-label="알림 설정"><Notifications active={props.tab === 'notifications'} /></section>}{visited.current.has('account') && <section hidden={props.tab !== 'account'} aria-label="계정 설정"><Account active={props.tab === 'account'} onLogout={props.onLogout} /></section>}</div>
    </div>
  </main>;
}
function Addresses({ domain, addresses, createInitially, onCreated, onSelect, loading, error: loadError, onRetry, tab }: SettingsProps) {
  const [creating, setCreating] = useState(createInitially);
  const [local, setLocal] = useState(() => randomAddress(addresses));
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState('');
  const [created, setCreated] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const createdRef = useRef<HTMLButtonElement>(null);
  const focusedCreated = useRef('');
  useEffect(() => {
    if (tab === 'addresses' && created && created !== focusedCreated.current && createdRef.current) {
      createdRef.current.focus({ preventScroll: true }); focusedCreated.current = created;
    }
  }, [addresses, created, tab]);
  useEffect(() => { if (creating) { nameRef.current?.focus(); nameRef.current?.select(); } }, [creating]);
  async function copy(address: string) {
    try { await copyText(address); setCopied(address); setFallback(''); }
    catch { setFallback(address); }
  }
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const result = await api<{ address: string }>('/api/addresses', { method: 'POST', body: JSON.stringify({ local: local.trim() }) });
      await copy(result.address); setCreated(result.address); setCreating(false); setSearch(''); onCreated();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const visible = addresses.filter(item => item.address.includes(search.toLowerCase())).sort((a, b) => Number(b.address === created) - Number(a.address === created) || a.address.length - b.address.length || a.address.localeCompare(b.address));
  return <><div className="settings-section-heading"><h2>이메일 주소</h2>{!creating && <button className="primary-button" onClick={() => { setLocal(randomAddress(addresses)); setCreating(true); setError(''); }}><Plus size={16} />새 주소</button>}</div>
    {creating && <form className="address-create" onSubmit={create} aria-label="새 이메일 주소"><label htmlFor="local-part">주소 이름</label><div className="address-field"><input id="local-part" ref={nameRef} value={local} disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} required onChange={event => setLocal(event.target.value.toLowerCase())} /><span>@{domain}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="text-button" disabled={busy} onClick={() => setCreating(false)}>취소</button><button className="primary-button" disabled={busy || !local.trim()}>{busy ? '만드는 중…' : '만들고 복사'}</button></div></form>}
    {fallback && <div className="copy-fallback-area"><label htmlFor="address-copy-value">아래 주소를 선택해 복사할 수 있습니다.</label><input id="address-copy-value" readOnly value={fallback} onFocus={event => event.target.select()} autoFocus /><button className="icon-button" aria-label="복사 안내 닫기" onClick={() => setFallback('')}><X size={16} /></button></div>}
    {addresses.length > 8 && <div className="search-field address-search"><Search size={16} /><input type="search" aria-label="주소 검색" placeholder="주소 검색" value={search} onChange={event => setSearch(event.target.value)} /></div>}
    <div className="settings-addresses">{visible.map(item => <div className={`managed-address ${copied === item.address ? 'is-copied' : ''}`} key={item.address}><button className="managed-copy" ref={item.address === created ? createdRef : undefined} onClick={() => void copy(item.address)} aria-label={`${item.address} 복사`}><span className="address-value">{item.address.split('@')[0]}<span>@{domain}</span></span><span className="copy-affordance">{copied === item.address ? <><Check size={16} />복사됨</> : <Copy size={16} />}</span></button><button className="icon-button" title="메일 보기" aria-label={`${item.address} 메일 보기`} onClick={() => onSelect(item.address)}><ChevronRight size={18} /></button></div>)}{loading ? <p className="settings-empty" role="status">불러오는 중…</p> : loadError ? <div className="settings-error" role="alert"><p>{loadError}</p><button className="text-button" onClick={onRetry}>다시 시도</button></div> : !visible.length && <p className="settings-empty">{search ? '검색 결과가 없습니다.' : '만든 주소가 없습니다.'}</p>}</div>
    <span className="sr-only" role="status">{copied && `${copied} 복사됨`}</span>
  </>;
}
function Notifications({ active }: { active: boolean }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [device, setDevice] = useState<PushDevice | null>(null);
  const [mode, setMode] = useState<PushMode>('verification');
  const [preview, setPreview] = useState(false);
  const [permission, setPermission] = useState(typeof Notification === 'undefined' ? 'default' : Notification.permission);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const version = useRef(0);
  const operation = useRef(false);
  const homeScreen = needsHomeScreen();
  const supported = pushSupported();
  const load = async () => {
    if (operation.current) return;
    const request = ++version.current;
    setLoading(true);
    try {
      const result = await api<PushStatus>('/api/push');
      const registration = supported && !homeScreen ? await pushRegistration() : null;
      const subscription = await registration?.pushManager.getSubscription();
      const id = subscription ? await subscriptionId(subscription) : '';
      if (request !== version.current) return;
      const registered = result.devices.find(item => item.id === id) || null;
      setStatus(result); setDevice(registered);
      if (registered) { setMode(registered.mode); setPreview(Boolean(registered.preview)); }
      rememberPush(registered ? id : '');
      if (supported) setPermission(Notification.permission);
      setError('');
    } catch (error) { if (request === version.current) setError(errorMessage(error)); }
    finally { if (request === version.current) setLoading(false); }
  };
  useEffect(() => {
    if (!active) return;
    void load(); window.addEventListener('focus', load);
    return () => { ++version.current; window.removeEventListener('focus', load); };
  }, [active]);
  function start() {
    if (operation.current) return false;
    operation.current = true; ++version.current; setLoading(false); setBusy(true); setError(''); setFeedback('');
    return true;
  }
  function finish() { operation.current = false; setBusy(false); if (supported) setPermission(Notification.permission); }
  async function failed(error: unknown) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) { setDevice(null); await clearBrowserPush(); }
    setError(errorMessage(error));
  }
  async function toggle() {
    if (!start()) return;
    try {
      if (device) { await disablePush(device.id); setDevice(null); }
      else if (status) setDevice(await enablePush(status.publicKey, mode, preview));
    } catch (error) { await failed(error); }
    finally { finish(); }
  }
  async function update(nextMode: PushMode, nextPreview: boolean) {
    if (!device) { setMode(nextMode); setPreview(nextPreview); return; }
    if (!start()) return;
    try { await api(`/api/push/${device.id}`, { method: 'PATCH', body: JSON.stringify({ mode: nextMode, preview: nextPreview }) }); setMode(nextMode); setPreview(nextPreview); setFeedback('저장됨'); }
    catch (error) { await failed(error); }
    finally { finish(); }
  }
  async function check() {
    if (!device || !start()) return;
    try { await api(`/api/push/${device.id}/test`, { method: 'POST' }); setFeedback('알림을 보냈습니다. 이 기기의 알림 센터에서 확인할 수 있습니다.'); }
    catch (error) { await failed(error); }
    finally { finish(); }
  }
  const unavailable = homeScreen ? '홈 화면에 추가한 Bluekite에서 알림을 켤 수 있습니다.' : !supported ? '이 브라우저에서는 알림을 지원하지 않습니다.' : permission === 'denied' ? '브라우저의 사이트 설정에서 알림을 허용해 주세요.' : status && !status.configured ? '알림 서버가 연결되지 않았습니다.' : '';
  const connected = Boolean(device && permission === 'granted');
  return <><div className="settings-section-heading"><h2>알림</h2></div><div className={`notification-state ${connected ? 'enabled' : ''}`}><span className="notification-symbol"><Bell size={23} /></span><div><h3>이 기기에서 받기</h3><p>{loading && !status ? '연결 확인 중…' : connected ? '연결됨' : unavailable || '앱을 닫아도 새 메일을 알려줍니다.'}</p></div><button className={device ? 'secondary-button' : 'primary-button'} disabled={busy || loading || !status || (Boolean(unavailable) && !device)} onClick={() => void toggle()}>{busy ? '처리 중…' : device ? '끄기' : '켜기'}</button></div>
    <div className="preference-row"><label htmlFor="notification-mode">알림 받을 메일</label><select id="notification-mode" value={mode} disabled={busy || loading || !status} onChange={event => void update(event.target.value as PushMode, preview)}><option value="verification">인증 메일만</option><option value="inbox">받은 메일 전체</option></select></div>
    <div className="preference-row"><div><span id="preview-label">내용 미리보기</span><p>잠금 화면에 보낸 사람과 제목을 표시합니다.</p></div><button className="toggle" role="switch" aria-labelledby="preview-label" aria-checked={preview} disabled={busy || loading || !status} onClick={() => void update(mode, !preview)}><span /></button></div>
    {error && <div className="settings-error" role="alert"><p>{error}</p>{!status && <button className="text-button" disabled={loading} onClick={() => void load()}>다시 시도</button>}</div>}
    {feedback && <p className="settings-feedback" role="status">{feedback}</p>}
    {device && <div className="settings-bottom"><button className="text-button" disabled={busy || loading} onClick={() => void check()}>알림 보내기</button></div>}
  </>;
}
function Account({ onLogout, active }: { onLogout: () => void; active: boolean }) {
  const [stats, setStats] = useState<{ username: string; total: number; bytes: number; maxEmailBytes: number; sorting: { enabled: boolean; pending: number; delayed: number } } | null>(null);
  const [current, setCurrent] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [feedback, setFeedback] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setStats(await api<typeof stats>('/api/settings')); setLoadError(''); }
    catch (error) { setLoadError(errorMessage(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (active) void load(); }, [active]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError(''); setFeedback('');
    if (password !== confirm) { setError('새 비밀번호가 서로 다릅니다.'); return; }
    setBusy(true);
    try { await api('/api/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: password }) }); await clearBrowserPush(); setCurrent(''); setPassword(''); setConfirm(''); setFeedback('비밀번호를 변경했습니다.'); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <><div className="settings-section-heading"><h2>계정</h2></div><div className="account-identity"><span>아이디</span><strong>{stats?.username || (loadError ? '확인 불가' : '불러오는 중…')}</strong></div>
    {loadError && <div className="settings-error" role="alert"><p>{loadError}</p><button className="text-button" disabled={loading} onClick={() => void load()}>다시 시도</button></div>}
    <form className="account-form" onSubmit={save}><h3>비밀번호 변경</h3><div className="password-grid"><div><label htmlFor="current-password">현재 비밀번호</label><input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} /></div><div /><div><label htmlFor="new-password">새 비밀번호</label><input id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} /></div><div><label htmlFor="confirm-password">새 비밀번호 확인</label><input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} /></div></div><p className="field-hint">8자 이상. 변경하면 다른 기기는 로그아웃되고, 모든 기기의 알림 연결이 해제됩니다.</p>
      {error && <p className="form-error" role="alert">{error}</p>}{feedback && <p className="settings-feedback" role="status">{feedback}</p>}<div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? '저장 중…' : '비밀번호 변경'}</button></div></form>
    <dl className="account-storage"><div><dt>보관 중</dt><dd>{stats ? `${stats.total}통 / ${formatBytes(stats.bytes)}` : '…'}</dd></div><div><dt>광고 자동 정리</dt><dd>{!stats ? '…' : !stats.sorting.enabled ? '꺼짐' : stats.sorting.delayed ? `${stats.sorting.delayed}통 재시도 대기` : '켜짐'}</dd></div></dl>
    <details className="privacy-details"><summary>보관과 개인정보</summary><p>메일은 자동 삭제하지 않습니다. 한 통은 첨부 포함 {stats ? formatBytes(stats.maxEmailBytes) : '10 MB'}까지 받습니다.</p><p>광고 분류에는 Jev를 사용합니다. 링크, 이메일 주소, 긴 숫자를 가린 제목과 본문 일부를 보내며 첨부 파일은 보내지 않습니다.</p></details>
    <div className="settings-bottom"><button className="text-button logout-button" onClick={onLogout}><LogOut size={16} />이 기기에서 로그아웃</button></div>
  </>;
}
