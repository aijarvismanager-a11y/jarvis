import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_VERSION } from "./schema.ts";

export type Db = DatabaseSync;

// Ordered migrations; index 0 upgrades user_version 0 -> 1, and so on. Never
// edit an applied migration, add a new one.
const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2];

export function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const current = row.user_version;
  if (current > SCHEMA_VERSION) {
    throw new Error(`データベースのバージョン(${current})がこのアプリ(${SCHEMA_VERSION})より新しいため開けません`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Opens (creating if needed) the state database. Use ":memory:" for tests. */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

let savepointSeq = 0;

/**
 * Runs fn inside a transaction; rolls back on throw. Re-entrant: when already
 * inside a transaction it uses a SAVEPOINT, so repository methods that open
 * their own transaction can be composed into a larger one.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) {
    const name = `sp_${++savepointSeq}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (err) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw err;
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
