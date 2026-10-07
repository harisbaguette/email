import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Copy, Download, Inbox, LogOut, Mail, MailOpen, Menu, Plus, RefreshCw, Search, Settings, Trash2, Undo2, X, Paperclip, Megaphone, Mails } from 'lucide-react';
import type { Folder, InboxResult, MailMessage, MessageSummary } from '../shared/types';
import { api, copyText, errorMessage } from './api';
import { AddressDialog, Brand, EmptyState, formatBytes, Login, Modal, SettingsDialog, Toast } from './components';
import { EmailBody } from './EmailBody';
import { verificationCode } from '../shared/verification';

const emptyInbox: InboxResult = { messages: [], addresses: [], counts: { inbox: 0, unread: 0, promotions: 0, all: 0, trash: 0 }, sorting: { enabled: false, pending: 0, delayed: 0 }, nextCursor: null };
const folderLabels: Record<Folder, string> = { inbox: '받은 메일', unread: '안 읽은 메일', promotions: '광고·소식', all: '전체 메일', trash: '휴지통' };
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
    const expired = () => { setAuthenticated(false); setSessionError('로그인이 만료됐어요. 다시 로그인해 주세요.'); };
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dialog, setDialog] = useState<'address' | 'settings' | 'delete' | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [addressSearch, setAddressSearch] = useState('');
  const requestVersion = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current); setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 10000 : 4200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button, input') || [])
        .filter(element => element.getClientRects().length > 0);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); previous?.focus(); };
  }, [sidebarOpen]);

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
    const pop = () => { const next = initialLocation(); setView(next); setSearch(next.query); };
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener('popstate', pop); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('keydown', key); };
  }, []);

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
    catch { notify(`복사하지 못했어요. 주소: ${address}`); }
  }

  function chooseFolder(folder: Folder, address = '') {
    setSearch(''); navigate({ folder, address, selected: null, query: '' }); setSidebarOpen(false);
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
        notify(action === 'inbox' ? '받은 메일로 옮겼어요.' : '광고·소식으로 옮겼어요.');
      } else if (action === 'trash' || action === 'restore' || action === 'delete') {
        navigate({ selected: null }); setDialog(null);
        notify(action === 'trash' ? '휴지통으로 이동했어요.' : action === 'restore' ? `${message.category === 'promotions' ? '광고·소식' : '받은 메일'}으로 복원했어요.` : '메일을 영구 삭제했어요.',
          action === 'trash' ? () => { void api(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'restore' }) })
            .then(() => { notify('메일을 복원했어요.'); void refresh(true); }).catch(e => notify(errorMessage(e))); } : undefined);
      } else setMessage({ ...message, is_read: Number(action === 'read') });
      await refresh(true);
    } catch (error) { notify(errorMessage(error)); }
    finally { setMessageBusy(false); }
  }

  const visibleAddresses = data.addresses.filter(a => a.address.includes(addressSearch.toLowerCase()));
  const code = message ? verificationCode(message.subject, message.body_text) : null;
  return <div className={`mail-app ${selected ? 'detail-open' : ''}`}>
    {sidebarOpen && <button className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-label="메뉴 닫기" />}
    <aside ref={sidebarRef} className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="sidebar-brand"><Brand /><button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} aria-label="메뉴 닫기"><X size={20} /></button></div>
      <button className="primary-button new-address" onClick={() => { setSidebarOpen(false); setDialog('address'); }}><Plus size={19} />주소 만들기</button>
      <nav aria-label="메일함" className="folder-nav">
        {([['inbox', Inbox], ['unread', Mail], ['promotions', Megaphone], ['all', Mails], ['trash', Trash2]] as const).map(([key, Icon]) =>
          <button key={key} className={`nav-item ${folder === key && !address ? 'active' : ''}`} onClick={() => chooseFolder(key)} aria-current={folder === key && !address ? 'page' : undefined}>
            <Icon size={19} /><span>{folderLabels[key]}</span><span className="nav-count">{data.counts[key]}</span>
          </button>)}
      </nav>
      <div className="address-section"><div className="section-label"><span>내 주소</span><span>{data.addresses.length}</span></div>
        {data.addresses.length > 8 && <input className="address-search" placeholder="주소 찾기" aria-label="주소 찾기" value={addressSearch} onChange={e => setAddressSearch(e.target.value)} />}
        <div className="address-nav">
          {visibleAddresses.map(item => <button className={`address-item ${address === item.address ? 'active' : ''}`} key={item.address}
            onClick={() => chooseFolder('all', item.address)} title={item.address} aria-current={address === item.address ? 'page' : undefined}>
            <span className="at-symbol">@</span><span className="address-name">{item.address.split('@')[0]}</span>{item.unread > 0 && <span className="address-unread">{item.unread}</span>}
          </button>)}
          {!loading && !data.addresses.length && <p className="no-addresses">만들거나 메일을 받은 주소가<br />여기에 표시됩니다.</p>}
        </div>
      </div>
      <footer className="sidebar-footer"><div className="domain-label"><span className="domain-dot" />{domain}</div>
        <div className="sidebar-footer-actions"><button className="text-button" onClick={() => { setSidebarOpen(false); setDialog('settings'); }}><Settings size={17} />설정</button>
          <button className="icon-button" aria-label="로그아웃" title="로그아웃" onClick={() => { void api('/api/logout', { method: 'POST' }).then(onLogout).catch(e => notify(errorMessage(e))); }}><LogOut size={18} /></button></div>
      </footer>
    </aside>
    <main className="workspace" inert={sidebarOpen}>
      <header className="workspace-header"><button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="메뉴 열기"><Menu size={21} /></button>
        <div className="workspace-heading"><h1>{address ? address.split('@')[0] : folderLabels[folder]}</h1>{address && <button className="icon-button heading-copy" aria-label="현재 주소 복사" onClick={() => void copy(address)}><Copy size={17} /></button>}</div>
        <button className="primary-button mobile-only header-create" onClick={() => setDialog('address')} aria-label="주소 만들기"><Plus size={17} />새 주소</button>
        <div className="search-field"><Search size={18} /><input ref={searchRef} type="search" placeholder="메일 검색" aria-label="메일 검색" value={search} onChange={e => setSearch(e.target.value)} /><kbd>⌘ K</kbd></div>
        <button className={`icon-button refresh-button ${refreshing ? 'spinning' : ''}`} onClick={() => void refresh()} aria-label="새로고침" title="새로고침" disabled={refreshing}><RefreshCw size={19} /></button>
      </header>
      {listError && <div className="connection-error" role="alert"><span>{listError}</span><button onClick={() => void refresh()}>다시 시도</button></div>}
      {data.sorting.enabled && data.sorting.delayed > 0 && <div className="sorting-notice" role="status">자동 정리가 지연되고 있어요. 메일은 받은 메일에 보관했고, 잠시 후 다시 정리합니다.</div>}
      <div className="mail-columns">
        <section className="mail-list" aria-label="메일 목록">
          <div className="list-toolbar"><span>{query ? `“${query}” 검색` : address || (folder === 'promotions' ? '광고와 뉴스레터 · 자동 삭제 없음' : folder === 'inbox' ? '모든 주소 · 광고는 자동으로 따로' : folder === 'all' ? '광고를 포함한 모든 주소' : folderLabels[folder])}</span><span>{loading ? '' : `${data.messages.length}${data.nextCursor ? '+' : ''}개`}</span></div>
          <div className="list-scroll" aria-busy={loading}>
            {loading ? <div className="list-loading" role="status">메일을 불러오는 중…</div>
              : data.messages.length ? data.messages.map(item => <MailRow key={item.id} item={item} selected={item.id === selected} onClick={() => navigate({ selected: item.id }, true)} />)
                : !listError && <EmptyState filtered={folder !== 'inbox' || Boolean(address)} waiting={Boolean(address)} query={query} onAdd={() => setDialog('address')} />}
            {!loading && data.nextCursor && <button className="load-more" onClick={() => void more()} disabled={refreshing}>{refreshing ? '불러오는 중…' : '이전 메일 더 보기'}</button>}
          </div>
        </section>
        <section className="reading-pane" aria-label="메일 상세">
          {selected ? <>
            <div className="reading-toolbar"><button className="icon-button back-button" onClick={back} aria-label="메일 목록으로"><ArrowLeft size={20} /></button>
              {message && <><div className="reading-actions">
                <button className="icon-button" aria-label={message.is_read ? '안 읽음으로 표시' : '읽음으로 표시'} title={message.is_read ? '안 읽음으로 표시' : '읽음으로 표시'} disabled={messageBusy} onClick={() => void mutate(message.is_read ? 'unread' : 'read')}>{message.is_read ? <Mail size={19} /> : <MailOpen size={19} />}</button>
                <a className="icon-button" href={`/api/messages/${message.id}/raw`} download aria-label="메일 원본 다운로드" title="원본 다운로드"><Download size={19} /></a>
                <span className="toolbar-divider" />
                {message.deleted_at !== null && <button className="icon-button" aria-label="수신함으로 복원" title="수신함으로 복원" disabled={messageBusy} onClick={() => void mutate('restore')}><Undo2 size={19} /></button>}
                <button className="icon-button danger-hover" aria-label={message.deleted_at !== null ? '영구 삭제' : '휴지통으로 이동'} title={message.deleted_at !== null ? '영구 삭제' : '휴지통으로 이동'} disabled={messageBusy} onClick={() => message.deleted_at !== null ? setDialog('delete') : void mutate('trash')}><Trash2 size={19} /></button>
              </div><span className="received-time">{shortTime(message.received_at)}</span></>}
            </div>
            {messageError ? <div className="detail-error" role="alert"><p>{messageError}</p><button className="secondary-button" onClick={() => setMessageVersion(v => v + 1)}>다시 시도</button></div>
              : !message ? <div className="list-loading" role="status">메일을 여는 중…</div>
                : <><div className="message-header"><h2>{message.subject}</h2><div className="sender-line"><span className="sender-avatar">{(message.sender_name || message.sender_address || '?')[0].toUpperCase()}</span><div className="sender-meta"><strong>{message.sender_name || message.sender_address}</strong>{message.sender_name && <span>{message.sender_address}</span>}</div></div>
                  <div className="recipient-line"><span>받는 사람</span><button onClick={() => void copy(message.recipient)} title="주소 복사">{message.recipient}<Copy size={13} /></button></div>
                  <div className="message-date">{fullDateFormat.format(message.received_at)}</div>
                  {message.deleted_at === null && <div className="category-control"><span>{message.category === 'promotions' ? '광고·소식' : '받은 메일'}{message.category_source === 'manual' ? ' · 직접 분류' : message.category === 'promotions' ? ' · 자동 정리됨' : ''}</span>
                    <button className="text-button" disabled={messageBusy} onClick={() => void mutate(message.category === 'promotions' ? 'inbox' : 'promotions')}>
                      {message.category === 'promotions' ? <Inbox size={15} /> : <Megaphone size={15} />}{message.category === 'promotions' ? '광고 아님' : '광고·소식으로 이동'}</button></div>}
                  {message.attachments.length > 0 && <div className="attachments">{message.attachments.map(file => <a key={file.index} href={`/api/messages/${message.id}/attachments/${file.index}`} download className="attachment"><Paperclip size={16} /><span>{file.filename}<small>{formatBytes(file.size)}</small></span><Download size={15} /></a>)}</div>}
                </div>{code && <div className="verification-code"><div><span>인증번호</span><strong>{code}</strong></div><button className="secondary-button" aria-label="인증번호 복사"
                  onClick={() => { void copyText(code).then(() => notify('인증번호를 복사했어요.')).catch(() => notify('복사하지 못했어요. 번호를 직접 선택해 주세요.')); }}><Copy size={16} />복사</button></div>}
                  <EmailBody key={message.id} message={message} /></>}
          </> : <div className="reading-placeholder"><div className="placeholder-mark"><MailOpen size={38} strokeWidth={1.3} /></div><h2>메일을 선택하세요</h2><p>모든 주소의 메일을 한곳에서.</p><div className="placeholder-domain">@{domain}</div></div>}
        </section>
      </div>
    </main>
    {dialog === 'address' && <AddressDialog domain={domain} onClose={() => { setDialog(null); void refresh(true); }} onCreated={newAddress => { setDialog(null); chooseFolder('inbox'); void refresh(true); notify(`${newAddress} 복사됨 · 메일은 여기로 도착해요`); }} />}
    {dialog === 'settings' && <SettingsDialog domain={domain} onClose={() => setDialog(null)} notify={notify} />}
    {dialog === 'delete' && <Modal title="메일을 영구 삭제할까요?" onClose={() => setDialog(null)}><p className="delete-description">메일과 첨부 파일이 삭제되며 복원할 수 없습니다.</p><div className="modal-actions"><button className="secondary-button" autoFocus onClick={() => setDialog(null)}>취소</button><button className="danger-button" disabled={messageBusy} onClick={() => void mutate('delete')}>{messageBusy ? '삭제 중…' : '영구 삭제'}</button></div></Modal>}
    {toast && <Toast text={toast.text} undo={toast.undo} />}
  </div>;
}

function MailRow({ item, selected, onClick }: { item: MessageSummary; selected: boolean; onClick: () => void }) {
  return <button className={`mail-row ${selected ? 'selected' : ''} ${item.is_read ? '' : 'unread'}`} onClick={onClick} aria-pressed={selected}>
    <div className="row-top"><span className="row-sender">{!item.is_read && <span className="unread-dot" />}{item.sender_name || item.sender_address}</span><time dateTime={new Date(item.received_at).toISOString()}>{shortTime(item.received_at)}</time></div>
    <div className="row-subject">{item.subject}</div><p className="row-preview">{item.preview}</p>
    <div className="row-bottom"><span className="recipient-tag">{item.recipient.split('@')[0]}<span>@{item.recipient.split('@')[1]}</span></span>{item.category === 'promotions' && <span className="promotion-tag">광고·소식</span>}{item.attachments.length > 0 && <Paperclip size={14} aria-label="첨부 파일 있음" />}<ChevronRight size={14} className="row-arrow" /></div>
  </button>;
}
