-- A failed precondition aborts the entire D1 batch before credentials are changed.
CREATE TABLE auth_change_guard (
  id INTEGER PRIMARY KEY CHECK(id=1),
  valid INTEGER NOT NULL CONSTRAINT auth_change_current CHECK(valid=1)
);
