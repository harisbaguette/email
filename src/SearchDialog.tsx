import { useState } from 'react';
import { Modal } from './components';
export function SearchDialog({ query, onClose, onSearch }: { query: string; onClose: () => void; onSearch: (query: string) => void }) {
  const [text, setText] = useState(query);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [after, setAfter] = useState(''); const [before, setBefore] = useState('');
  const [attachment, setAttachment] = useState(false);
  return <Modal title="상세 검색" onClose={onClose}><form className="search-options" onSubmit={event => {
    event.preventDefault();
    const quote = (value: string) => `"${value.replaceAll('"', '')}"`;
    onSearch([text, from && `from:${quote(from)}`, to && `to:${quote(to)}`, after && `after:${after}`, before && `before:${before}`, attachment && 'has:attachment'].filter(Boolean).join(' '));
  }}><label htmlFor="search-words">검색어</label><input id="search-words" value={text} onChange={event => setText(event.target.value)} autoFocus />
    <label htmlFor="search-from">보낸 사람</label><input id="search-from" value={from} onChange={event => setFrom(event.target.value)} />
    <label htmlFor="search-to">받는 주소</label><input id="search-to" value={to} onChange={event => setTo(event.target.value)} />
    <div className="search-date-range"><div><label htmlFor="search-after">이 날짜부터</label><input id="search-after" type="date" value={after} onChange={event => setAfter(event.target.value)} /></div><div><label htmlFor="search-before">이 날짜 전까지</label><input id="search-before" type="date" value={before} onChange={event => setBefore(event.target.value)} /></div></div>
    <label className="selection-label"><input type="checkbox" checked={attachment} onChange={event => setAttachment(event.target.checked)} />첨부 파일 있음</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>취소</button><button className="primary-button">검색</button></div></form></Modal>;
}
