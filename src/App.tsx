import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Copy, Download, Inbox, Mail, MailOpen, Plus, RefreshCw, Search, Settings, Trash2, Undo2, X, Paperclip, Megaphone, ArrowUpRight } from 'lucide-react';
import type { Folder, InboxResult, MailMessage, MessageSummary } from '../shared/types';
import { api, copyText, errorMessage } from './api';
import { AddressBook, AddressDialog, ActionMenu, Brand, EmptyState, formatBytes, Login, Modal, SettingsDialog, Toast } from './components';
import { EmailBody } from './EmailBody';
import { verificationCode } from '../shared/verification';

const emptyInbox: InboxResult = { messages: [], addresses: [], counts: { inbox: 0, unread: 0, promotions: 0, all: 0, trash: 0 }, sorting: { enabled: false, pending: 0, delayed: 0 }, nextCursor: null };
const folderLabels: Record<Folder, string> = { inbox: '받은 메일', unread: '안 읽은 메일', promotions: '광고와 소식', all: '전체 메일', trash: '휴지통' };
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' });
const fullDateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' });

function initialLocation() {
  const params = new URLSearchParams(location.search);
  const folder = params.get('folder');
  return { folder: (folder && ['unread', 'promotions', 'all', 'trash'].includes(folder) ? folder : 'inbox') as Folder,
    address: params.get('address') || '', query: params.get('q') || '', selected: params.get('message') || null };
}

function shortTime(time: number) {
  return new Date(time).toDateString() === new Date().toDateString() ? timeFormat.format(time) : dateFormat.format(time);
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [domain, setDomain] = useState('bluekite.co.kr');
  const [sessionError, setSessionError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<{ authenticated: boolean; domain: string }>('/api/session', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setAuthenticated(result.authenticated); setDomain(result.domain); } })
      .catch(error => { if (!controller.signal.aborted) { setSessionError(errorMessage(error)); setAuthenticated(false); } });
    const expired = () => { setAuthenticated(false); setSessionError('로그인이 만료됐습니다. 다시 로그인해야 합니다.'); };
    window.addEventListener('session-expired', expired);
    return () => { controller.abort(); window.removeEventListener('session-expired', expired); };
  }, []);
  if (authenticated === null) return <div className="initial-loading"><Brand /><span className="loading-dot" /></div>;
  if (!authenticated) return <Login initialError={sessionError} onLogin={() => { setAuthenticated(true); setSessionError(''); }} />;
  return <Mailbox domain={domain} onLogout={() => setAuthenticated(false)} />;
}

function Mailbox({ domain, onLogout }: { domain: string; onLogout: () => void }) {
  const [view, setView] = useState(initialLocation);
  const { folder, address, query, selected } = view;
  const [search, setSearch] = useState(query);
  const [data, setData] = useState<InboxResult>(emptyInbox);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedMore, setLoadedMore] = useState(false);
  const [listError, setListError] = useState('');
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [messageError, setMessageError] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageVersion, setMessageVersion] = useState(0);
  const [dialog, setDialog] = useState<'address' | 'addresses' | 'settings' | 'delete' | null>(() => new URLSearchParams(location.search).has('new-address') ? 'address' : null);
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [copyFallback, setCopyFallback] = useState<{ value: string; label: string } | null>(null);
  const requestVersion = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listScroll = useRef(0);
  const lastOpened = useRef<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current); setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 10000 : 4200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => { history.scrollRestoration = previous; };
  }, []);
  useLayoutEffect(() => {
    if (selected) {
      lastOpened.current = selected;
      window.scrollTo(0, 0);
      document.querySelector<HTMLButtonElement>('.back-button')?.focus({ preventScroll: true });
    } else if (lastOpened.current) {
      window.scrollTo(0, listScroll.current);
      document.querySelector<HTMLButtonElement>(`[data-message-id="${CSS.escape(lastOpened.current)}"] .row-open`)?.focus({ preventScroll: true });
    }
  }, [selected]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  function navigate(changes: Partial<typeof view>, push = false) {
    const next = { ...view, ...changes };
    const params = new URLSearchParams();
    if (next.folder !== 'inbox') params.set('folder', next.folder);
    if (next.address) params.set('address', next.address);
    if (next.query) params.set('q', next.query);
    if (next.selected) params.set('message', next.selected);
    const url = `${location.pathname}${params.size ? `?${params}` : ''}`;
    if (push) history.pushState({ mailDetail: true }, '', url);
    else history.replaceState(null, '', url);
    setView(next);
  }

  useEffect(() => {
    const pop = () => { const next = initialLocation(); if (next.selected) listScroll.current = window.scrollY; setView(next); setSearch(next.query); };
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (selected) navigate({ selected: null });
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('popstate', pop); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('keydown', key); };
  }, [view]);

  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => navigate({ query: search, selected: null }), 300);
    return () => clearTimeout(timer);
  }, [search, query, folder, address]);

  const refresh = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setRefreshing(true);
    try {
      const params = new URLSearchParams({ folder, address, q: query });
      const result = await api<InboxResult>(`/api/inbox?${params}`);
      if (version !== requestVersion.current) return;
      setData(result); setListError(''); setLoadedMore(false);
    } catch (error) {
      if (version === requestVersion.current) setListError(errorMessage(error));
    } finally {
      if (version === requestVersion.current) { setLoading(false); setRefreshing(false); }
    }
  }, [folder, address, query]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);
  useEffect(() => {
    const poll = () => { if (!document.hidden && navigator.onLine && !loadedMore) void refresh(true); };
    const timer = setInterval(poll, 10000);
    document.addEventListener('visibilitychange', poll); window.addEventListener('online', poll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); window.removeEventListener('online', poll); };
  }, [refresh, loadedMore, address, folder]);

  useEffect(() => {
    setMessage(null); setMessageError('');
    if (!selected) return;
    const controller = new AbortController();
    api<MailMessage>(`/api/messages/${selected}`, { signal: controller.signal }).then(async result => {
      if (controller.signal.aborted) return;
      setMessage(result);
      if (!result.is_read) {
        try {
          await api(`/api/messages/${selected}`, { method: 'PATCH', body: JSON.stringify({ action: 'read' }), signal: controller.signal });
          if (!controller.signal.aborted) { setMessage({ ...result, is_read: 1 }); void refresh(true); }
        } catch (error) { if (!controller.signal.aborted) notify(errorMessage(error)); }
      }
    }).catch(error => { if (!controller.signal.aborted) setMessageError(errorMessage(error)); });
    return () => controller.abort();
  }, [selected, messageVersion]);

  async function more() {
    if (!data.nextCursor || refreshing) return;
    const version = requestVersion.current;
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ folder, address, q: query, cursor: data.nextCursor });
      const result = await api<InboxResult>(`/api/inbox?${params}`);
      if (version !== requestVersion.current) return;
      setData(previous => ({ ...result, messages: [...previous.messages, ...result.messages.filter(m => !previous.messages.some(p => p.id === m.id))] }));
      setLoadedMore(true); setListError('');
    } catch (error) { if (version === requestVersion.current) setListError(errorMessage(error)); }
    finally { if (version === requestVersion.current) setRefreshing(false); }
  }

  async function copy(address: string) {
    try { await copyText(address); notify(`${address} 복사됨`); }
    catch { setCopyFallback({ value: address, label: '이메일 주소' }); }
  }

  function chooseFolder(folder: Folder, address = '') {
    listScroll.current = 0;
    setSearch(''); navigate({ folder, address, selected: null, query: '' });
  }

  function back() {
    if (history.state?.mailDetail) history.back();
    else navigate({ selected: null });
  }

  async function mutate(action: 'read' | 'unread' | 'trash' | 'restore' | 'delete' | 'inbox' | 'promotions') {
    if (!message || messageBusy) return;
    const id = message.id; setMessageBusy(true);
    try {
      await api(`/api/messages/${id}`, { method: action === 'delete' ? 'DELETE' : 'PATCH', body: action === 'delete' ? undefined : JSON.stringify({ action }) });
      if (action === 'inbox' || action === 'promotions') {
        navigate({ selected: null });
        notify(action === 'inbox' ? '받은 메일로 옮겼습니다.' : '광고와 소식으로 옮겼습니다.');
      } else if (action === 'trash' || action === 'restore' || action === 'delete') {
        navigate({ selected: null }); setDialog(null);
        notify(action === 'trash' ? '휴지통으로 이동했습니다.' : action === 'restore' ? `${message.category === 'promotions' ? '광고와 소식' : '받은 메일'}으로 복원했습니다.` : '메일을 영구 삭제했습니다.',
          action === 'trash' ? () => { void api(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'restore' }) })
            .then(() => { notify('메일을 복원했습니다.'); void refresh(true); }).catch(e => notify(errorMessage(e))); } : undefined);
      } else setMessage({ ...message, is_read: Number(action === 'read') });
      await refresh(true);
    } catch (error) { notify(errorMessage(error)); }
    finally { setMessageBusy(false); }
  }

  const code = message ? verificationCode(message.subject, message.body_text) : null;
  async function copyCode(value: string) {
    try { await copyText(value); notify('복사됨'); }
    catch { setCopyFallback({ value, label: '인증번호' }); }
  }
  return <div className="mail-app">
    <header className="app-header"><button className="brand-home" onClick={() => chooseFolder('inbox')} aria-label="받은 메일로 이동"><Brand /></button>
      <div className="app-actions"><button className="text-button" onClick={() => setDialog('addresses')}>주소</button><button className="primary-button" onClick={() => setDialog('address')} aria-label="주소 만들기"><Plus size={16} />새 주소</button><button className="icon-button" onClick={() => setDialog('settings')} aria-label="설정" title="설정"><Settings size={19} /></button></div>
    </header>
    <main className={`workspace ${selected ? 'detail-open' : ''}`}>
      {listError && <div className="connection-error" role="alert"><span>{listError}</span><button onClick={() => void refresh()}>다시 시도</button></div>}
      {!online && <div className="connection-error" role="status">오프라인입니다.</div>}
      <section className="mail-list" aria-label="메일 목록" hidden={Boolean(selected)}>
        <div className="list-heading"><h1 className="sr-only">{folderLabels[folder]}</h1><div className="folder-picker"><select aria-label="메일함" value={folder} onChange={event => chooseFolder(event.target.value as Folder)}>{Object.entries(folderLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown size={17} /></div>
          <div className="list-tools"><div className="search-field"><Search size={17} /><input ref={searchRef} type="search" aria-label="메일 검색" placeholder="검색" value={search} onChange={event => setSearch(event.target.value)} /></div><button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={() => void refresh()} aria-label="새로고침" title="새로고침" disabled={refreshing}><RefreshCw size={17} /></button></div>
        </div>
        {address && <div className="active-filter"><button onClick={() => void copy(address)} title="주소 복사">{address}<Copy size={14} /></button><button className="icon-button" aria-label="주소 필터 해제" onClick={() => chooseFolder('inbox')}><X size={15} /></button></div>}
        <div className="list-scroll" aria-busy={loading}>
          {loading ? <div className="list-loading" role="status">불러오는 중…</div>
            : data.messages.length ? data.messages.map(item => <MailRow key={item.id} item={item} onClick={() => { listScroll.current = window.scrollY; navigate({ selected: item.id }, true); }} onCopyCode={() => void copyCode(item.verification_code!)} />)
              : !listError && <EmptyState filtered={folder !== 'inbox' || Boolean(address)} query={query} onAdd={() => setDialog('address')} />}
          {!loading && data.nextCursor && <button className="load-more" onClick={() => void more()} disabled={refreshing}>{refreshing ? '불러오는 중…' : '더 보기'}</button>}
        </div>
      </section>
      {selected && <section className="reading-pane" aria-label="메일 상세">
        <div className="reading-toolbar"><button className="text-button back-button" onClick={back} aria-label="메일 목록으로"><ArrowLeft size={18} />목록</button>
          {message && <div className="reading-actions">
            {message.deleted_at !== null && <button className="icon-button" aria-label="수신함으로 복원" title="수신함으로 복원" disabled={messageBusy} onClick={() => void mutate('restore')}><Undo2 size={18} /></button>}
            <button className="icon-button danger-hover" aria-label={message.deleted_at !== null ? '영구 삭제' : '휴지통으로 이동'} title={message.deleted_at !== null ? '영구 삭제' : '휴지통으로 이동'} disabled={messageBusy} onClick={() => message.deleted_at !== null ? setDialog('delete') : void mutate('trash')}><Trash2 size={18} /></button>
            <ActionMenu label="메일 작업">
              <button disabled={messageBusy} onClick={() => void mutate(message.is_read ? 'unread' : 'read')}>{message.is_read ? <Mail size={16} /> : <MailOpen size={16} />}{message.is_read ? '안 읽음으로 표시' : '읽음으로 표시'}</button>
              <a href={`/api/messages/${message.id}/raw`} download aria-label="메일 원본 다운로드"><Download size={16} />원본 다운로드</a>
              {message.deleted_at === null && <button disabled={messageBusy} onClick={() => void mutate(message.category === 'promotions' ? 'inbox' : 'promotions')}>{message.category === 'promotions' ? <Inbox size={16} /> : <Megaphone size={16} />}{message.category === 'promotions' ? '광고 아님' : '광고와 소식으로 이동'}</button>}
            </ActionMenu>
          </div>}
        </div>
        {messageError ? <div className="detail-error" role="alert"><p>{messageError}</p><button className="secondary-button" onClick={() => setMessageVersion(v => v + 1)}>다시 시도</button></div>
          : !message ? <div className="list-loading" role="status">불러오는 중…</div>
          : <><div className="message-header"><h2>{message.subject}</h2>
            <div className="message-meta"><details className="sender-details"><summary>{message.sender_name || message.sender_address}<ChevronDown size={14} /></summary><dl><dt>보낸 사람</dt><dd>{message.sender_address}</dd><dt>받는 사람</dt><dd>{message.recipient}</dd><dt>날짜</dt><dd>{fullDateFormat.format(message.received_at)}</dd></dl></details><time dateTime={new Date(message.received_at).toISOString()}>{shortTime(message.received_at)}</time></div>
            <button className="recipient-copy" onClick={() => void copy(message.recipient)} title="주소 복사">{message.recipient}<Copy size={13} /></button>
          </div>
          {(code || message.verification_link) && <div className="verification-actions">{code && <button className="verification-code" aria-label="인증번호 복사" title="인증번호 복사" onClick={() => void copyCode(code)}><strong>{code}</strong><span><Copy size={16} />복사</span></button>}
            {message.verification_link && <a className="verification-link" href={message.verification_link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label="이메일 확인 링크 열기"><span>인증하기 <ArrowUpRight size={16} /></span><small>{message.verification_link.host}</small></a>}
          </div>}
          {message.attachments.length > 0 && <div className="attachments">{message.attachments.map(file => <a key={file.index} href={`/api/messages/${message.id}/attachments/${file.index}`} download className="attachment"><Paperclip size={15} /><span>{file.filename}</span><small>{formatBytes(file.size)}</small></a>)}</div>}
          <EmailBody key={message.id} message={message} /></>}
      </section>}
    </main>
    {dialog === 'addresses' && <AddressBook addresses={data.addresses} onClose={() => setDialog(null)} onNew={() => setDialog('address')} onSelect={value => { setDialog(null); chooseFolder('all', value); }} />}
    {dialog === 'address' && <AddressDialog domain={domain} onClose={() => { setDialog(null); void refresh(true); }} onCreated={newAddress => { setDialog(null); chooseFolder('inbox'); void refresh(true); notify(`${newAddress} 복사됨`); }} />}
    {dialog === 'settings' && <SettingsDialog domain={domain} onClose={() => setDialog(null)} notify={notify} onLogout={() => { void api('/api/logout', { method: 'POST' }).then(onLogout).catch(e => notify(errorMessage(e))); }} />}
    {dialog === 'delete' && <Modal title="메일을 영구 삭제할까요?" onClose={() => setDialog(null)}><p className="delete-description">메일과 첨부 파일이 삭제되며 복원할 수 없습니다.</p><div className="modal-actions"><button className="secondary-button" autoFocus onClick={() => setDialog(null)}>취소</button><button className="danger-button" disabled={messageBusy} onClick={() => void mutate('delete')}>{messageBusy ? '삭제 중…' : '영구 삭제'}</button></div></Modal>}
    {copyFallback && <Modal title="직접 복사" onClose={() => setCopyFallback(null)}><p className="field-hint">자동 복사가 차단되었습니다. 선택된 값을 복사할 수 있습니다.</p><input className="copy-fallback" aria-label={copyFallback.label} readOnly value={copyFallback.value} data-dialog-autofocus onFocus={event => event.target.select()} /><div className="modal-actions"><button className="primary-button" onClick={() => setCopyFallback(null)}>확인</button></div></Modal>}
    {toast && <Toast text={toast.text} undo={toast.undo} />}
  </div>;
}

function MailRow({ item, onClick, onCopyCode }: { item: MessageSummary; onClick: () => void; onCopyCode: () => void }) {
  return <article className={`mail-row ${item.is_read ? '' : 'unread'}`} data-message-id={item.id}><button className="row-open" onClick={onClick}>
    <span className="row-identity"><span className="row-sender">{!item.is_read && <span className="unread-dot" />}{item.sender_name || item.sender_address}</span><span className="row-recipient" title={item.recipient}>{item.recipient}</span></span>
    <span className="row-subject">{item.subject}{item.attachments.length > 0 && <Paperclip size={13} aria-label="첨부 파일 있음" />}</span>
  </button>{item.verification_code ? <button className="row-code" onClick={onCopyCode} aria-label={`${item.subject} 인증번호 복사`} title="인증번호 복사"><span>{item.verification_code}</span><Copy size={14} /></button> : <span className="row-code-spacer" />}<time className="row-time" dateTime={new Date(item.received_at).toISOString()}>{shortTime(item.received_at)}</time></article>;
}
