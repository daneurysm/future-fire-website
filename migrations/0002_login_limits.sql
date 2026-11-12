CREATE TABLE login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1,
  reset_at INTEGER NOT NULL
);
