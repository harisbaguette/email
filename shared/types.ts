export interface AttachmentMeta {
  index: number;
  filename: string;
  mimeType: string;
  size: number;
}

export interface MessageSummary {
  id: string;
  recipient: string;
  sender_address: string;
  sender_name: string;
  subject: string;
  preview: string;
  received_at: number;
  is_read: number;
  deleted_at: number | null;
  attachments: AttachmentMeta[];
}

export interface MailMessage extends MessageSummary {
  body_text: string;
  body_html: string;
  sent_at: string | null;
  raw_size: number;
  body_truncated: number;
}

export interface AddressInfo { address: string; count: number; unread: number }
export interface InboxResult {
  messages: MessageSummary[];
  addresses: AddressInfo[];
  counts: { inbox: number; unread: number; trash: number };
  nextCursor: string | null;
}

export type Folder = 'inbox' | 'unread' | 'trash';
