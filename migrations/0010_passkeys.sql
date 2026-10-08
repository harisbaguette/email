CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0 CHECK(counter >= 0),
  transports TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  backed_up INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER passkeys_capacity BEFORE INSERT ON passkeys
WHEN (SELECT COUNT(*) FROM passkeys) >= 20
BEGIN SELECT RAISE(ABORT, 'passkeys_capacity'); END;

CREATE TABLE passkey_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('register','login')),
  session_hash TEXT,
  revision TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX passkey_challenges_expiry ON passkey_challenges(expires_at);
CREATE TRIGGER passkey_challenges_capacity BEFORE INSERT ON passkey_challenges
WHEN (SELECT COUNT(*) FROM passkey_challenges) >= 200
BEGIN SELECT RAISE(ABORT, 'passkey_challenges_capacity'); END;
