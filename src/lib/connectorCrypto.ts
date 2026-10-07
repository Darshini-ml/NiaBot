/**
 * AES-256-GCM encryption/decryption for OAuth tokens at rest.
 * Uses CONNECTOR_ENCRYPTION_KEY env var (64-char hex = 32 bytes).
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.CONNECTOR_ENCRYPTION_KEY || "";
  if (!hex || hex.length !== 64) {
    throw new Error(
      "CONNECTOR_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

/** Encrypt plaintext → base64 string (iv + ciphertext + tag) */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/** Decrypt base64 string → plaintext */
export function decrypt(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

/** Check if encryption key is configured */
export function isEncryptionConfigured(): boolean {
  const hex = process.env.CONNECTOR_ENCRYPTION_KEY || "";
  return hex.length === 64;
}
