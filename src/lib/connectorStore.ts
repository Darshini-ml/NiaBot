/**
 * Connector store — backed by SQLite (better-sqlite3).
 * Keeps the same interface as the old file-backed implementation so
 * routes and tools don't need changes.
 */

import { encrypt, decrypt, isEncryptionConfigured } from "./connectorCrypto";
import { getDb } from "./db";
import { randomUUID } from "crypto";

export interface Connector {
  id: string;
  user_id: string;
  provider: "slack" | "discord";
  external_id: string;      // team.id or guild.id
  external_name: string;    // team.name or guild.name
  account_label: string;    // user email/handle from identity
  access_token_enc: string; // encrypted
  refresh_token_enc: string | null;
  scopes: string[];
  enabled: boolean;
  status?: "connected" | "needs_reauth";
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Public view (no tokens) */
export interface ConnectorInfo {
  id: string;
  provider: "slack" | "discord";
  external_id: string;
  external_name: string;
  account_label: string;
  enabled: boolean;
  status: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Row ↔ Connector mapping ──────────────────────────────────────────────────

interface Row {
  id: string;
  user_id: string;
  provider: string;
  external_id: string;
  external_name: string;
  account_label: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  scopes: string;
  enabled: number;
  status: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToConnector(row: Row): Connector {
  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider as "slack" | "discord",
    external_id: row.external_id,
    external_name: row.external_name,
    account_label: row.account_label || "",
    access_token_enc: row.access_token_enc,
    refresh_token_enc: row.refresh_token_enc,
    scopes: JSON.parse(row.scopes),
    enabled: row.enabled === 1,
    status: row.status as "connected" | "needs_reauth",
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── CRUD operations ───────────────────────────────────────────────────────────

export function listConnectors(userId: string): ConnectorInfo[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM connectors WHERE user_id = ?").all(userId) as Row[];
  return rows.map((r) => toInfo(rowToConnector(r)));
}

export function getConnector(userId: string, provider: string, externalId?: string): Connector | undefined {
  const db = getDb();
  let row: Row | undefined;
  if (externalId) {
    row = db.prepare("SELECT * FROM connectors WHERE user_id = ? AND provider = ? AND external_id = ?")
      .get(userId, provider, externalId) as Row | undefined;
  } else {
    row = db.prepare("SELECT * FROM connectors WHERE user_id = ? AND provider = ? LIMIT 1")
      .get(userId, provider) as Row | undefined;
  }
  return row ? rowToConnector(row) : undefined;
}

export function getConnectorsByProvider(userId: string, provider: string): Connector[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM connectors WHERE user_id = ? AND provider = ?")
    .all(userId, provider) as Row[];
  return rows.map(rowToConnector);
}

export function upsertConnector(data: {
  user_id: string;
  provider: "slack" | "discord";
  external_id: string;
  external_name: string;
  account_label?: string;
  access_token: string;
  refresh_token?: string | null;
  scopes: string[];
}): Connector {
  const db = getDb();
  const now = new Date().toISOString();
  const scopesJson = JSON.stringify(data.scopes);
  const accessEnc = encrypt(data.access_token);
  const refreshEnc = data.refresh_token ? encrypt(data.refresh_token) : null;

  const existing = db.prepare(
    "SELECT id FROM connectors WHERE user_id = ? AND provider = ? AND external_id = ?",
  ).get(data.user_id, data.provider, data.external_id) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE connectors
      SET access_token_enc = ?, refresh_token_enc = ?, scopes = ?,
          external_name = ?, account_label = ?, enabled = 1, status = 'connected', updated_at = ?
      WHERE id = ?
    `).run(accessEnc, refreshEnc, scopesJson, data.external_name, data.account_label || "", now, existing.id);

    return getConnector(data.user_id, data.provider, data.external_id)!;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO connectors (id, user_id, provider, external_id, external_name, account_label,
      access_token_enc, refresh_token_enc, scopes, enabled, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'connected', ?, ?)
  `).run(id, data.user_id, data.provider, data.external_id, data.external_name,
    data.account_label || "", accessEnc, refreshEnc, scopesJson, now, now);

  return getConnector(data.user_id, data.provider, data.external_id)!;
}

export function getConnectorById(id: string): Connector | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM connectors WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToConnector(row) : undefined;
}

export function deleteConnector(userId: string, provider: string, externalId?: string): boolean {
  const db = getDb();
  let result;
  if (externalId) {
    result = db.prepare("DELETE FROM connectors WHERE user_id = ? AND provider = ? AND external_id = ?")
      .run(userId, provider, externalId);
  } else {
    result = db.prepare("DELETE FROM connectors WHERE user_id = ? AND provider = ?")
      .run(userId, provider);
  }
  return result.changes > 0;
}

export function deleteConnectorById(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM connectors WHERE id = ?").run(id);
  return result.changes > 0;
}

export function toggleConnector(userId: string, provider: string, enabled: boolean, externalId?: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  let result;
  if (externalId) {
    result = db.prepare("UPDATE connectors SET enabled = ?, updated_at = ? WHERE user_id = ? AND provider = ? AND external_id = ?")
      .run(enabled ? 1 : 0, now, userId, provider, externalId);
  } else {
    result = db.prepare("UPDATE connectors SET enabled = ?, updated_at = ? WHERE user_id = ? AND provider = ?")
      .run(enabled ? 1 : 0, now, userId, provider);
  }
  return result.changes > 0;
}

export function toggleConnectorById(id: string, enabled: boolean): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE connectors SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, now, id);
  return result.changes > 0;
}

export function markNeedsReauth(userId: string, provider: string, externalId?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (externalId) {
    db.prepare("UPDATE connectors SET status = 'needs_reauth', updated_at = ? WHERE user_id = ? AND provider = ? AND external_id = ?")
      .run(now, userId, provider, externalId);
  } else {
    db.prepare("UPDATE connectors SET status = 'needs_reauth', updated_at = ? WHERE user_id = ? AND provider = ?")
      .run(now, userId, provider);
  }
}

export function touchLastUsed(userId: string, provider: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE connectors SET last_used_at = ? WHERE user_id = ? AND provider = ? AND enabled = 1")
    .run(now, userId, provider);
}

/** Decrypt the access token for a connector */
export function getAccessToken(connector: Connector): string {
  return decrypt(connector.access_token_enc);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInfo(c: Connector): ConnectorInfo {
  return {
    id: c.id,
    provider: c.provider,
    external_id: c.external_id,
    external_name: c.external_name,
    account_label: c.account_label || "",
    enabled: c.enabled,
    status: c.status || "connected",
    scopes: c.scopes,
    last_used_at: c.last_used_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

export { isEncryptionConfigured };
