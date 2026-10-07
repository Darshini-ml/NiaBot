import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getUserIdFromCookies } from "@/lib/session";

function getBaseUrl(): string {
  return process.env.APP_BASE_URL || process.env.NIA_APP_URL || "http://localhost:3000";
}

/** GET /api/connectors/discord/start — redirect to Discord OAuth2 */
export async function GET(_req: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  // Identity from session cookie only — no query param
  const cookieStore = await cookies();
  const userId = getUserIdFromCookies(cookieStore);

  const nonce = Math.random().toString(36).slice(2, 10);
  const state = Buffer.from(JSON.stringify({ userId, nonce })).toString("base64url");

  const redirectUri = `${getBaseUrl()}/api/connectors/discord/callback`;

  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);

  return Response.redirect(url.toString());
}
