/**
 * Embedded SQLite database via better-sqlite3.
 * Singleton instance shared across all server code via globalThis.
 * Data stored in .data/nia.db (auto-created on first use).
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".data");
const DB_PATH = join(DATA_DIR, "nia.db");

const g = globalThis as unknown as { __db?: InstanceType<typeof Database> };

export function getDb(): InstanceType<typeof Database> {
  if (g.__db) return g.__db;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  g.__db = db;
  return db;
}

// ── Migrations ────────────────────────────────────────────────────────────────

function runMigrations(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      run_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((r: any) => r.name),
  );

  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(m.name);
    })();
    console.log(`[db] Migration applied: ${m.name}`);
  }
}

const migrations = [
  {
    name: "001_create_connectors",
    sql: `
      CREATE TABLE connectors (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL,
        provider          TEXT NOT NULL CHECK(provider IN ('slack', 'discord')),
        external_id       TEXT NOT NULL,
        external_name     TEXT NOT NULL DEFAULT '',
        access_token_enc  TEXT NOT NULL,
        refresh_token_enc TEXT,
        scopes            TEXT NOT NULL DEFAULT '[]',
        enabled           INTEGER NOT NULL DEFAULT 1,
        status            TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected', 'needs_reauth')),
        last_used_at      TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, provider, external_id)
      );
      CREATE INDEX idx_connectors_user ON connectors(user_id);
      CREATE INDEX idx_connectors_user_provider ON connectors(user_id, provider);
    `,
  },
  {
    name: "002_add_account_label",
    sql: `
      ALTER TABLE connectors ADD COLUMN account_label TEXT NOT NULL DEFAULT '';
    `,
  },
];
