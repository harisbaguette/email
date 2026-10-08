CREATE TABLE two_factor (
  id INTEGER PRIMARY KEY CHECK(id=1),
  secret TEXT NOT NULL,
  last_counter INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE two_factor_setups (
  session_hash TEXT PRIMARY KEY,
  recovery_hashes TEXT NOT NULL,
  secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE recovery_codes (code_hash TEXT PRIMARY KEY);
