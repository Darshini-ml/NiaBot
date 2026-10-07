import { NextRequest, NextResponse } from "next/server";
import { upsertConnector } from "@/lib/connectorStore";
import { setUserIdCookie } from "@/lib/session";

/** Base URL used for the redirect_uri sent to Slack (must match registered URI) */
function getRegisteredBase(): string {
  return process.env.APP_BASE_URL || process.env.NIA_APP_URL || "http://localhost:3000";
}

/** Derive the browser-facing origin from the incoming request so the final
 *  redirect lands on the same host the user is actually browsing (e.g. an
 *  IDE proxy), not necessarily APP_BASE_URL. */
function getBrowserOrigin(req: NextRequest): string {
  // 1. Prefer the request's own origin (most reliable)
  const reqOrigin = req.nextUrl.origin;
  if (reqOrigin && reqOrigin !== "null") return reqOrigin;
  // 2. Fallback to registered base
  return getRegisteredBase();
}

function errorRedirect(origin: string, code: string, detail: string): NextResponse {
  const errorMsg = `${code}: ${detail}`;
  console.error(`[slack-callback] ✗ Error: ${errorMsg}`);
  return new NextResponse(oauthCompletePage("slack", false, origin, errorMsg), {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

/** GET /api/connectors/slack/callback — exchange code for token */
export async function GET(req: NextRequest) {
  const registeredBase = getRegisteredBase();
  const browserOrigin = getBrowserOrigin(req);

  console.log(`[slack-callback] ── START ──`);
  console.log(`[slack-callback] registeredBase=${registeredBase}, browserOrigin=${browserOrigin}, reqUrl=${req.nextUrl.toString()}`);

  // ── Step 1: Read query params ─────────────────────────────────────────────
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  console.log(`[slack-callback] Step 1 — query params: code=${code ? `present (${code.slice(0, 12)}…)` : "MISSING"}, state=${stateParam ? "present" : "MISSING"}, error=${error || "none"}`);

  if (error) {
    return errorRedirect(browserOrigin, "slack_denied", `Slack returned error: ${error}`);
  }

  if (!code) {
    return errorRedirect(browserOrigin, "missing_params", "No authorization code received from Slack");
  }

  if (!stateParam) {
    return errorRedirect(browserOrigin, "missing_params", "No state parameter — possible CSRF or cookie loss");
  }

  // ── Step 2: Decode state → userId ─────────────────────────────────────────
  let userId = "default";
  try {
    const state = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    userId = state.userId || "default";
    console.log(`[slack-callback] Step 2 — state decoded: userId=${userId}, nonce=${state.nonce || "none"}`);
  } catch (e) {
    console.warn(`[slack-callback] Step 2 — state decode failed (${e instanceof Error ? e.message : e}), using userId=default`);
  }

  // ── Step 3: Exchange code for token ────────────────────────────────────────
  const clientId = process.env.SLACK_CLIENT_ID || "";
  const clientSecret = process.env.SLACK_CLIENT_SECRET || "";
  // redirect_uri MUST match the one registered in Slack app settings
  const redirectUri = `${registeredBase}/api/connectors/slack/callback`;

  if (!clientId || !clientSecret) {
    return errorRedirect(browserOrigin, "not_configured", "SLACK_CLIENT_ID or SLACK_CLIENT_SECRET not set on server");
  }

  console.log(`[slack-callback] Step 3 — exchanging code: client_id=${clientId}, redirect_uri=${redirectUri}`);

  let data: any;
  try {
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    data = await tokenRes.json();
  } catch (fetchErr) {
    return errorRedirect(browserOrigin, "slack_exchange_failed", `Network error calling Slack API: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`);
  }

  // Log response (redact tokens)
  const safeData = JSON.parse(JSON.stringify(data));
  if (safeData.access_token) safeData.access_token = "REDACTED";
  if (safeData.authed_user?.access_token) safeData.authed_user.access_token = "REDACTED";
  console.log(`[slack-callback] Step 3 — oauth.v2.access response:`, JSON.stringify(safeData, null, 2));

  if (!data.ok) {
    return errorRedirect(
      browserOrigin,
      "slack_exchange_failed",
      `Slack API error: ${data.error || "unknown"}${data.error === "invalid_code" ? " (code may have expired or been reused)" : ""}`,
    );
  }

  // ── Step 4: Extract token (user_scope flow) ───────────────────────────────
  // CRITICAL: user_scope-only flows put the token in authed_user.access_token,
  // NOT at the top level. data.access_token is the BOT token (empty when no
  // bot scopes are requested).
  const accessToken = data.authed_user?.access_token || data.access_token;
  const teamId = data.team?.id || "";
  const teamName = data.team?.name || "";
  const authedUserId = data.authed_user?.id || "";
  const scopes = (data.authed_user?.scope || data.scope || "").split(",").filter(Boolean);

  console.log(`[slack-callback] Step 4 — token extraction: authed_user.access_token=${data.authed_user?.access_token ? "PRESENT" : "MISSING"}, data.access_token=${data.access_token ? "PRESENT" : "MISSING"}, using=${accessToken ? "found" : "NONE"}, team=${teamName} (${teamId}), authed_user.id=${authedUserId}, scopes=${scopes.join(",")}`);

  if (!accessToken) {
    return errorRedirect(
      browserOrigin,
      "no_user_token",
      `Neither authed_user.access_token nor data.access_token present. Response keys: ${Object.keys(data).join(",")}. authed_user keys: ${data.authed_user ? Object.keys(data.authed_user).join(",") : "N/A"}`,
    );
  }

  // ── Step 5: Fetch user profile (non-fatal) ────────────────────────────────
  let accountLabel = "";
  if (authedUserId) {
    try {
      console.log(`[slack-callback] Step 5 — fetching users.info for ${authedUserId}`);
      const infoRes = await fetch(`https://slack.com/api/users.info?user=${authedUserId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const infoData = await infoRes.json();
      console.log(`[slack-callback] Step 5 — users.info ok=${infoData.ok}, error=${infoData.error || "none"}`);

      if (infoData.ok) {
        accountLabel = infoData.user?.profile?.email || infoData.user?.real_name || infoData.user?.name || "";
      } else {
        console.warn(`[slack-callback] Step 5 — users.info failed (${infoData.error}), continuing without account label`);
      }
    } catch (e) {
      console.warn(`[slack-callback] Step 5 — users.info fetch error: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    console.log(`[slack-callback] Step 5 — skipped (no authed_user.id)`);
  }

  // ── Step 6: Upsert to database ────────────────────────────────────────────
  try {
    console.log(`[slack-callback] Step 6 — upserting connector: userId=${userId}, provider=slack, external_id=${teamId}, external_name=${teamName}`);

    const connector = upsertConnector({
      user_id: userId,
      provider: "slack",
      external_id: teamId,
      external_name: teamName,
      account_label: accountLabel,
      access_token: accessToken,
      scopes,
    });

    console.log(`[slack-callback] Step 6 — upsert OK: connector.id=${connector.id}, enabled=${connector.enabled}, status=${connector.status}`);
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(`[slack-callback] Step 6 — DB upsert FAILED:`, msg);
    return errorRedirect(browserOrigin, "db_insert_failed", msg);
  }

  // ── Step 7: Notify opener (popup) or redirect (fallback) ─────────────────
  console.log(`[slack-callback] Step 7 — success! Returning completion page.`);
  console.log(`[slack-callback] ── END ──`);

  const res = new NextResponse(oauthCompletePage("slack", true, browserOrigin), {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
  setUserIdCookie(res, userId);
  return res;
}

function oauthCompletePage(provider: string, success: boolean, origin: string, error?: string): string {
  const msg = JSON.stringify({ type: "oauth_complete", provider, success, error: error || null });
  const fallbackUrl = success
    ? `${origin}/?view=connectors&connected=${provider}`
    : `${origin}/?view=connectors&connectorError=${encodeURIComponent(error || "unknown")}`;
  return `<!DOCTYPE html><html><head><title>Connecting...</title></head><body>
<script>
(function() {
  try {
    if (window.opener) {
      window.opener.postMessage(${msg}, "*");
      setTimeout(function() { window.close(); }, 500);
    } else {
      window.location.href = ${JSON.stringify(fallbackUrl)};
    }
  } catch(e) {
    window.location.href = ${JSON.stringify(fallbackUrl)};
  }
})();
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:40vh">
${success ? "Connected! This window will close automatically..." : "Connection failed. Redirecting..."}
</p></body></html>`;
}
