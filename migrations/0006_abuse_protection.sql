-- Stop accepting the automatically discovered aliases. The owner can explicitly resume them.
UPDATE addresses SET blocked=1 WHERE managed=0;

CREATE TABLE mail_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX mail_limits_expiry ON mail_limits(window_start);

CREATE TABLE mail_storage (
  id INTEGER PRIMARY KEY CHECK(id=1),
  messages INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
);
INSERT INTO mail_storage SELECT 1, COUNT(*), COALESCE(SUM(stored_size),0) FROM messages;
CREATE TRIGGER mail_storage_capacity BEFORE INSERT ON messages
WHEN (SELECT messages >= 20000 OR bytes + NEW.stored_size > 268435456 FROM mail_storage WHERE id=1)
BEGIN SELECT RAISE(ABORT, 'mail_storage_full'); END;
CREATE TRIGGER mail_storage_insert AFTER INSERT ON messages
BEGIN UPDATE mail_storage SET messages=messages+1, bytes=bytes+NEW.stored_size WHERE id=1; END;
CREATE TRIGGER mail_storage_delete AFTER DELETE ON messages
BEGIN UPDATE mail_storage SET messages=messages-1, bytes=bytes-OLD.stored_size WHERE id=1; END;
CREATE TRIGGER mail_storage_update AFTER UPDATE OF stored_size ON messages
BEGIN UPDATE mail_storage SET bytes=bytes+NEW.stored_size-OLD.stored_size WHERE id=1; END;
