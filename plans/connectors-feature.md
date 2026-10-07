# Connectors Feature — Implementation Plan

## Overview
Add Slack & Discord OAuth connectors that let the user read/search their own workspaces from the chat. Persisted to DB (globalThis in-memory store surviving restarts via the same pattern as usage events).

## Phase 1 — Backend Foundation
1. **`.env.example`** — add `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_CONNECTOR_REDIRECT_URI`, `DISCORD_CLIENT_SECRET`, `DISCORD_CONNECTOR_REDIRECT_URI`, `CONNECTOR_ENCRYPTION_KEY`
2. **`src/lib/connectorCrypto.ts`** — AES-256-GCM encrypt/decrypt helpers using `CONNECTOR_ENCRYPTION_KEY`
3. **`src/lib/connectorStore.ts`** — In-memory DB persisted via `globalThis.__connectors`. CRUD: `listConnectors(userId)`, `getConnector(userId, provider, externalId)`, `upsertConnector(...)`, `deleteConnector(...)`, `toggleConnector(...)`. Schema: `{ id, user_id, provider, external_id, external_name, access_token_enc, refresh_token_enc, scopes, enabled, last_used_at, created_at, updated_at }`

## Phase 2 — OAuth Routes
4. **`src/app/api/connectors/slack/start/route.ts`** — Redirect to Slack OAuth v2 with user_scope
5. **`src/app/api/connectors/slack/callback/route.ts`** — Exchange code, encrypt token, store connector
6. **`src/app/api/connectors/discord/start/route.ts`** — Redirect to Discord OAuth2 with scopes `identify guilds`
7. **`src/app/api/connectors/discord/callback/route.ts`** — Exchange code, store guild list
8. **`src/app/api/connectors/route.ts`** — `GET` list, `DELETE` by provider, `PATCH` toggle enabled
9. **`src/app/api/connectors/[provider]/route.ts`** — `DELETE` revoke + delete, `PATCH` toggle

## Phase 3 — Connector Tools
10. **`src/lib/connectorTools.ts`** — Tool definitions + handlers:
    - `slack_list_channels()` — Slack conversations.list
    - `slack_search_messages({ query, channel?, after?, before?, limit })` — search.messages
    - `slack_read_channel({ channel, after?, before?, limit })` — conversations.history + users.info cache
    - `discord_list_channels({ guild })` — bot token, GET /guilds/{id}/channels
    - `discord_read_channel({ channel, after?, before?, limit })` — bot token with permission check
    - Resolve `#name` → id, humanize timestamps, cap ~12k tokens, truncate oldest first
    - Error handling: token_revoked/missing_scope → mark `needs_reauth`, return clean error

## Phase 4 — Chat Integration
11. **`src/app/api/chat/route.ts`** — Before LLM call:
    - Detect connector intent (mentions #channel, "Slack", "Discord", workspace references)
    - If user has enabled connectors, inject connector tools into the tools array
    - Handle tool_call responses for connector tools, execute them, return results
    - Record usage events with `kind: "tool_slack"` / `"tool_discord"`

## Phase 5 — UI
12. **`src/components/ConnectorsPage.tsx`** — Full page at /settings/connectors:
    - List Slack & Discord with icon, name, description, status
    - "..." menu: Try now, Manage, Uninstall
    - Reuse Logs/Settings styling
13. **Sidebar flyout** — Add "Connectors" item below Logs with chevron → flyout with Slack/Discord toggles + "Add connector" / "Manage connectors"
14. **`src/app/page.tsx`** — Add `"connectors"` to `NavView`, route to ConnectorsPage

## Files Created
- `src/lib/connectorCrypto.ts`
- `src/lib/connectorStore.ts`
- `src/lib/connectorTools.ts`
- `src/app/api/connectors/route.ts`
- `src/app/api/connectors/[provider]/route.ts`
- `src/app/api/connectors/slack/start/route.ts`
- `src/app/api/connectors/slack/callback/route.ts`
- `src/app/api/connectors/discord/start/route.ts`
- `src/app/api/connectors/discord/callback/route.ts`
- `src/components/ConnectorsPage.tsx`

## Files Modified
- `.env.example`
- `src/lib/assistantTurn.ts` (add connector tool defs to registry)
- `src/lib/recordUsage.ts` (add `tool_slack` / `tool_discord` kinds)
- `src/app/api/chat/route.ts` (connector intent + tool execution)
- `src/components/Sidebar.tsx` (add Connectors nav + flyout)
- `src/app/page.tsx` (add connectors view routing)
