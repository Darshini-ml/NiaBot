/**
 * Central configuration — single source of truth for URLs.
 *
 * NIA_GATEWAY_URL  — the remote NIA gateway (provider routing).
 * NIA_APP_URL      — this Next.js app (for the Slack bot to call back).
 */

export const NIA_GATEWAY_URL =
  process.env.NIA_GATEWAY_URL ||
  process.env.NIA_BASE_URL || // legacy fallback
  "https://api.nia.naslabs.ai/v1";

export const NIA_APP_URL =
  process.env.NIA_APP_URL || "http://localhost:3000";

export const NIA_API_KEY = process.env.NIA_API_KEY || "";

/**
 * Startup validation — call once from a server route or layout.
 * Logs warnings to stderr so they're visible in `next dev` output.
 */
export function validateConfig(): void {
  if (!process.env.NIA_GATEWAY_URL && !process.env.NIA_BASE_URL) {
    console.warn(
      "[config] ⚠️  NIA_GATEWAY_URL is not set — using default https://api.nia.naslabs.ai/v1"
    );
  }

  if (NIA_GATEWAY_URL === NIA_APP_URL) {
    throw new Error(
      `[config] FATAL: NIA_GATEWAY_URL (${NIA_GATEWAY_URL}) equals NIA_APP_URL (${NIA_APP_URL}). ` +
        `This will cause requests to loop back to this app. Set NIA_GATEWAY_URL to the remote gateway (e.g. https://api.nia.naslabs.ai/v1).`
    );
  }

  if (!NIA_API_KEY) {
    console.warn("[config] ⚠️  NIA_API_KEY is not set — gateway calls will fail");
  }

  console.log(
    `[config] NIA_GATEWAY_URL=${NIA_GATEWAY_URL} NIA_APP_URL=${NIA_APP_URL}`
  );
}
