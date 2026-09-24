/** Ledger schema DDL (ARCHITECTURE §8.1). Pure text, shared by the app and
 * the Node tamper check (TC-33). */

export const SCHEMA_VERSION = 1;

export const MIGRATION_1 = `
CREATE TABLE ledger (
  seq          INTEGER PRIMARY KEY,
  record_id    TEXT NOT NULL UNIQUE,
  record_type  TEXT NOT NULL CHECK (record_type IN ('GENESIS','TEST','VOID','REVIEW','CUSTODY')),
  payload      TEXT NOT NULL,
  prev_hash    TEXT,
  record_hash  TEXT NOT NULL UNIQUE,
  signature    TEXT NOT NULL,
  key_id       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TABLE test_index (
  record_id       TEXT PRIMARY KEY,
  seq             INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  operator_badge  TEXT NOT NULL,
  kit_type        TEXT NOT NULL,
  case_id         TEXT,
  outcome         TEXT NOT NULL,
  confidence      REAL,
  quality_score   INTEGER,
  evidence_sha256 TEXT,
  retest_of       TEXT,
  voided          INTEGER NOT NULL DEFAULT 0,
  review_status   TEXT
);
CREATE INDEX idx_test_created ON test_index(created_at DESC);
CREATE INDEX idx_test_case    ON test_index(case_id);
CREATE INDEX idx_test_filters ON test_index(outcome, kit_type, operator_badge);

CREATE TABLE sync_outbox (
  record_id          TEXT PRIMARY KEY,
  status             TEXT NOT NULL DEFAULT 'PENDING',
  attempts           INTEGER NOT NULL DEFAULT 0,
  next_attempt_at    TEXT,
  last_error         TEXT,
  server_received_at TEXT
);

CREATE TABLE evidence_file (
  sha256    TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  kind      TEXT NOT NULL,
  path      TEXT NOT NULL,
  bytes     INTEGER NOT NULL,
  accepted  INTEGER NOT NULL
);

CREATE TABLE operator (
  badge_id TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  role     TEXT NOT NULL CHECK (role IN ('OFFICER','SUPERVISOR')),
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  event      TEXT NOT NULL,
  detail     TEXT
);
`;
