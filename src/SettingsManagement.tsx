import { useEffect, useRef, useState } from 'react';
import type { SenderRule, SessionInfo } from '../shared/types';
import { api, errorMessage } from './api';
import { ActionMenu, Modal } from './components';
import { Select } from './Select';

export function Devices({ active }: { active: boolean }) {
  const [items, setItems] = useState<SessionInfo[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<SessionInfo | 'others' | null>(null);
  async function load() { try { setItems((await api<{ sessions: SessionInfo[] }>('/api/sessions')).sessions); setError(''); } catch (error) { setError(errorMessage(error)); } }
  useEffect(() => { if (active) void load(); }, [active]);
  async function revoke() {
    if (!confirm || busy) return; setBusy(true);
    try { await api(`/api/sessions/${confirm === 'others' ? 'others' : confirm.id}`, { method: 'DELETE' }); setConfirm(null); await load(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="device-list"><h3>로그인한 기기</h3>{items.map(item => <div className="device-row" key={item.id}><div><strong>{item.device_name}{item.current && <span className="current-device">현재</span>}</strong><small>{new Date(item.last_seen_at || item.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></div>{!item.current && <button className="text-button" onClick={() => setConfirm(item)}>로그아웃</button>}</div>)}
    {items.some(item => !item.current) && <button className="text-button" onClick={() => setConfirm('others')}>다른 기기 모두 로그아웃</button>}
    {error && !confirm && <div className="settings-error" role="alert"><p>{error}</p><button className="text-button" onClick={() => void load()}>다시 시도</button></div>}
    {confirm && <Modal title={confirm === 'others' ? '다른 기기를 모두 로그아웃할까요?' : '이 기기를 로그아웃할까요?'} onClose={() => { if (!busy) setConfirm(null); }}><p className="delete-description">{confirm === 'others' ? '현재 기기를 제외한 모든 기기' : confirm.device_name}의 로그인과 알림 연결을 해제합니다.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>취소</button><button className="primary-button" disabled={busy} onClick={() => void revoke()}>로그아웃</button></div></Modal>}
  </div>;
}

export function Rules({ active }: { active: boolean }) {
  const [rules, setRules] = useState<SenderRule[]>([]);
  const [sender, setSender] = useState(''); const [action, setAction] = useState<SenderRule['action']>('promotions');
  const [adding, setAdding] = useState(false); const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(''); const [loading, setLoading] = useState(true);
  const [removed, setRemoved] = useState<SenderRule | null>(null); const [feedback, setFeedback] = useState('');
  const version = useRef(0);
  const labels = { inbox: '받은 메일', promotions: '광고와 소식', trash: '휴지통' };
  async function load() {
    const request = ++version.current;
    try { const result = await api<{ rules: SenderRule[] }>('/api/rules'); if (request === version.current) { setRules(result.rules); setLoadError(''); } }
    catch (error) { if (request === version.current) setLoadError(errorMessage(error)); }
    finally { if (request === version.current) setLoading(false); }
  }
  useEffect(() => { if (active) void load(); return () => { ++version.current; }; }, [active]);
  function open(rule?: SenderRule) {
    setEditing(Boolean(rule)); setSender(rule?.sender || ''); setAction(rule?.action || 'promotions'); setError(''); setAdding(true);
  }
  async function save(remove?: SenderRule, restore?: SenderRule) {
    if (busy) return; setBusy(true); setError(''); ++version.current;
    const value = remove || restore || { sender: sender.trim().toLowerCase(), action };
    try {
      await api('/api/rules', { method: remove ? 'DELETE' : 'POST', body: JSON.stringify(value) });
      setRules(previous => remove ? previous.filter(item => item.sender !== value.sender) : [{ ...value, created_at: Date.now() }, ...previous.filter(item => item.sender !== value.sender)]);
      if (!remove && !restore) { setAdding(false); setSender(''); }
      setRemoved(remove || null); setFeedback(remove ? '규칙을 해제했습니다.' : restore ? '규칙을 복원했습니다.' : '규칙을 저장했습니다.');
      setLoading(false); setLoadError('');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <><div className="settings-section-heading"><h2>자동 정리</h2><button className="primary-button" onClick={() => open()}>규칙 추가</button></div>
    <p className="field-hint rule-intro">지정한 발신자의 새 메일을 자동으로 옮깁니다.</p>
    {rules.map(rule => <div className="device-row" key={rule.sender}><div><strong>{rule.sender}</strong><small>{labels[rule.action]}로 이동</small></div><ActionMenu label={`${rule.sender} 규칙 관리`}><button disabled={busy} onClick={() => open(rule)}>수정</button><button disabled={busy} onClick={() => void save(rule)}>해제</button></ActionMenu></div>)}
    {!rules.length && !loadError && <p className="settings-empty" role={loading ? 'status' : undefined}>{loading ? '불러오는 중…' : '등록한 규칙이 없습니다.'}</p>}
    {loadError && <div className="settings-error" role="alert"><p>{loadError}</p><button className="text-button" onClick={() => void load()}>다시 시도</button></div>}
    {error && !adding && <p className="form-error" role="alert">{error}</p>}
    {feedback && <div className="rule-feedback" role="status"><span>{feedback}</span>{removed && <button className="text-button" disabled={busy} onClick={() => void save(undefined, removed)}>되돌리기</button>}</div>}
    {adding && <Modal title={editing ? '자동 정리 규칙 수정' : '자동 정리 규칙'} onClose={() => { if (!busy) setAdding(false); }}><form className="search-options" onSubmit={event => { event.preventDefault(); void save(); }}><label htmlFor="rule-sender">보낸 사람 이메일</label><input id="rule-sender" type="email" required readOnly={editing} value={sender} onChange={event => setSender(event.target.value)} autoFocus={!editing} autoCapitalize="none" spellCheck={false} /><label htmlFor="rule-action">이동할 메일함</label><Select<SenderRule['action']> id="rule-action" value={action} onChange={setAction} autoFocus={editing} options={[{ value: 'inbox', label: '받은 메일' }, { value: 'promotions', label: '광고와 소식' }, { value: 'trash', label: '휴지통' }]} />{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setAdding(false)}>취소</button><button className="primary-button" disabled={busy}>{busy ? '저장 중…' : editing ? '저장' : '추가'}</button></div></form></Modal>}
  </>;
}
