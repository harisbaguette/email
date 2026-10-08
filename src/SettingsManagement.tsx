import { useEffect, useState } from 'react';
import type { SenderRule, SessionInfo } from '../shared/types';
import { api, errorMessage } from './api';
import { Modal } from './components';

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
  const [sender, setSender] = useState(''); const [action, setAction] = useState('promotions');
  const [adding, setAdding] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const labels = { inbox: '받은 메일', promotions: '광고와 소식', trash: '휴지통' };
  async function load() { try { setRules((await api<{ rules: SenderRule[] }>('/api/rules')).rules); setError(''); } catch (error) { setError(errorMessage(error)); } }
  useEffect(() => { if (active) void load(); }, [active]);
  async function save(remove?: string) {
    if (busy) return; setBusy(true);
    try { await api('/api/rules', { method: remove ? 'DELETE' : 'POST', body: JSON.stringify({ sender: remove || sender, action }) }); if (!remove) { setAdding(false); setSender(''); } await load(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <><div className="settings-section-heading"><h2>자동 정리</h2><button className="primary-button" onClick={() => setAdding(true)}>규칙 추가</button></div>
    <p className="field-hint rule-intro">지정한 발신자의 새 메일을 자동으로 옮깁니다.</p>
    {rules.map(rule => <div className="device-row" key={rule.sender}><div><strong>{rule.sender}</strong><small>{labels[rule.action]}로 이동</small></div><button className="text-button" disabled={busy} onClick={() => void save(rule.sender)}>해제</button></div>)}
    {!rules.length && !error && <p className="settings-empty">등록한 규칙이 없습니다.</p>}
    {error && !adding && <div className="settings-error" role="alert"><p>{error}</p><button className="text-button" onClick={() => void load()}>다시 시도</button></div>}
    {adding && <Modal title="자동 정리 규칙" onClose={() => { if (!busy) setAdding(false); }}><form className="search-options" onSubmit={event => { event.preventDefault(); void save(); }}><label htmlFor="rule-sender">보낸 사람 이메일</label><input id="rule-sender" type="email" required value={sender} onChange={event => setSender(event.target.value)} autoFocus /><label htmlFor="rule-action">이동할 메일함</label><select id="rule-action" value={action} onChange={event => setAction(event.target.value)}><option value="inbox">받은 메일</option><option value="promotions">광고와 소식</option><option value="trash">휴지통</option></select>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setAdding(false)}>취소</button><button className="primary-button" disabled={busy}>추가</button></div></form></Modal>}
  </>;
}
