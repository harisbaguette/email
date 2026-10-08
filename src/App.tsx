import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Archive, Star, ListChecks, SlidersHorizontal, ChevronLeft, ChevronRight, ChevronDown, Copy, Download, Inbox, Mail, MailOpen, RefreshCw, Search, Settings, Trash2, Undo2, X, Paperclip, Megaphone, ArrowUpRight } from 'lucide-react';
import type { Folder, InboxResult, MailMessage, MessageSummary, MessageAction } from '../shared/types';
import { api, copyText, errorMessage } from './api';
import { ActionMenu, Brand, EmptyState, formatBytes, Login, Modal, Toast } from './components';
import { SettingsPage, type SettingsTab } from './Settings';
import { logout, clearBrowserPush } from './notifications';
import { EmailBody } from './EmailBody';
import { SearchDialog } from './SearchDialog';
import { verificationCode } from '../shared/verification';

const emptyInbox: InboxResult = { messages: [], addresses: [], counts: { verification: 0, starred: 0, archive: 0, inbox: 0, unread: 0, promotions: 0, all: 0, trash: 0 }, sorting: { enabled: false, pending: 0, delayed: 0 }, nextCursor: null };
const folderLabels: Record<Folder, string> = { inbox: '받은 메일', verification: '인증 메일', starred: '별표', archive: '보관함', unread: '안 읽은 메일', promotions: '광고와 소식', all: '전체 메일', trash: '휴지통' };
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' });
const fullDateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' });

function initialLocation() {
  const params = new URLSearchParams(location.search);
  const folder = params.get('folder');
  return { folder: (folder && ['verification', 'starred', 'archive', 'unread', 'promotions', 'all', 'trash'].includes(folder) ? folder : 'inbox') as Folder,
    settings: (['addresses', 'notifications', 'account', 'rules'].includes(params.get('settings') || '') ? params.get('settings') : params.has('new-address') ? 'addresses' : null) as SettingsTab | null,
    address: params.get('address') || '', query: params.get('q') || '', selected: params.get('message') || null };
}

function shortTime(time: number) {
  return new Date(time).toDateString() === new Date().toDateString() ? timeFormat.format(time) : dateFormat.format(time);
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [domain, setDomain] = useState('bluekite.co.kr');
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSessionError('');
    api<{ authenticated: boolean; domain: string }>('/api/session', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setAuthenticated(result.authenticated); setDomain(result.domain); } })
      .catch(error => { if (!controller.signal.aborted) { setSessionError(errorMessage(error)); } });
    const expired = () => { void clearBrowserPush(); setAuthenticated(false); setSessionError('로그인이 만료됐습니다. 다시 로그인해야 합니다.'); };
    window.addEventListener('session-expired', expired);
    return () => { controller.abort(); window.removeEventListener('session-expired', expired); };
  }, [sessionAttempt]);
  useEffect(() => {
    const retry = () => { if (authenticated === null && sessionError) setSessionAttempt(value => value + 1); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [authenticated, sessionError]);
  if (authenticated === null && sessionError) return <main className="session-recovery"><Brand /><h1>연결할 수 없습니다</h1><p role="alert">{sessionError}</p><button className="primary-button" onClick={() => setSessionAttempt(value => value + 1)}>다시 시도</button></main>;
  if (authenticated === null) return <div className="initial-loading"><Brand /><span className="loading-dot" /></div>;
  if (!authenticated) return <Login initialError={sessionError} onLogin={() => { setAuthenticated(true); setSessionError(''); }} />;
  return <Mailbox domain={domain} onLogout={() => setAuthenticated(false)} />;
}

function Mailbox({ domain, onLogout }: { domain: string; onLogout: () => void }) {
  const [view, setView] = useState(initialLocation);
  const { folder, address, query, selected, settings } = view;
  const currentView = useRef(view);
  currentView.current = view;
  const [search, setSearch] = useState(query);
  const [data, setData] = useState<InboxResult>(emptyInbox);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDelete, setBulkDelete] = useState<string[] | null>(null);
  const [searchDialog, setSearchDialog] = useState(false);
  const [linkReview, setLinkReview] = useState<{ url: string; host: string; sender: string } | null>(null);
  const [ruleDialog, setRuleDialog] = useState<string | null>(null);
  const [ruleBusy, setRuleBusy] = useState(false);
  const dataRef = useRef(data); dataRef.current = data;
  const inFlight = useRef(false);
  const scrollAnchor = useRef<{ id: string; top: number } | null>(null);
  const [listError, setListError] = useState('');
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [messageError, setMessageError] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageVersion, setMessageVersion] = useState(0);
  const [dialog, setDialog] = useState<'delete' | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [copyFallback, setCopyFallback] = useState<{ value: string; label: string } | null>(null);
  const requestVersion = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listScroll = useRef(0);
  const settingsScroll = useRef(0);
  const previousSettings = useRef(settings);
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
    const next = { ...currentView.current, ...changes };
    currentView.current = next;
    const params = new URLSearchParams();
    if (next.folder !== 'inbox') params.set('folder', next.folder);
    if (next.address) params.set('address', next.address);
    if (next.query) params.set('q', next.query);
    if (next.selected) params.set('message', next.selected);
    if (next.settings) params.set('settings', next.settings);
    const url = `${location.pathname}${params.size ? `?${params}` : ''}`;
    if (push) history.pushState({ mailDetail: !next.settings, settingsPage: Boolean(next.settings) }, '', url);
    else history.replaceState(next.settings && view.settings ? history.state : null, '', url);
    setView(next);
  }

  useEffect(() => {
    const pop = () => { const next = initialLocation(); if (next.selected && !selected && !settings) listScroll.current = window.scrollY; currentView.current = next; setView(next); setSearch(next.query); };
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (selected || settings) navigate({ selected: null, settings: null });
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('popstate', pop); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('keydown', key); };
  }, [view]);

  useEffect(() => {
    if (search === query || selected || settings) return;
    const timer = setTimeout(() => navigate({ query: search, selected: null }), 300);
    return () => clearTimeout(timer);
  }, [search, query, folder, address, selected, settings]);

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    if (anchor && !selected && !settings) {
      const row = document.querySelector(`[data-message-id="${CSS.escape(anchor.id)}"]`);
      if (row) window.scrollBy(0, row.getBoundingClientRect().top - anchor.top);
    }
    scrollAnchor.current = null;
  }, [data]);

  const refresh = useCallback(async (quiet = false, reset = false) => {
    const active = currentView.current;
    if (active.folder !== folder || active.address !== address || active.query !== query || (quiet && inFlight.current)) return;
    const version = ++requestVersion.current;
    inFlight.current = true;
    if (!quiet) setRefreshing(true);
    const oldest = reset ? undefined : dataRef.current.messages.at(-1);
    try {
      const params = new URLSearchParams({ folder, address, q: query });
      let result = await api<InboxResult>(`/api/inbox?${params}`);
      let messages = result.messages;
      // Refresh the entire opened window, including deletions and classification changes.
      // Keep fetching until the former oldest boundary, not just a fixed number of pages.
      while (oldest && result.nextCursor && messages.length) {
        const last = messages.at(-1)!;
        if (last.received_at < oldest.received_at || last.received_at === oldest.received_at && last.id <= oldest.id) break;
        if (version !== requestVersion.current) return;
        params.set('cursor', result.nextCursor);
        result = await api<InboxResult>(`/api/inbox?${params}`);
        messages = [...messages, ...result.messages.filter(item => !messages.some(old => old.id === item.id))];
      }
      if (version !== requestVersion.current || currentView.current.folder !== folder || currentView.current.address !== address || currentView.current.query !== query) return;
      if (!currentView.current.selected && !currentView.current.settings && window.scrollY > 100) {
        const row = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].find(element => element.getBoundingClientRect().bottom > 0);
        if (row) scrollAnchor.current = { id: row.dataset.messageId!, top: row.getBoundingClientRect().top };
      }
      const next = { ...result, messages };
      dataRef.current = next; setData(next); setListError('');
      setChecked(previous => new Set([...previous].filter(id => messages.some(item => item.id === id))));
    } catch (error) {
      if (version === requestVersion.current) setListError(errorMessage(error));
    } finally {
      if (version === requestVersion.current) { inFlight.current = false; setLoading(false); setRefreshing(false); }
    }
  }, [folder, address, query]);

  useEffect(() => {
    setLoading(true); setChecked(new Set()); setSelecting(false);
    const next = { ...dataRef.current, messages: [], nextCursor: null };
    dataRef.current = next; setData(next); void refresh(false, true);
  }, [refresh]);
  useEffect(() => {
    const poll = () => { if (!document.hidden && navigator.onLine) void refresh(true); };
    const timer = setInterval(poll, 10000);
    document.addEventListener('visibilitychange', poll); window.addEventListener('online', poll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); window.removeEventListener('online', poll); };
  }, [refresh]);

  useEffect(() => {
    const arrived = (event: MessageEvent) => { if (event.data?.type === 'mail-arrived') void refresh(true); };
    navigator.serviceWorker?.addEventListener('message', arrived);
    return () => navigator.serviceWorker?.removeEventListener('message', arrived);
  }, [refresh]);
  useLayoutEffect(() => {
    if (settings) { window.scrollTo(0, 0); document.querySelector<HTMLElement>('.settings-title h1')?.focus({ preventScroll: true }); }
    else if (previousSettings.current) {
      window.scrollTo(0, settingsScroll.current);
      document.querySelector<HTMLElement>('.settings-entry')?.focus({ preventScroll: true });
    }
    previousSettings.current = settings;
  }, [settings]);

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
          if (!controller.signal.aborted) { setMessage({ ...result, is_read: 1 }); void refresh(); }
        } catch (error) { if (!controller.signal.aborted) notify(errorMessage(error)); }
      }
    }).catch(error => { if (!controller.signal.aborted) setMessageError(errorMessage(error)); });
    return () => controller.abort();
  }, [selected, messageVersion]);

  async function more() {
    if (!data.nextCursor || inFlight.current) return;
    inFlight.current = true;
    const version = requestVersion.current;
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ folder, address, q: query, cursor: data.nextCursor });
      const result = await api<InboxResult>(`/api/inbox?${params}`);
      if (version !== requestVersion.current) return;
      setData(previous => ({ ...result, messages: [...previous.messages, ...result.messages.filter(m => !previous.messages.some(p => p.id === m.id))] }));
      setListError('');
    } catch (error) { if (version === requestVersion.current) setListError(errorMessage(error)); }
    finally { if (version === requestVersion.current) { inFlight.current = false; setRefreshing(false); } }
  }

  async function copy(address: string) {
    try { await copyText(address); notify(`${address} 복사됨`); }
    catch { setCopyFallback({ value: address, label: '이메일 주소' }); }
  }

  function chooseFolder(folder: Folder, address = '') {
    listScroll.current = 0;
    setSearch(''); navigate({ folder, address, selected: null, query: '', settings: null });
  }

  function back() {
    if (history.state?.mailDetail) history.back();
    else navigate({ selected: null });
  }

  async function mutate(action: MessageAction | 'delete') {
    if (!message || messageBusy) return;
    const id = message.id; setMessageBusy(true);
    try {
      await api(`/api/messages/${id}`, { method: action === 'delete' ? 'DELETE' : 'PATCH', body: action === 'delete' ? undefined : JSON.stringify({ action }) });
      if (currentView.current.selected !== id) { await refresh(true); return; }
      if (action === 'inbox' || action === 'promotions') {
        navigate({ selected: null });
        notify(action === 'inbox' ? '받은 메일로 옮겼습니다.' : '광고와 소식으로 옮겼습니다.');
      } else if (action === 'archive' || action === 'unarchive') {
        navigate({ selected: null }); notify(action === 'archive' ? '보관함으로 옮겼습니다.' : '보관을 해제했습니다.');
      } else if (action === 'star' || action === 'unstar') {
        setMessage({ ...message, is_starred: Number(action === 'star') });
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

  async function bulk(action: MessageAction | 'delete', ids = [...checked]) {
    if (bulkBusy || !ids.length) return;
    setBulkBusy(true);
    const undoIds = action === 'archive' ? ids.filter(id => !dataRef.current.messages.find(item => item.id === id)?.archived_at) : ids;
    try {
      await api('/api/messages/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) });
      setChecked(new Set()); setBulkDelete(null); setSelecting(false);
      notify(`${ids.length}통을 처리했습니다.`, (action === 'trash' || action === 'archive') && undoIds.length ? () => {
        void api('/api/messages/bulk', { method: 'POST', body: JSON.stringify({ ids: undoIds, action: action === 'trash' ? 'restore' : 'unarchive' }) })
          .then(() => { notify('되돌렸습니다.'); void refresh(true); }).catch(error => notify(errorMessage(error)));
      } : undefined);
      await refresh();
    } catch (error) { notify(errorMessage(error)); }
    finally { setBulkBusy(false); }
  }
  const messageIndex = data.messages.findIndex(item => item.id === selected);
  function adjacent(offset: number) {
    const item = data.messages[messageIndex + offset];
    if (item) navigate({ selected: item.id });
  }
  async function addRule(action: 'inbox' | 'promotions' | 'trash') {
    if (!ruleDialog || ruleBusy) return;
    setRuleBusy(true);
    try {
      await api('/api/rules', { method: 'POST', body: JSON.stringify({ sender: ruleDialog, action }) });
      setRuleDialog(null); notify('앞으로 받는 메일에 적용합니다.');
    } catch (error) { notify(errorMessage(error)); }
    finally { setRuleBusy(false); }
  }
  const code = message ? verificationCode(message.subject, message.body_text) : null;
  async function copyCode(value: string) {
    try { await copyText(value); notify('복사됨'); }
    catch { setCopyFallback({ value, label: '인증번호' }); }
  }
  return <div className="mail-app">
    <header className="app-header"><button className="brand-home" onClick={() => chooseFolder('inbox')} aria-label="받은 메일로 이동"><Brand /></button>
      <div className="app-actions">{!settings && <button className="text-button settings-entry" onClick={() => { settingsScroll.current = window.scrollY; navigate({ settings: 'addresses' }, true); }} aria-label="설정"><Settings size={18} />설정</button>}</div>
    </header>
    {settings && <SettingsPage loading={loading} error={listError} onRetry={() => void refresh()} domain={domain} addresses={data.addresses} tab={settings} createInitially={new URLSearchParams(location.search).has('new-address')} onTab={tab => navigate({ settings: tab })} onClose={() => { if (history.state?.settingsPage) history.back(); else navigate({ settings: null }); }} onCreated={() => void refresh()} onSelect={value => chooseFolder('all', value)} onLogout={() => { void logout().then(onLogout).catch(error => notify(errorMessage(error))); }} />}
    <main hidden={Boolean(settings)} className={`workspace ${selected ? 'detail-open' : ''}`}>
      {listError && <div className="connection-error" role="alert"><span>{listError}</span><button onClick={() => void refresh()}>다시 시도</button></div>}
      {!online && <div className="connection-error" role="status">오프라인입니다.</div>}
      <section className="mail-list" aria-label="메일 목록" hidden={Boolean(selected)}>
        <div className="list-heading"><h1 className="sr-only">{folderLabels[folder]}</h1><div className="folder-picker"><select aria-label="메일함" value={folder} onChange={event => chooseFolder(event.target.value as Folder)}>{Object.entries(folderLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown size={17} /></div>
          <div className="list-tools"><div className="search-field"><Search size={17} /><input ref={searchRef} type="search" aria-label="메일 검색" placeholder="검색" value={search} onChange={event => setSearch(event.target.value)} /></div><button className="icon-button" aria-label="상세 검색" title="상세 검색" onClick={() => setSearchDialog(true)}><SlidersHorizontal size={17} /></button><button className="icon-button" aria-label={selecting ? '선택 취소' : '메일 선택'} title={selecting ? '선택 취소' : '메일 선택'} aria-pressed={selecting} onClick={() => { setSelecting(value => !value); setChecked(new Set()); }}><ListChecks size={17} /></button><button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={() => void refresh()} aria-label="새로고침" title="새로고침" disabled={refreshing}><RefreshCw size={17} /></button></div>
        </div>
        {selecting && <div className="bulk-toolbar" aria-label="선택한 메일 작업"><label className="selection-label"><input type="checkbox" aria-label="현재 목록 선택" checked={data.messages.length > 0 && data.messages.slice(0, 100).every(item => checked.has(item.id))} onChange={event => setChecked(new Set(event.target.checked ? data.messages.slice(0, 100).map(item => item.id) : []))} /><span>{checked.size}통</span></label>
          <button className="icon-button" disabled={!checked.size || bulkBusy} aria-label="선택한 메일 읽음" title="읽음" onClick={() => void bulk('read')}><MailOpen size={17} /></button>
          <button className="icon-button" disabled={!checked.size || bulkBusy} aria-label="선택한 메일 별표" title="별표" onClick={() => void bulk('star')}><Star size={17} /></button>
          <button className="icon-button" disabled={!checked.size || bulkBusy} aria-label={folder === 'trash' ? '선택한 메일 복원' : '선택한 메일 보관'} title={folder === 'trash' ? '복원' : '보관'} onClick={() => void bulk(folder === 'trash' ? 'restore' : 'archive')}>{folder === 'trash' ? <Undo2 size={17} /> : <Archive size={17} />}</button>
          <button className="icon-button danger-hover" disabled={!checked.size || bulkBusy} aria-label="선택한 메일 삭제" title="삭제" onClick={() => folder === 'trash' ? setBulkDelete([...checked]) : void bulk('trash')}><Trash2 size={17} /></button>
          <ActionMenu label="선택한 메일 더 보기"><button disabled={!checked.size || bulkBusy} onClick={() => void bulk('unread')}>안 읽음으로 표시</button><button disabled={!checked.size || bulkBusy} onClick={() => void bulk('unstar')}>별표 해제</button><button disabled={!checked.size || bulkBusy} onClick={() => void bulk('unarchive')}>보관 해제</button><button disabled={!checked.size || bulkBusy} onClick={() => void bulk('promotions')}>광고와 소식으로 이동</button><button disabled={!checked.size || bulkBusy} onClick={() => void bulk('inbox')}>받은 메일로 이동</button></ActionMenu>
        </div>}
        {address && <div className="active-filter"><button onClick={() => void copy(address)} title="주소 복사">{address}<Copy size={14} /></button><button className="icon-button" aria-label="주소 필터 해제" onClick={() => chooseFolder('inbox')}><X size={15} /></button></div>}
        <div className="list-scroll" aria-busy={loading}>
          {loading ? <div className="list-loading" role="status">불러오는 중…</div>
            : data.messages.length ? data.messages.map(item => <MailRow key={item.id} item={item} selecting={selecting} checked={checked.has(item.id)} onCheck={() => setChecked(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else if (next.size < 100) next.add(item.id); else notify('한 번에 100통까지 선택할 수 있습니다.'); return next; })} onClick={() => { listScroll.current = window.scrollY; navigate({ selected: item.id }, true); }} onCopyCode={() => void copyCode(item.verification_code!)} />)
              : !listError && <EmptyState query={query} />}
          {!loading && data.nextCursor && <button className="load-more" onClick={() => void more()} disabled={refreshing}>{refreshing ? '불러오는 중…' : '더 보기'}</button>}
        </div>
      </section>
      {selected && <section className="reading-pane" aria-label="메일 상세">
        <div className="reading-toolbar"><button className="text-button back-button" onClick={back} aria-label="메일 목록으로"><ArrowLeft size={18} />목록</button>
          {message && <div className="reading-actions">
            <button className="icon-button" aria-label="이전 메일" title="이전 메일" disabled={messageIndex <= 0} onClick={() => adjacent(-1)}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="다음 메일" title="다음 메일" disabled={messageIndex < 0 || messageIndex >= data.messages.length - 1} onClick={() => adjacent(1)}><ChevronRight size={18} /></button>
            <button className={`icon-button ${message.is_starred ? 'starred' : ''}`} aria-label={message.is_starred ? '별표 해제' : '별표 표시'} title="별표" disabled={messageBusy} onClick={() => void mutate(message.is_starred ? 'unstar' : 'star')}><Star size={18} fill={message.is_starred ? 'currentColor' : 'none'} /></button>
            {message.deleted_at !== null && <button className="icon-button" aria-label="수신함으로 복원" title="수신함으로 복원" disabled={messageBusy} onClick={() => void mutate('restore')}><Undo2 size={18} /></button>}
            <button className="icon-button danger-hover" aria-label={message.deleted_at !== null ? '영구 삭제' : '휴지통으로 이동'} title={message.deleted_at !== null ? '영구 삭제' : '휴지통으로 이동'} disabled={messageBusy} onClick={() => message.deleted_at !== null ? setDialog('delete') : void mutate('trash')}><Trash2 size={18} /></button>
            <ActionMenu label="메일 작업">
              {message.deleted_at === null && <button disabled={messageBusy} onClick={() => void mutate(message.archived_at ? 'unarchive' : 'archive')}><Archive size={16} />{message.archived_at ? '보관 해제' : '보관함으로 이동'}</button>}
              <button onClick={() => setRuleDialog(message.sender_address)}><SlidersHorizontal size={16} />이 발신자 자동 정리</button>
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
            {message.verification_link && <a className="verification-link" href={message.verification_link.url} onClick={event => {
              const senderDomain = message.sender_address.split('@').at(-1)?.toLowerCase() || '';
              const host = message.verification_link!.host.toLowerCase();
              if (!senderDomain || !(host === senderDomain || host.endsWith('.' + senderDomain))) { event.preventDefault(); setLinkReview({ ...message.verification_link!, sender: message.sender_address }); }
            }} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label="이메일 확인 링크 열기"><span>인증하기 <ArrowUpRight size={16} /></span><small>{message.verification_link.host}</small></a>}
          </div>}
          {message.attachments.length > 0 && <div className="attachments">{message.attachments.map(file => <a key={file.index} href={`/api/messages/${message.id}/attachments/${file.index}`} download className="attachment"><Paperclip size={15} /><span>{file.filename}</span><small>{formatBytes(file.size)}</small></a>)}</div>}
          <EmailBody key={message.id} message={message} /></>}
      </section>}
    </main>
    {linkReview && <Modal title="링크 주소 확인" onClose={() => setLinkReview(null)}><p className="delete-description">보낸 주소와 다른 도메인으로 이동합니다.</p><dl className="link-review"><dt>보낸 주소</dt><dd>{linkReview.sender}</dd><dt>이동할 사이트</dt><dd><strong>{linkReview.host}</strong></dd></dl><div className="modal-actions"><button className="secondary-button" autoFocus onClick={() => setLinkReview(null)}>취소</button><a className="primary-button" href={linkReview.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={() => setLinkReview(null)}>사이트 열기<ArrowUpRight size={16} /></a></div></Modal>}
    {searchDialog && <SearchDialog query={search} onClose={() => setSearchDialog(false)} onSearch={value => { setSearch(value); navigate({ query: value, selected: null }); setSearchDialog(false); }} />}
    {bulkDelete && <Modal title={`${bulkDelete.length}통을 영구 삭제할까요?`} onClose={() => { if (!bulkBusy) setBulkDelete(null); }}><p className="delete-description">선택한 메일과 첨부 파일은 복원할 수 없습니다.</p><div className="modal-actions"><button className="secondary-button" disabled={bulkBusy} onClick={() => setBulkDelete(null)}>취소</button><button className="danger-button" disabled={bulkBusy} onClick={() => void bulk('delete', bulkDelete)}>영구 삭제</button></div></Modal>}
    {ruleDialog && <Modal title="이 발신자 자동 정리" onClose={() => { if (!ruleBusy) setRuleDialog(null); }}><p className="rule-sender">{ruleDialog}</p><p className="field-hint">앞으로 받는 메일에 적용합니다. 설정에서 해제할 수 있습니다.</p><div className="rule-choices"><button className="secondary-button" disabled={ruleBusy} onClick={() => void addRule('inbox')}>항상 받은 메일로</button><button className="secondary-button" disabled={ruleBusy} onClick={() => void addRule('promotions')}>항상 광고와 소식으로</button><button className="secondary-button" disabled={ruleBusy} onClick={() => void addRule('trash')}>항상 휴지통으로</button></div></Modal>}
    {dialog === 'delete'  && <Modal title="메일을 영구 삭제할까요?" onClose={() => setDialog(null)}><p className="delete-description">메일과 첨부 파일이 삭제되며 복원할 수 없습니다.</p><div className="modal-actions"><button className="secondary-button" autoFocus onClick={() => setDialog(null)}>취소</button><button className="danger-button" disabled={messageBusy} onClick={() => void mutate('delete')}>{messageBusy ? '삭제 중…' : '영구 삭제'}</button></div></Modal>}
    {copyFallback && <Modal title="직접 복사" onClose={() => setCopyFallback(null)}><p className="field-hint">자동 복사가 차단되었습니다. 선택된 값을 복사할 수 있습니다.</p><input className="copy-fallback" aria-label={copyFallback.label} readOnly value={copyFallback.value} data-dialog-autofocus onFocus={event => event.target.select()} /><div className="modal-actions"><button className="primary-button" onClick={() => setCopyFallback(null)}>확인</button></div></Modal>}
    {toast && <Toast text={toast.text} undo={toast.undo} />}
  </div>;
}

function MailRow({ item, onClick, onCopyCode, selecting, checked, onCheck }: { selecting: boolean; checked: boolean; onCheck: () => void; item: MessageSummary; onClick: () => void; onCopyCode: () => void }) {
  return <article className={`mail-row ${item.is_read ? '' : 'unread'} ${selecting ? 'selecting' : ''} ${checked ? 'is-selected' : ''}`} data-message-id={item.id}>{selecting && <label className="row-selection"><input type="checkbox" aria-label={`${item.subject} 선택`} checked={checked} onChange={onCheck} /></label>}<button className="row-open" onClick={onClick}>
    <span className="row-identity"><span className="row-sender">{!item.is_read && <span className="unread-dot" />}{Boolean(item.is_starred) && <Star size={12} className="starred" fill="currentColor" />}{item.sender_name || item.sender_address}</span><span className="row-recipient" title={item.recipient}>{item.recipient}</span></span>
    <span className="row-subject">{item.subject}{item.attachments.length > 0 && <Paperclip size={13} aria-label="첨부 파일 있음" />}</span>
  </button>{item.verification_code ? <button className="row-code" onClick={onCopyCode} aria-label={`${item.subject} 인증번호 복사`} title="인증번호 복사"><span>{item.verification_code}</span><Copy size={14} /></button> : <span className="row-code-spacer" />}<time className="row-time" dateTime={new Date(item.received_at).toISOString()}>{shortTime(item.received_at)}</time></article>;
}
