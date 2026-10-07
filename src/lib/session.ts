/**
 * Session identity via HMAC-signed httpOnly cookie.
 *
 * Cookie format: `<userId>.<hex-signature>`
 * Signature: HMAC-SHA256(userId, COOKIE_SECRET)
 *
 * Usage:
 *   // In route handlers with NextRequest:
 *   const userId = getUserId(req);
 *
 *   // In route handlers using next/headers cookies():
 *   const userId = getUserIdFromCookies(await cookies());
 *
 *   // To set the cookie on a response:
 *   setUserIdCookie(response, userId);
 */

import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

const COOKIE_NAME = "nia_user_id";

function getSecret(): string {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    console.warn("[session] COOKIE_SECRET not set — cookie signing disabled, using raw value");
    return "";
  }
  return secret;
}

function sign(value: string): string {
  const secret = getSecret();
  if (!secret) return value;
  const sig = createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${sig}`;
}

function verify(raw: string): string | null {
  const secret = getSecret();
  if (!secret) {
    // No secret configured — accept raw value as-is (backward compat)
    return raw || null;
  }

  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx === -1) {
    // Unsigned cookie — reject when secret is configured
    return null;
  }

  const value = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const expected = createHmac("sha256", secret).update(value).digest("hex");

  // Constant-time comparison
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0 ? value : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Read and verify userId from a NextRequest. Returns "default" if missing/invalid. */
export function getUserId(req: NextRequest): string {
  const raw = req.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return "default";
  return verify(raw) ?? "default";
}

/** Read and verify userId from next/headers cookies(). Returns "default" if missing/invalid. */
export function getUserIdFromCookies(cookieStore: ReadonlyRequestCookies): string {
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return "default";
  return verify(raw) ?? "default";
}

/** Set the signed nia_user_id cookie on a NextResponse. */
export function setUserIdCookie(response: NextResponse, userId: string): void {
  response.cookies.set(COOKIE_NAME, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // secure in production
    secure: process.env.NODE_ENV === "production",
    // 1 year
    maxAge: 365 * 24 * 60 * 60,
  });
}

/**
 * Build Set-Cookie header value for the signed cookie.
 * Useful when returning a plain Response (not NextResponse).
 */
export function buildSetCookieHeader(userId: string): string {
  const signed = sign(userId);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${signed}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${365 * 24 * 60 * 60}${secure}`;
}
