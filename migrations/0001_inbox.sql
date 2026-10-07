CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE addresses (
  address TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  sender_address TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  received_at INTEGER NOT NULL,
  sent_at TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
  deleted_at INTEGER,
  raw_size INTEGER NOT NULL,
  stored_size INTEGER NOT NULL,
  body_truncated INTEGER NOT NULL DEFAULT 0 CHECK(body_truncated IN (0, 1)),
  fingerprint TEXT NOT NULL UNIQUE
);
CREATE INDEX messages_order ON messages(deleted_at, received_at DESC, id DESC);
CREATE INDEX messages_recipient ON messages(recipient, deleted_at, received_at DESC);
CREATE INDEX messages_unread ON messages(is_read, deleted_at, received_at DESC);

CREATE TABLE raw_chunks (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY(message_id, part)
);
