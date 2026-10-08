CREATE TRIGGER sessions_capacity AFTER INSERT ON sessions
BEGIN
  DELETE FROM push_subscriptions WHERE session_hash IN (
    SELECT token_hash FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 10
  );
  DELETE FROM sessions WHERE token_hash IN (
    SELECT token_hash FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 10
  );
END;
