import { NextRequest, NextResponse } from "next/server";
import { upsertConnector } from "@/lib/connectorStore";
import { setUserIdCookie } from "@/lib/session";

/** Base URL for the redirect_uri sent to Discord (must match registered URI) */
function getRegisteredBase(): string {
  return process.env.APP_BASE_URL || process.env.NIA_APP_URL || "http://localhost:3000";
}

/** Browser-facing origin from the incoming request */
function getBrowserOrigin(req: NextRequest): string {
  const reqOrigin = req.nextUrl.origin;
  if (reqOrigin && reqOrigin !== "null") return reqOrigin;
  return getRegisteredBase();
}

function errorRedirect(origin: string, code: string, detail: string): NextResponse {
  const errorMsg = `${code}: ${detail}`;
  console.error(`[discord-callback] ✗ Error: ${errorMsg}`);
  return new NextResponse(oauthCompletePage("discord", false, origin, errorMsg), {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

/** GET /api/connectors/discord/callback — exchange code, store guild list */
export async function GET(req: NextRequest) {
  const registeredBase = getRegisteredBase();
  const browserOrigin = getBrowserOrigin(req);

  console.log(`[discord-callback] ── START ──`);
  console.log(`[discord-callback] registeredBase=${registeredBase}, browserOrigin=${browserOrigin}, reqUrl=${req.nextUrl.toString()}`);

  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const errorDesc = req.nextUrl.searchParams.get("error_description");

  console.log(`[discord-callback] Step 1 — query params: code=${code ? "present" : "MISSING"}, state=${stateParam ? "present" : "MISSING"}, error=${error || "none"}`);

  if (error) {
    return errorRedirect(browserOrigin, "discord_denied", `Discord returned: ${error}${errorDesc ? ` — ${errorDesc}` : ""}`);
  }

  if (!code || !stateParam) {
    return errorRedirect(browserOrigin, "missing_params", `code=${!!code}, state=${!!stateParam}`);
  }

  // Decode state → userId
  let userId = "default";
  try {
    const state = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    userId = state.userId || "default";
    console.log(`[discord-callback] Step 2 — state decoded: userId=${userId}`);
  } catch (e) {
    return errorRedirect(browserOrigin, "invalid_state", `State decode failed: ${e instanceof Error ? e.message : e}`);
  }

  const clientId = process.env.DISCORD_CLIENT_ID || "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET || "";
  // redirect_uri MUST match the one registered in Discord app settings
  const redirectUri = `${registeredBase}/api/connectors/discord/callback`;

  if (!clientId || !clientSecret) {
    return errorRedirect(browserOrigin, "not_configured", "DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set on server");
  }

  console.log(`[discord-callback] Step 3 — exchanging code: client_id=${clientId.slice(0, 6)}…, redirect_uri=${redirectUri}`);

  // --- Step 3: Exchange code for token ---
  let tokenData: Record<string, unknown>;
  try {
    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    tokenData = await tokenRes.json();
    console.log(`[discord-callback] Step 3 — token response: status=${tokenRes.status}, error=${(tokenData.error as string) || "none"}, scope=${tokenData.scope || "none"}`);

    if (tokenData.error) {
      return errorRedirect(browserOrigin, "discord_exchange_failed", `${tokenData.error}${tokenData.error_description ? ` — ${tokenData.error_description}` : ""}`);
    }

    if (!tokenData.access_token) {
      return errorRedirect(browserOrigin, "no_access_token", `Response keys: ${Object.keys(tokenData).join(",")}`);
    }
  } catch (err) {
    return errorRedirect(browserOrigin, "discord_exchange_failed", `Network error: ${err instanceof Error ? err.message : err}`);
  }

  const accessToken = tokenData.access_token as string;
  const refreshToken = (tokenData.refresh_token as string) || null;

  // --- Step 4: Fetch user identity ---
  let discordUserId = "";
  let username = "";
  let accountLabel = "";
  try {
    const meRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const meData = await meRes.json();
    console.log(`[discord-callback] Step 4 — /users/@me: status=${meRes.status}, id=${meData.id || "MISSING"}, username=${meData.username || "MISSING"}`);

    if (meData.id) {
      discordUserId = meData.id;
      username = meData.global_name || meData.username || "";
      accountLabel = meData.email || username;
    } else {
      return errorRedirect(browserOrigin, "user_fetch_failed", `Discord /users/@me returned no id. Response: ${JSON.stringify(meData).slice(0, 200)}`);
    }
  } catch (err) {
    return errorRedirect(browserOrigin, "user_fetch_failed", `Network error fetching profile: ${err instanceof Error ? err.message : err}`);
  }

  // --- Step 5: Fetch guilds (non-fatal) ---
  let guilds: Array<{ id: string; name: string }> = [];
  try {
    const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const guildsData = await guildsRes.json();
    if (Array.isArray(guildsData)) {
      guilds = guildsData;
      console.log(`[discord-callback] Step 5 — ${guilds.length} guilds: ${guilds.slice(0, 3).map(g => g.name).join(", ")}${guilds.length > 3 ? "…" : ""}`);
    }
  } catch {
    console.warn(`[discord-callback] Step 5 — guilds fetch failed (non-fatal)`);
  }

  // --- Step 6: Upsert connector ---
  try {
    const connector = upsertConnector({
      user_id: userId,
      provider: "discord",
      external_id: discordUserId,
      external_name: username,
      account_label: accountLabel,
      access_token: accessToken,
      refresh_token: refreshToken,
      scopes: ["identify", "guilds"],
    });
    console.log(`[discord-callback] Step 6 — upsert OK: connector.id=${connector.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[discord-callback] Step 6 — DB upsert FAILED:`, msg);
    return errorRedirect(browserOrigin, "db_insert_failed", msg);
  }

  // --- Step 7: Notify opener (popup) or redirect (fallback) ---
  console.log(`[discord-callback] Step 7 — success! Returning completion page.`);
  console.log(`[discord-callback] ── END ──`);

  const res = new NextResponse(oauthCompletePage("discord", true, browserOrigin), {
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
