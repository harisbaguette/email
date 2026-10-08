import { useState } from 'react';
import { Modal } from './components';
import { SEARCH_LIMIT, searchFields, searchQuery, shiftSearchDate } from '../shared/search';
export function SearchDialog({ query, onClose, onSearch }: { query: string; onClose: () => void; onSearch: (query: string) => void }) {
  const [fields, setFields] = useState(() => searchFields(query));
  const [error, setError] = useState('');
  const update = (key: keyof typeof fields, value: string | boolean) => { setFields(previous => ({ ...previous, [key]: value })); setError(''); };
  return <Modal title="상세 검색" onClose={onClose}><form className="search-options" onSubmit={event => {
    event.preventDefault();
    if (fields.after && fields.through && fields.after > fields.through) { setError('마지막 날짜를 시작 날짜 이후로 선택해 주세요.'); return; }
    if (fields.through && !shiftSearchDate(fields.through, 1)) { setError('검색 날짜를 확인해 주세요.'); return; }
    const result = searchQuery(fields);
    if (result.length > SEARCH_LIMIT) { setError(`검색 조건은 ${SEARCH_LIMIT}자까지 입력할 수 있습니다.`); return; }
    onSearch(result);
  }}><label htmlFor="search-words">검색어</label><input id="search-words" value={fields.text} maxLength={SEARCH_LIMIT} onChange={event => update('text', event.target.value)} autoFocus />
    <label htmlFor="search-from">보낸 사람</label><input id="search-from" value={fields.from} onChange={event => update('from', event.target.value)} />
    <label htmlFor="search-to">받는 주소</label><input id="search-to" value={fields.to} onChange={event => update('to', event.target.value)} />
    <div className="search-date-range"><div><label htmlFor="search-after">이 날짜부터</label><input id="search-after" type="date" value={fields.after} onChange={event => update('after', event.target.value)} /></div><div><label htmlFor="search-through">이 날짜까지</label><input id="search-through" type="date" value={fields.through} onChange={event => update('through', event.target.value)} /></div></div>
    <label className="selection-label"><input type="checkbox" checked={fields.attachment} onChange={event => update('attachment', event.target.checked)} />첨부 파일 있음</label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="text-button search-reset" type="button" onClick={() => { setFields(searchFields('')); setError(''); }}>초기화</button><button className="secondary-button" type="button" onClick={onClose}>취소</button><button className="primary-button">검색</button></div></form></Modal>;
}
