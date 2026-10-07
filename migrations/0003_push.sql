CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'verification' CHECK(mode IN ('verification', 'inbox')),
  preview INTEGER NOT NULL DEFAULT 0 CHECK(preview IN (0,1)),
  session_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_test_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE push_deliveries (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(message_id, subscription_id)
);
CREATE INDEX push_due ON push_deliveries(state, due_at);
