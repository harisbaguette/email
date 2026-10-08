ALTER TABLE messages ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0 CHECK(is_starred IN (0,1));
ALTER TABLE messages ADD COLUMN archived_at INTEGER;
ALTER TABLE messages ADD COLUMN verification_code TEXT;
ALTER TABLE messages ADD COLUMN is_verification INTEGER NOT NULL DEFAULT 0 CHECK(is_verification IN (0,1));
ALTER TABLE messages ADD COLUMN verification_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX messages_verification ON messages(is_verification, deleted_at, received_at DESC, id DESC);
CREATE INDEX messages_verification_pending ON messages(verification_version);
ALTER TABLE addresses ADD COLUMN managed INTEGER NOT NULL DEFAULT 0 CHECK(managed IN (0,1));
ALTER TABLE addresses ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE addresses ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1));
ALTER TABLE addresses ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1));
-- The receive handler creates an address and its first message at the same timestamp.
UPDATE addresses SET managed = CASE WHEN EXISTS (SELECT 1 FROM messages m WHERE m.recipient=addresses.address AND m.received_at=addresses.created_at) THEN 0 ELSE 1 END;
ALTER TABLE sessions ADD COLUMN id TEXT;
ALTER TABLE sessions ADD COLUMN device_name TEXT NOT NULL DEFAULT '기존 기기';
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
UPDATE sessions SET id = lower(hex(randomblob(16))), last_seen_at = created_at;
CREATE UNIQUE INDEX sessions_id ON sessions(id);
ALTER TABLE push_subscriptions ADD COLUMN device_name TEXT NOT NULL DEFAULT '기존 기기';
ALTER TABLE push_subscriptions ADD COLUMN last_success_at INTEGER;
CREATE TABLE sender_rules (
  sender TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('inbox','promotions','trash')),
  created_at INTEGER NOT NULL
);
