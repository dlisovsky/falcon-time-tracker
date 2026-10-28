import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS employees (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS time_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    description TEXT    NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
  );

  CREATE INDEX IF NOT EXISTS idx_entries_employee_start
    ON time_entries(employee_id, started_at);

  -- At most one running timer per employee, enforced by the database itself.
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_running_timer
    ON time_entries(employee_id) WHERE ended_at IS NULL;
`;

/**
 * Opens (or creates) the SQLite database and applies the schema.
 * Pass ':memory:' for an in-memory database.
 */
export function openDatabase(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
