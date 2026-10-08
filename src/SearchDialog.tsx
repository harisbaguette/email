import { Field, Button, Checkbox, Modal, Notice, TextInput } from './ui';
import { useState } from 'react';

import { SEARCH_LIMIT, searchFields, searchQuery, shiftSearchDate } from '../shared/search';
export function SearchDialog({
  query,
  onClose,
  onSearch,
}: {
  query: string;
  onClose: () => void;
  onSearch: (query: string) => void;
}) {
  const [fields, setFields] = useState(() => searchFields(query));
  const [error, setError] = useState('');
  const update = (key: keyof typeof fields, value: string | boolean) => {
    setFields((previous) => ({ ...previous, [key]: value }));
    setError('');
  };
  return (
    <Modal title="상세 검색" onClose={onClose}>
      <form
        className="search-options"
        onSubmit={(event) => {
          event.preventDefault();
          if (fields.after && fields.through && fields.after > fields.through) {
            setError('마지막 날짜를 시작 날짜 이후로 선택해 주세요.');
            return;
          }
          if (fields.through && !shiftSearchDate(fields.through, 1)) {
            setError('검색 날짜를 확인해 주세요.');
            return;
          }
          const result = searchQuery(fields);
          if (result.length > SEARCH_LIMIT) {
            setError(`검색 조건은 ${SEARCH_LIMIT}자까지 입력할 수 있습니다.`);
            return;
          }
          onSearch(result);
        }}
      >
        <Field label="검색어" id="search-words">
          <TextInput
            id="search-words"
            value={fields.text}
            maxLength={SEARCH_LIMIT}
            onChange={(event) => update('text', event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="보낸 사람" id="search-from">
          <TextInput
            id="search-from"
            value={fields.from}
            onChange={(event) => update('from', event.target.value)}
          />
        </Field>
        <Field label="받는 주소" id="search-to">
          <TextInput
            id="search-to"
            value={fields.to}
            onChange={(event) => update('to', event.target.value)}
          />
        </Field>
        <div className="search-date-range">
          <div>
            <Field label="이 날짜부터" id="search-after">
              <TextInput
                id="search-after"
                type="date"
                value={fields.after}
                onChange={(event) => update('after', event.target.value)}
              />
            </Field>
          </div>
          <div>
            <Field label="이 날짜까지" id="search-through">
              <TextInput
                id="search-through"
                type="date"
                value={fields.through}
                onChange={(event) => update('through', event.target.value)}
              />
            </Field>
          </div>
        </div>
        <label className="selection-label">
          <Checkbox
            checked={fields.attachment}
            onChange={(event) => update('attachment', event.target.checked)}
          />
          첨부 파일 있음
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-actions">
          <Button
            variant="ghost"
            className="search-reset"
            type="button"
            onClick={() => {
              setFields(searchFields(''));
              setError('');
            }}
          >
            초기화
          </Button>
          <Button variant="secondary" type="button" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant="primary">
            검색
          </Button>
        </div>
      </form>
    </Modal>
  );
}
