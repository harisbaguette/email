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
  is_starred: number;
  archived_at: number | null;
  is_verification: number;
  deleted_at: number | null;
  category: 'inbox' | 'promotions';
  category_source: 'pending' | 'automatic' | 'protected' | 'manual';
  verification_code: string | null;
  attachments: AttachmentMeta[];
}

export interface MailMessage extends MessageSummary {
  verification_link: VerificationLink | null;
  body_text: string;
  body_html: string;
  sent_at: string | null;
  raw_size: number;
  body_truncated: number;
}

export interface VerificationLink { url: string; host: string; label: string }

export interface AddressInfo { address: string; count: number; unread: number; managed: number; label: string; hidden: number; blocked: number }
export interface InboxResult {
  messages: MessageSummary[];
  addresses: AddressInfo[];
  counts: Record<Folder, number>;
  sorting: { enabled: boolean; pending: number; delayed: number };
  nextCursor: string | null;
}

export type Folder = 'inbox' | 'verification' | 'unread' | 'starred' | 'archive' | 'promotions' | 'all' | 'trash';
export type MessageAction = 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'unarchive' | 'trash' | 'restore' | 'inbox' | 'promotions';
export interface SessionInfo { id: string; device_name: string; created_at: number; last_seen_at: number; current: boolean }
export interface SenderRule { sender: string; action: 'inbox' | 'promotions' | 'trash'; created_at: number }
