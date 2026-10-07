import { useState } from 'react';
import { Image, AlignLeft } from 'lucide-react';
import type { MailMessage } from '../shared/types';

function PlainText({ text }: { text: string }) {
  return <div className="plain-body">{text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a href={part} key={index} target="_blank" rel="noopener noreferrer">{part}</a>
      : part,
  )}</div>;
}

export function EmailBody({ message }: { message: MailMessage }) {
  const [images, setImages] = useState(false);
  const [plain, setPlain] = useState(false);
  const hasHtml = Boolean(message.body_html);
  return <div className="email-content">
    {hasHtml && <div className="body-options">
      <button className="text-button" onClick={() => setPlain(v => !v)}><AlignLeft size={15} />{plain ? '원래 서식' : '텍스트로 보기'}</button>
      {!plain && !images && <button className="text-button" onClick={() => setImages(true)}><Image size={15} />외부 이미지 표시</button>}
    </div>}
    {message.body_truncated === 1 && <p className="inline-notice">긴 메일의 일부만 표시합니다. 전체 내용은 원본 파일에서 확인할 수 있어요.</p>}
    {hasHtml && !plain
      ? <iframe key={String(images)} title="메일 본문" className="email-frame" src={`/api/messages/${message.id}/body${images ? '?images=1' : ''}`}
          sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
      : <PlainText text={message.body_text || '텍스트 본문이 없는 메일입니다.'} />}
  </div>;
}
