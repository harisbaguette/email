CREATE TABLE security_events (
  kind TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (kind, window_start)
) WITHOUT ROWID;
CREATE TABLE monitor_state (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
) WITHOUT ROWID;
