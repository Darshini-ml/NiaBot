import { NextRequest } from "next/server";
import { deleteConnector, deleteConnectorById, toggleConnector, toggleConnectorById, getConnector, getConnectorById, getConnectorsByProvider, getAccessToken } from "@/lib/connectorStore";
import { getUserId } from "@/lib/session";

/** GET /api/connectors/:provider — detail view: installed, accounts */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const userId = getUserId(req);
  const connectors = getConnectorsByProvider(userId, provider);

  if (connectors.length === 0) {
    return Response.json({ installed: false, accounts: [] });
  }

  const accounts = connectors.map((c, i) => ({
    id: c.id,
    externalId: c.external_id,
    externalName: c.external_name,
    accountLabel: c.account_label || c.external_name || c.external_id,
    isPrimary: i === 0,
    connectedAt: c.created_at,
    enabled: c.enabled,
    status: c.status || "connected",
    scopes: c.scopes,
    lastUsedAt: c.last_used_at,
  }));

  return Response.json({ installed: true, accounts });
}

async function revokeToken(provider: string, token: string): Promise<void> {
  if (provider === "slack") {
    await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } else if (provider === "discord") {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (clientId && clientSecret) {
      await fetch("https://discord.com/api/oauth2/token/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token,
          token_type_hint: "access_token",
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
    }
  }
}

/** DELETE /api/connectors/:provider — revoke + delete
 *  ?id=<connectorId>   → remove one workspace
 *  ?externalId=<extId>  → remove one workspace (legacy)
 *  (no param)           → full uninstall: remove all workspaces for this provider
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const userId = getUserId(req);
  const connectorId = req.nextUrl.searchParams.get("id") || undefined;
  const externalId = req.nextUrl.searchParams.get("externalId") || undefined;

  // Single workspace removal by connector row id
  if (connectorId) {
    const connector = getConnectorById(connectorId);
    if (connector && connector.user_id === userId) {
      try { await revokeToken(provider, getAccessToken(connector)); } catch (err) {
        console.error(`[connectors] ${provider} revoke failed:`, err);
      }
      deleteConnectorById(connectorId);
    } else {
      return Response.json({ error: "Connector not found" }, { status: 404 });
    }
    const remaining = getConnectorsByProvider(userId, provider);
    return Response.json({ ok: true, remainingAccounts: remaining.length });
  }

  // Single workspace removal by externalId (legacy)
  if (externalId) {
    const connector = getConnector(userId, provider, externalId);
    if (connector) {
      try { await revokeToken(provider, getAccessToken(connector)); } catch (err) {
        console.error(`[connectors] ${provider} revoke failed:`, err);
      }
    }
    const deleted = deleteConnector(userId, provider, externalId);
    if (!deleted) {
      return Response.json({ error: "Connector not found" }, { status: 404 });
    }
    const remaining = getConnectorsByProvider(userId, provider);
    return Response.json({ ok: true, remainingAccounts: remaining.length });
  }

  // Full uninstall — revoke every account token
  const allConnectors = getConnectorsByProvider(userId, provider);
  for (const c of allConnectors) {
    try { await revokeToken(provider, getAccessToken(c)); } catch (err) {
      console.error(`[connectors] ${provider} revoke failed for ${c.external_id}:`, err);
    }
  }

  const deleted = deleteConnector(userId, provider);
  if (!deleted) {
    return Response.json({ error: "Connector not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}

/** PATCH /api/connectors/:provider — toggle enabled
 *  Body: { enabled: boolean, id?: string }
 *  If id is provided, toggles that specific workspace; otherwise toggles all for the provider.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const userId = getUserId(req);

  const body = await req.json();
  const { enabled, id } = body;

  if (typeof enabled !== "boolean") {
    return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  let updated: boolean;
  if (id) {
    // Verify ownership
    const c = getConnectorById(id);
    if (!c || c.user_id !== userId || c.provider !== provider) {
      return Response.json({ error: "Connector not found" }, { status: 404 });
    }
    updated = toggleConnectorById(id, enabled);
  } else {
    updated = toggleConnector(userId, provider, enabled);
  }

  if (!updated) {
    return Response.json({ error: "Connector not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
