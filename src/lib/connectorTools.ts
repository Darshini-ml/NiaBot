/**
 * Connector tools for Slack & Discord workspace access.
 * These are exposed to the model via the existing tool pipeline when the user
 * has an enabled connector. Tool calls go through the chat route's tool handler.
 */

import { getConnector, getConnectorById, getConnectorsByProvider, getAccessToken, touchLastUsed, markNeedsReauth } from "./connectorStore";
import { recordUsage, type UsageKind } from "./recordUsage";
import { extractFile } from "./extractFile";

// ── Tool definitions (OpenAI function-calling schema) ────────────────────────

export const TOOL_SLACK_LIST_CHANNELS = {
  type: "function" as const,
  function: {
    name: "slack_list_channels",
    description: "List Slack channels the user has access to in their connected workspace.",
    parameters: {
      type: "object",
      properties: {
        types: {
          type: "string",
          description: "Comma-separated channel types: public_channel, private_channel, mpim, im. Default: public_channel,private_channel",
        },
      },
    },
  },
};

export const TOOL_SLACK_SEARCH_MESSAGES = {
  type: "function" as const,
  function: {
    name: "slack_search_messages",
    description: "Search messages in the user's Slack workspace. Returns matching messages with author, text, timestamp, permalink, thread replies, and file attachments.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
        channel: { type: "string", description: "Optional: limit search to this channel name (e.g. #general)" },
        after: { type: "string", description: "Optional: only messages after this date (YYYY-MM-DD)" },
        before: { type: "string", description: "Optional: only messages before this date (YYYY-MM-DD)" },
        limit: { type: "integer", description: "Max results to return (default 20, max 50)" },
      },
      required: ["query"],
    },
  },
};

export const TOOL_SLACK_READ_CHANNEL = {
  type: "function" as const,
  function: {
    name: "slack_read_channel",
    description: "Read recent messages from a Slack channel. Returns messages with author name, text, timestamp, permalink, thread replies, and file attachments.",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name (e.g. #general or general) or channel ID" },
        after: { type: "string", description: "Optional: only messages after this date (YYYY-MM-DD)" },
        before: { type: "string", description: "Optional: only messages before this date (YYYY-MM-DD)" },
        limit: { type: "integer", description: "Max messages to return (default 50, max 200)" },
      },
      required: ["channel"],
    },
  },
};

export const TOOL_SLACK_READ_THREAD = {
  type: "function" as const,
  function: {
    name: "slack_read_thread",
    description: "Read all replies in a Slack thread. Use when you need to see what was replied to a specific message (e.g. 'what did the bot reply to X').",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name or ID where the thread is" },
        thread_ts: { type: "string", description: "The thread_ts (timestamp) of the parent message" },
      },
      required: ["channel", "thread_ts"],
    },
  },
};

export const TOOL_DISCORD_LIST_CHANNELS = {
  type: "function" as const,
  function: {
    name: "discord_list_channels",
    description: "List channels in a Discord guild/server the bot has access to.",
    parameters: {
      type: "object",
      properties: {
        guild: { type: "string", description: "Guild/server name or ID. If omitted, uses the connected guild." },
      },
    },
  },
};

export const TOOL_DISCORD_READ_CHANNEL = {
  type: "function" as const,
  function: {
    name: "discord_read_channel",
    description: "Read recent messages from a Discord channel. Uses the bot token (bot must be in the server). Returns messages with author, text, timestamp, thread replies, and file attachments.",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name (e.g. #general or general) or channel ID" },
        guild: { type: "string", description: "Optional guild/server name or ID" },
        after: { type: "string", description: "Optional: only messages after this date (YYYY-MM-DD)" },
        before: { type: "string", description: "Optional: only messages before this date (YYYY-MM-DD)" },
        limit: { type: "integer", description: "Max messages to return (default 50, max 100)" },
      },
      required: ["channel"],
    },
  },
};

export const CONNECTOR_TOOLS_SLACK = [TOOL_SLACK_LIST_CHANNELS, TOOL_SLACK_SEARCH_MESSAGES, TOOL_SLACK_READ_CHANNEL, TOOL_SLACK_READ_THREAD];
export const CONNECTOR_TOOLS_DISCORD = [TOOL_DISCORD_LIST_CHANNELS, TOOL_DISCORD_READ_CHANNEL];
export const ALL_CONNECTOR_TOOLS = [...CONNECTOR_TOOLS_SLACK, ...CONNECTOR_TOOLS_DISCORD];

// ── Intent detection ─────────────────────────────────────────────────────────

const SLACK_INTENT = /\b(slack|#[\w-]+|channel|workspace)\b/i;
const DISCORD_INTENT = /\b(discord|server|guild)\b/i;

export function detectConnectorIntent(text: string): { slack: boolean; discord: boolean } {
  return {
    slack: SLACK_INTENT.test(text),
    discord: DISCORD_INTENT.test(text),
  };
}

/** Get connector tools that should be offered based on user's enabled connectors.
 *  If connectorId is provided, only tools for that connector's provider are returned.
 */
export function getConnectorToolsForUser(userId: string, connectorId?: string): typeof ALL_CONNECTOR_TOOLS {
  // If a specific connector is pinned, only offer its provider's tools
  if (connectorId) {
    const c = getConnectorById(connectorId);
    if (c && c.user_id === userId && c.enabled && c.status !== "needs_reauth") {
      return c.provider === "slack" ? [...CONNECTOR_TOOLS_SLACK] : [...CONNECTOR_TOOLS_DISCORD];
    }
    return [];
  }

  const tools: typeof ALL_CONNECTOR_TOOLS = [];
  const slackConnectors = getConnectorsByProvider(userId, "slack");
  const discordConnectors = getConnectorsByProvider(userId, "discord");

  if (slackConnectors.some((c) => c.enabled && c.status !== "needs_reauth")) {
    tools.push(...CONNECTOR_TOOLS_SLACK);
  }
  if (discordConnectors.some((c) => c.enabled && c.status !== "needs_reauth")) {
    tools.push(...CONNECTOR_TOOLS_DISCORD);
  }

  return tools;
}

// ── Tool execution ───────────────────────────────────────────────────────────

const TOKEN_BUDGET = 12000; // ~12k tokens cap for injected text
const CHARS_PER_TOKEN = 4;
const CHAR_BUDGET = TOKEN_BUDGET * CHARS_PER_TOKEN;
const MAX_THREAD_REPLIES = 20;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const FILE_CHAR_CAP = 3000 * CHARS_PER_TOKEN; // 3k tokens per file

// Slack user cache (teamId → userId → display name)
const slackUserCache = new Map<string, Map<string, string>>();
// Slack bot user ID cache (teamId → bot user ID)
const slackBotUserIdCache = new Map<string, string>();
// Discord user cache (guildId → userId → display name)
const discordUserCache = new Map<string, Map<string, string>>();

interface ToolResult {
  content: string;
  error?: boolean;
}

export async function executeConnectorTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  chatId?: string,
  messageId?: string,
  connectorId?: string,
): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    // Multi-workspace: if no connectorId pinned and multiple enabled connectors exist
    // for this provider, search all and prefix results with workspace name
    const provider = toolName.startsWith("slack_") ? "slack" : "discord";
    if (!connectorId) {
      const allConnectors = getConnectorsByProvider(userId, provider)
        .filter(c => c.enabled && c.status !== "needs_reauth");
      if (allConnectors.length > 1) {
        // Run tool against each workspace in parallel
        const results = await Promise.all(
          allConnectors.map(async (c) => {
            const r = await executeSingleConnectorTool(toolName, args, userId, c.id);
            return { workspaceName: c.external_name || c.external_id, result: r };
          })
        );
        // Merge results, prefixing each with workspace name
        const merged = results
          .filter(r => !r.result.error)
          .map(r => `--- ${r.workspaceName} ---\n${r.result.content}`)
          .join("\n\n");
        if (!merged) {
          // All failed, return first error
          const firstErr = results.find(r => r.result.error);
          return firstErr?.result || { content: "No results from any workspace", error: true };
        }
        const result: ToolResult = { content: merged };

        // Record usage
        const kind = (`tool_${provider}` as UsageKind);
        touchLastUsed(userId, provider);
        recordUsage({
          chat_id: chatId, message_id: messageId, kind, provider,
          model: toolName, input_tokens: 0, output_tokens: 0,
          cost_usd: 0, latency_ms: Date.now() - startTime,
        });
        return result;
      }
    }

    const result = await executeSingleConnectorTool(toolName, args, userId, connectorId);

    // Record usage
    const kindSingle = (`tool_${provider}` as UsageKind);
    touchLastUsed(userId, provider);

    recordUsage({
      chat_id: chatId,
      message_id: messageId,
      kind: kindSingle,
      provider,
      model: toolName,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      latency_ms: Date.now() - startTime,
    });

    return result;
  } catch (err) {
    console.error(`[connector-tool] ${toolName} error:`, err);
    return { content: `Error executing ${toolName}: ${err instanceof Error ? err.message : "Unknown error"}`, error: true };
  }
}

/** Run a single connector tool against one specific workspace (or first available) */
async function executeSingleConnectorTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  connectorId?: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "slack_list_channels":
      return slackListChannels(userId, args, connectorId);
    case "slack_search_messages":
      return slackSearchMessages(userId, args, connectorId);
    case "slack_read_channel":
      return slackReadChannel(userId, args, connectorId);
    case "slack_read_thread":
      return slackReadThread(userId, args, connectorId);
    case "discord_list_channels":
      return discordListChannels(userId, args, connectorId);
    case "discord_read_channel":
      return discordReadChannel(userId, args, connectorId);
    default:
      return { content: `Unknown connector tool: ${toolName}`, error: true };
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Resolve <@U…> mentions in Slack text to @display_name */
async function resolveSlackMentions(text: string, token: string, teamId: string): Promise<string> {
  const mentionPattern = /<@([A-Z0-9]+)>/g;
  const matches = [...text.matchAll(mentionPattern)];
  if (matches.length === 0) return text;

  let resolved = text;
  for (const m of matches) {
    const uid = m[1];
    const name = await getSlackUserName(token, teamId, uid);
    // Check if this is the bot's own user id
    const botId = slackBotUserIdCache.get(teamId);
    const displayName = botId && uid === botId ? "@NiaAI" : `@${name}`;
    resolved = resolved.replace(m[0], displayName);
  }
  return resolved;
}

/** Get the bot's own Slack user ID (cached) */
async function getSlackBotUserId(token: string, teamId: string): Promise<string | null> {
  if (slackBotUserIdCache.has(teamId)) return slackBotUserIdCache.get(teamId)!;
  try {
    const data = await slackApi(token, "auth.test", {});
    if (data.ok && data.user_id) {
      slackBotUserIdCache.set(teamId, data.user_id);
      return data.user_id;
    }
  } catch { /* ignore */ }
  return null;
}

/** Determine if a Slack message is from a bot */
function isSlackBotMessage(msg: any): boolean {
  return !!msg.bot_id || msg.subtype === "bot_message";
}

/** Get author label for a Slack message */
async function getSlackAuthorLabel(msg: any, token: string, teamId: string): Promise<string> {
  if (isSlackBotMessage(msg)) {
    // Check if it's NiaAI's own bot
    const botId = slackBotUserIdCache.get(teamId);
    if (botId && msg.user === botId) return "NiaAI (bot)";
    // Check bot_profile name
    if (msg.bot_profile?.name) return `${msg.bot_profile.name} (bot)`;
    if (msg.username) return `${msg.username} (bot)`;
    return "bot";
  }
  return await getSlackUserName(token, teamId, msg.user || "");
}

/** Format Slack file attachments */
function formatSlackFiles(files: any[]): string {
  if (!files || files.length === 0) return "";
  return files.map((f: any) => `[file: ${f.name || f.title || "unnamed"} (${f.filetype || f.mimetype || "unknown"})]`).join(" ");
}

/** Download and extract a Slack file if it's text/PDF/Office and under 5 MB */
async function extractSlackFile(file: any, token: string): Promise<string | null> {
  if (!file.url_private) return null;
  const size = file.size || 0;
  if (size > MAX_FILE_SIZE) return null;

  const mime = (file.mimetype || "").toLowerCase();
  const name = file.name || file.title || "file";
  const extractable = /^(text\/|application\/(pdf|vnd\.(openxmlformats|ms-)|msword|json|xml))/.test(mime)
    || /\.(txt|md|csv|tsv|json|xml|pdf|docx|xlsx|pptx|doc|xls|ppt|py|js|ts|java|go|rs|c|cpp|html|htm|yaml|yml|toml|ini)$/i.test(name);

  if (!extractable) return null;

  try {
    const res = await fetch(file.url_private, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const result = await extractFile(buf, name, mime);
    if (!result.text) return null;
    const truncated = result.text.slice(0, FILE_CHAR_CAP);
    return truncated;
  } catch {
    return null;
  }
}

/** Fetch and format thread replies for a Slack message */
async function fetchSlackThreadReplies(
  token: string,
  teamId: string,
  channelId: string,
  threadTs: string,
): Promise<{ text: string; count: number }> {
  const data = await slackApi(token, "conversations.replies", {
    channel: channelId,
    ts: threadTs,
    limit: String(MAX_THREAD_REPLIES + 1), // +1 for the parent
  });

  if (!data.ok || !data.messages || data.messages.length <= 1) {
    return { text: "", count: 0 };
  }

  // Skip the first message (it's the parent)
  const replies = data.messages.slice(1, MAX_THREAD_REPLIES + 1);
  const lines: string[] = [];

  for (const reply of replies) {
    const author = await getSlackAuthorLabel(reply, token, teamId);
    const ts = humanizeSlackTs(reply.ts);
    let text = await resolveSlackMentions(reply.text || "", token, teamId);
    const fileText = formatSlackFiles(reply.files);
    if (fileText) text += ` ${fileText}`;
    lines.push(`    [${ts}] ${author}: ${text}`);
  }

  const totalReplies = (data.messages.length - 1);
  const suffix = totalReplies > MAX_THREAD_REPLIES ? ` (showing ${MAX_THREAD_REPLIES} of ${data.headers?.["x-slack-num-replies"] || totalReplies}+)` : "";

  return {
    text: `  thread (${totalReplies} replies${suffix}):\n${lines.join("\n")}`,
    count: totalReplies,
  };
}

// ── Slack tool implementations ───────────────────────────────────────────────

async function slackApi(token: string, method: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function getSlackUserName(token: string, teamId: string, slackUserId: string): Promise<string> {
  if (!slackUserId) return "unknown";
  if (!slackUserCache.has(teamId)) slackUserCache.set(teamId, new Map());
  const cache = slackUserCache.get(teamId)!;
  if (cache.has(slackUserId)) return cache.get(slackUserId)!;

  try {
    const data = await slackApi(token, "users.info", { user: slackUserId });
    const name = data.user?.real_name || data.user?.name || slackUserId;
    cache.set(slackUserId, name);
    return name;
  } catch {
    return slackUserId;
  }
}

function humanizeSlackTs(ts: string): string {
  const d = new Date(parseFloat(ts) * 1000);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function getSlackToken(userId: string, connectorId?: string): { token: string; teamId: string; workspaceName: string; error?: undefined } | ToolResult {
  let connector;
  if (connectorId) {
    connector = getConnectorById(connectorId);
    if (connector && (connector.user_id !== userId || connector.provider !== "slack")) connector = undefined;
  } else {
    connector = getConnector(userId, "slack");
  }
  if (!connector) {
    return { content: "No Slack workspace connected. Please connect Slack from the Connectors page.", error: true };
  }
  if (!connector.enabled) {
    return { content: "Slack connector is disabled. Enable it from the Connectors panel.", error: true };
  }
  if (connector.status === "needs_reauth") {
    return { content: "Slack connection expired. Please reconnect from the Connectors page.", error: true };
  }
  try {
    const token = getAccessToken(connector);
    return { token, teamId: connector.external_id, workspaceName: connector.external_name || connector.external_id };
  } catch {
    markNeedsReauth(userId, "slack");
    return { content: "Failed to decrypt Slack token. Please reconnect.", error: true };
  }
}

async function resolveSlackChannel(token: string, channelInput: string): Promise<string | null> {
  // If it looks like an ID (C...), use directly
  if (/^[A-Z0-9]{9,}$/.test(channelInput)) return channelInput;

  // Strip # prefix
  const name = channelInput.replace(/^#/, "").toLowerCase();

  // List channels and find by name
  const data = await slackApi(token, "conversations.list", {
    types: "public_channel,private_channel",
    limit: "200",
    exclude_archived: "true",
  });

  if (!data.ok) return null;
  const match = data.channels?.find((ch: any) => ch.name === name || ch.name_normalized === name);
  return match?.id || null;
}

async function slackListChannels(userId: string, args: Record<string, unknown>, connectorId?: string): Promise<ToolResult> {
  const auth = getSlackToken(userId, connectorId);
  if (!("token" in auth)) return auth;

  const types = (args.types as string) || "public_channel,private_channel";
  const data = await slackApi(auth.token, "conversations.list", {
    types,
    limit: "200",
    exclude_archived: "true",
  });

  if (!data.ok) {
    if (data.error === "token_revoked" || data.error === "invalid_auth") {
      markNeedsReauth(userId, "slack");
      return { content: "Slack token has been revoked. Please reconnect from Connectors.", error: true };
    }
    return { content: `Slack API error: ${data.error}`, error: true };
  }

  const channels = (data.channels || []).map((ch: any) => ({
    name: `#${ch.name}`,
    id: ch.id,
    members: ch.num_members,
    topic: ch.topic?.value || "",
    purpose: ch.purpose?.value || "",
  }));

  return { content: JSON.stringify(channels, null, 2) };
}

async function slackSearchMessages(userId: string, args: Record<string, unknown>, connectorId?: string): Promise<ToolResult> {
  const auth = getSlackToken(userId, connectorId);
  if (!("token" in auth)) return auth;

  // Cache bot user ID for mention resolution
  await getSlackBotUserId(auth.token, auth.teamId);

  let query = args.query as string;
  if (args.channel) query += ` in:${(args.channel as string).replace(/^#/, "")}`;
  if (args.after) query += ` after:${args.after}`;
  if (args.before) query += ` before:${args.before}`;

  const limit = Math.min(Number(args.limit) || 20, 50);

  const data = await slackApi(auth.token, "search.messages", {
    query,
    count: String(limit),
    sort: "timestamp",
    sort_dir: "desc",
  });

  if (!data.ok) {
    if (data.error === "token_revoked" || data.error === "invalid_auth" || data.error === "missing_scope") {
      markNeedsReauth(userId, "slack");
      return { content: `Slack error: ${data.error}. Please reconnect from Connectors.`, error: true };
    }
    return { content: `Slack search error: ${data.error}`, error: true };
  }

  const matches = data.messages?.matches || [];

  // Pre-fetch all user IDs in parallel
  const userIds = new Set<string>();
  for (const msg of matches) {
    if (msg.user) userIds.add(msg.user);
  }
  await Promise.all([...userIds].map(uid => getSlackUserName(auth.token, auth.teamId, uid)));

  // Pre-fetch thread replies in parallel (max 20 threads, concurrency 5)
  const threadEntries = matches
    .filter((msg: any) => (msg.reply_count > 0 || msg.thread_ts) && msg.channel?.id)
    .slice(0, 20);
  const threadMap = new Map<string, { text: string; count: number }>();
  const THREAD_CONCURRENCY = 5;
  for (let i = 0; i < threadEntries.length; i += THREAD_CONCURRENCY) {
    const batch = threadEntries.slice(i, i + THREAD_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((msg: any) => {
        const threadTs = msg.thread_ts || msg.ts;
        return fetchSlackThreadReplies(auth.token, auth.teamId, msg.channel.id, threadTs);
      })
    );
    batch.forEach((msg: any, idx: number) => {
      const key = `${msg.channel.id}:${msg.thread_ts || msg.ts}`;
      if (batchResults[idx].text) threadMap.set(key, batchResults[idx]);
    });
  }

  let totalChars = 0;
  const results: string[] = [];

  for (const msg of matches) {
    const author = await getSlackAuthorLabel(msg, auth.token, auth.teamId);
    const ts = humanizeSlackTs(msg.ts);
    const channel = msg.channel?.name ? `#${msg.channel.name}` : "";
    let text = await resolveSlackMentions(msg.text || "", auth.token, auth.teamId);
    const permalink = msg.permalink || "";

    const fileText = formatSlackFiles(msg.files);
    if (fileText) text += ` ${fileText}`;

    if (msg.files && msg.files.length > 0) {
      for (const file of msg.files) {
        const extracted = await extractSlackFile(file, auth.token);
        if (extracted) {
          text += `\n  [content of ${file.name}]: ${extracted}`;
        }
      }
    }

    let entry = `[${ts}] ${author} in ${channel}: ${text}\n${permalink}`;

    // Thread replies — from pre-fetched map
    if (msg.channel?.id) {
      const key = `${msg.channel.id}:${msg.thread_ts || msg.ts}`;
      const thread = threadMap.get(key);
      if (thread) entry += `\n${thread.text}`;
    }

    totalChars += entry.length;
    if (totalChars > CHAR_BUDGET) break;
    results.push(entry);
  }

  if (results.length === 0) {
    return { content: `No Slack messages found for query: "${args.query}"` };
  }

  return { content: `Found ${matches.length} messages (showing ${results.length}):\n\n${results.join("\n\n")}` };
}

async function slackReadChannel(userId: string, args: Record<string, unknown>, connectorId?: string): Promise<ToolResult> {
  const auth = getSlackToken(userId, connectorId);
  if (!("token" in auth)) return auth;

  // Cache bot user ID for mention resolution
  await getSlackBotUserId(auth.token, auth.teamId);

  const channelInput = args.channel as string;
  const channelId = await resolveSlackChannel(auth.token, channelInput);

  if (!channelId) {
    return { content: `Could not find Slack channel "${channelInput}". Use slack_list_channels to see available channels.`, error: true };
  }

  const limit = Math.min(Number(args.limit) || 50, 200);
  const params: Record<string, string> = {
    channel: channelId,
    limit: String(limit),
  };

  // Date filters → Slack timestamps
  if (args.after) {
    const d = new Date(args.after as string);
    if (!isNaN(d.getTime())) params.oldest = String(d.getTime() / 1000);
  }
  if (args.before) {
    const d = new Date(args.before as string);
    if (!isNaN(d.getTime())) params.latest = String(d.getTime() / 1000);
  }

  const data = await slackApi(auth.token, "conversations.history", params);

  if (!data.ok) {
    if (data.error === "token_revoked" || data.error === "invalid_auth" || data.error === "missing_scope") {
      markNeedsReauth(userId, "slack");
      return { content: `Slack error: ${data.error}. Please reconnect from Connectors.`, error: true };
    }
    if (data.error === "channel_not_found" || data.error === "not_in_channel") {
      return { content: `Cannot access channel "${channelInput}": ${data.error}`, error: true };
    }
    return { content: `Slack API error: ${data.error}`, error: true };
  }

  const allMessages = (data.messages || []).reverse(); // chronological
  // Filter out join/leave and limit to 200
  const messages = allMessages.filter((msg: any) => msg.subtype !== "channel_join" && msg.subtype !== "channel_leave").slice(0, 200);

  // Pre-fetch all unique user IDs in parallel (warm the cache)
  const userIds = new Set<string>();
  for (const msg of messages) {
    if (msg.user) userIds.add(msg.user);
  }
  await Promise.all([...userIds].map(uid => getSlackUserName(auth.token, auth.teamId, uid)));

  // Identify messages with threads (limit to 20 threads)
  const threadMessages = messages.filter((msg: any) => msg.reply_count > 0 || (msg.thread_ts && msg.thread_ts === msg.ts)).slice(0, 20);

  // Fetch all thread replies in parallel (concurrency 5)
  const threadMap = new Map<string, { text: string; count: number }>();
  const THREAD_CONCURRENCY = 5;
  for (let i = 0; i < threadMessages.length; i += THREAD_CONCURRENCY) {
    const batch = threadMessages.slice(i, i + THREAD_CONCURRENCY);
    const results = await Promise.all(
      batch.map((msg: any) => fetchSlackThreadReplies(auth.token, auth.teamId, channelId, msg.ts))
    );
    batch.forEach((msg: any, idx: number) => {
      if (results[idx].text) threadMap.set(msg.ts, results[idx]);
    });
  }

  // Now build results (fast — all data is cached/pre-fetched)
  let totalChars = 0;
  const results: string[] = [];

  for (const msg of messages) {
    const author = await getSlackAuthorLabel(msg, auth.token, auth.teamId);
    const ts = humanizeSlackTs(msg.ts);
    let text = await resolveSlackMentions(msg.text || "", auth.token, auth.teamId);
    const permalink = `https://slack.com/archives/${channelId}/p${msg.ts.replace(".", "")}`;

    // File attachments
    const fileText = formatSlackFiles(msg.files);
    if (fileText) text += ` ${fileText}`;

    // Extract file contents if applicable
    if (msg.files && msg.files.length > 0) {
      for (const file of msg.files) {
        const extracted = await extractSlackFile(file, auth.token);
        if (extracted) {
          text += `\n  [content of ${file.name}]: ${extracted}`;
        }
      }
    }

    let entry = `[${ts}] ${author}: ${text}\n${permalink}`;

    // Thread replies — from pre-fetched map
    const thread = threadMap.get(msg.ts);
    if (thread) entry += `\n${thread.text}`;

    if (totalChars + entry.length > CHAR_BUDGET) {
      results.push(`... (${messages.length - results.length} older messages truncated to stay within token budget)`);
      break;
    }
    totalChars += entry.length;
    results.push(entry);
  }

  if (results.length === 0) {
    return { content: `No messages found in ${channelInput} for the specified time range.` };
  }

  return { content: `${results.length} messages from ${channelInput}:\n\n${results.join("\n\n")}` };
}

/** Dedicated tool: read all replies in a Slack thread */
async function slackReadThread(userId: string, args: Record<string, unknown>, connectorId?: string): Promise<ToolResult> {
  const auth = getSlackToken(userId, connectorId);
  if (!("token" in auth)) return auth;

  // Cache bot user ID
  await getSlackBotUserId(auth.token, auth.teamId);

  const channelInput = args.channel as string;
  const threadTs = args.thread_ts as string;

  if (!threadTs) {
    return { content: "thread_ts is required. Provide the timestamp of the parent message.", error: true };
  }

  const channelId = await resolveSlackChannel(auth.token, channelInput);
  if (!channelId) {
    return { content: `Could not find Slack channel "${channelInput}". Use slack_list_channels to see available channels.`, error: true };
  }

  const data = await slackApi(auth.token, "conversations.replies", {
    channel: channelId,
    ts: threadTs,
    limit: "200",
  });

  if (!data.ok) {
    if (data.error === "thread_not_found") {
      return { content: `Thread not found. Check the thread_ts value.`, error: true };
    }
    return { content: `Slack API error: ${data.error}`, error: true };
  }

  if (!data.messages || data.messages.length === 0) {
    return { content: "No messages found in this thread." };
  }

  let totalChars = 0;
  const results: string[] = [];

  for (const msg of data.messages) {
    const author = await getSlackAuthorLabel(msg, auth.token, auth.teamId);
    const ts = humanizeSlackTs(msg.ts);
    let text = await resolveSlackMentions(msg.text || "", auth.token, auth.teamId);
    const isParent = msg.ts === threadTs;

    // File attachments
    const fileText = formatSlackFiles(msg.files);
    if (fileText) text += ` ${fileText}`;

    if (msg.files && msg.files.length > 0) {
      for (const file of msg.files) {
        const extracted = await extractSlackFile(file, auth.token);
        if (extracted) {
          text += `\n  [content of ${file.name}]: ${extracted}`;
        }
      }
    }

    const prefix = isParent ? "[parent] " : "  ";
    const entry = `${prefix}[${ts}] ${author}: ${text}`;

    if (totalChars + entry.length > CHAR_BUDGET) {
      results.push(`... (${data.messages.length - results.length} more replies truncated)`);
      break;
    }
    totalChars += entry.length;
    results.push(entry);
  }

  return { content: `Thread in ${channelInput} (${data.messages.length} messages):\n\n${results.join("\n")}` };
}

// ── Discord tool implementations ─────────────────────────────────────────────

function getDiscordBotToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN || null;
}

function getDiscordBotInviteUrl(guildId?: string): string {
  const clientId = process.env.DISCORD_CLIENT_ID || "";
  const perms = "274877991936"; // Read Messages, Read Message History, View Channels
  let url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms}&scope=bot`;
  if (guildId) url += `&guild_id=${guildId}`;
  return url;
}

async function discordBotApi(endpoint: string): Promise<any> {
  const token = getDiscordBotToken();
  if (!token) throw new Error("DISCORD_BOT_TOKEN not configured");

  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    headers: { Authorization: `Bot ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** Get Discord user display name (cached) */
async function getDiscordUserName(guildId: string, userId: string): Promise<string> {
  if (!discordUserCache.has(guildId)) discordUserCache.set(guildId, new Map());
  const cache = discordUserCache.get(guildId)!;
  if (cache.has(userId)) return cache.get(userId)!;

  try {
    const member = await discordBotApi(`/guilds/${guildId}/members/${userId}`);
    const name = member.nick || member.user?.global_name || member.user?.username || userId;
    cache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

/** Resolve <@id> mentions in Discord message text */
async function resolveDiscordMentions(text: string, guildId: string, botUserId?: string): Promise<string> {
  const mentionPattern = /<@!?(\d{17,20})>/g;
  const matches = [...text.matchAll(mentionPattern)];
  if (matches.length === 0) return text;

  let resolved = text;
  for (const m of matches) {
    const uid = m[1];
    if (botUserId && uid === botUserId) {
      resolved = resolved.replace(m[0], "@NiaAI");
    } else {
      const name = await getDiscordUserName(guildId, uid);
      resolved = resolved.replace(m[0], `@${name}`);
    }
  }
  return resolved;
}

/** Get Discord bot's own user ID */
let discordBotUserId: string | null = null;
async function getDiscordBotUserId(): Promise<string | null> {
  if (discordBotUserId) return discordBotUserId;
  try {
    const me = await discordBotApi("/users/@me");
    discordBotUserId = me.id;
    return me.id;
  } catch {
    return null;
  }
}

/** Check if a Discord message is from the NiaAI bot */
function isDiscordBotMessage(msg: any, botUserId: string | null): boolean {
  return !!msg.author?.bot;
}

/** Get author label for a Discord message */
function getDiscordAuthorLabel(msg: any, botUserId: string | null): string {
  if (msg.author?.bot) {
    if (botUserId && msg.author.id === botUserId) return "NiaAI (bot)";
    return `${msg.author.username || "bot"} (bot)`;
  }
  return msg.author?.global_name || msg.author?.username || "unknown";
}

/** Fetch thread messages for a Discord message that has a thread */
async function fetchDiscordThreadReplies(
  threadChannelId: string,
  guildId: string,
  botUserId: string | null,
): Promise<{ text: string; count: number }> {
  try {
    const messages = await discordBotApi(`/channels/${threadChannelId}/messages?limit=${MAX_THREAD_REPLIES}`);
    if (!Array.isArray(messages) || messages.length === 0) return { text: "", count: 0 };

    const sorted = [...messages].reverse();
    const lines: string[] = [];

    for (const reply of sorted) {
      const author = getDiscordAuthorLabel(reply, botUserId);
      const ts = new Date(reply.timestamp).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
      });
      const text = await resolveDiscordMentions(reply.content || "", guildId, botUserId || undefined);
      lines.push(`    [${ts}] ${author}: ${text}`);
    }

    return {
      text: `  thread (${sorted.length} replies):\n${lines.join("\n")}`,
      count: sorted.length,
    };
  } catch {
    return { text: "", count: 0 };
  }
}

async function resolveDiscordGuild(userId: string, guildInput?: string, connectorId?: string): Promise<string | null> {
  // If provided and looks like a snowflake, use directly
  if (guildInput && /^\d{17,20}$/.test(guildInput)) return guildInput;

  // Check connector for stored guild
  const connector = connectorId ? getConnectorById(connectorId) : getConnector(userId, "discord");
  if (connector && !guildInput) return connector.external_id;

  // If a name was given, try to find the guild by name
  if (guildInput) {
    const botGuilds = await discordBotApi("/users/@me/guilds");
    const match = botGuilds.find((g: any) => g.name.toLowerCase() === guildInput.toLowerCase() || g.id === guildInput);
    return match?.id || null;
  }

  // Fallback to env guild ID
  return process.env.DISCORD_GUILD_ID || null;
}

async function resolveDiscordChannel(guildId: string, channelInput: string): Promise<string | null> {
  if (/^\d{17,20}$/.test(channelInput)) return channelInput;

  const name = channelInput.replace(/^#/, "").toLowerCase();
  const channels = await discordBotApi(`/guilds/${guildId}/channels`);
  const match = channels.find((ch: any) => ch.name === name && ch.type === 0);
  return match?.id || null;
}

async function discordListChannels(userId: string, args: Record<string, unknown>, connectorId?: string): Promise<ToolResult> {
  const connector = connectorId ? getConnectorById(connectorId) : getConnector(userId, "discord");
  if (!connector || !connector.enabled) {
    return { content: "No Discord server connected. Please connect Discord from the Connectors page.", error: true };
  }

  const botToken = getDiscordBotToken();
  if (!botToken) {
    return { content: "Discord bot token not configured. The bot must be in the server to read messages.", error: true };
  }

  const guildId = await resolveDiscordGuild(userId, args.guild as string, connectorId);
  if (!guildId) {
    return { content: "Could not resolve Discord guild. Provide a guild name or ID.", error: true };
  }

  try {
    const channels = await discordBotApi(`/guilds/${guildId}/channels`);
    const textChannels = channels
      .filter((ch: any) => ch.type === 0) // text channels only
      .map((ch: any) => ({
        name: `#${ch.name}`,
        id: ch.id,
        topic: ch.topic || "",
        category: ch.parent_id || null,
      }));

    return { content: JSON.stringify(textChannels, null, 2) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Bot not in guild → suggest invite
    if (msg.includes("403") || msg.includes("50001")) {
      const inviteUrl = getDiscordBotInviteUrl(guildId);
      return { content: `NiaAI bot is not in this server. Add it here: ${inviteUrl}`, error: true };
    }
    return { content: `Discord API error: ${msg}`, error: true };
  }
}

async function discordReadChannel(userId: string, args: Record<string, unknown>, connectorId?: string): Promise<ToolResult> {
  const connector = connectorId ? getConnectorById(connectorId) : getConnector(userId, "discord");
  if (!connector || !connector.enabled) {
    return { content: "No Discord server connected. Please connect Discord from the Connectors page.", error: true };
  }

  const botToken = getDiscordBotToken();
  if (!botToken) {
    return { content: "Discord bot token not configured.", error: true };
  }

  const guildId = await resolveDiscordGuild(userId, args.guild as string, connectorId);
  if (!guildId) {
    return { content: "Could not resolve Discord guild.", error: true };
  }

  const channelInput = args.channel as string;
  const channelId = await resolveDiscordChannel(guildId, channelInput);
  if (!channelId) {
    return { content: `Could not find Discord channel "${channelInput}". Use discord_list_channels to see available channels.`, error: true };
  }

  // Get bot user ID for mention resolution and bot labeling
  const botUserId = await getDiscordBotUserId();

  const limit = Math.min(Number(args.limit) || 50, 100);

  try {
    let endpoint = `/channels/${channelId}/messages?limit=${limit}`;

    // Date filters → snowflake timestamps
    if (args.after) {
      const d = new Date(args.after as string);
      if (!isNaN(d.getTime())) {
        // Discord snowflake: (timestamp_ms - 1420070400000) << 22
        const snowflake = String((d.getTime() - 1420070400000) * 4194304);
        endpoint += `&after=${snowflake}`;
      }
    }
    if (args.before) {
      const d = new Date(args.before as string);
      if (!isNaN(d.getTime())) {
        const snowflake = String((d.getTime() - 1420070400000) * 4194304);
        endpoint += `&before=${snowflake}`;
      }
    }

    const messages = await discordBotApi(endpoint);

    if (!Array.isArray(messages) || messages.length === 0) {
      return { content: `No messages found in ${channelInput} for the specified time range.` };
    }

    // Reverse to chronological order
    const sorted = [...messages].reverse();

    let totalChars = 0;
    const results: string[] = [];

    for (const msg of sorted) {
      const author = getDiscordAuthorLabel(msg, botUserId);
      const ts = new Date(msg.timestamp).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
      });
      let text = await resolveDiscordMentions(msg.content || "", guildId, botUserId || undefined);

      // File attachments
      if (msg.attachments && msg.attachments.length > 0) {
        const fileLabels = msg.attachments.map((a: any) =>
          `[file: ${a.filename || "unnamed"} (${a.content_type || "unknown"})]`
        ).join(" ");
        text += ` ${fileLabels}`;
      }

      let entry = `[${ts}] ${author}: ${text}`;

      // Thread replies — if message has a thread channel
      if (msg.thread?.id) {
        const thread = await fetchDiscordThreadReplies(msg.thread.id, guildId, botUserId);
        if (thread.text) entry += `\n${thread.text}`;
      }

      if (totalChars + entry.length > CHAR_BUDGET) {
        results.push(`... (${sorted.length - results.length} older messages truncated to stay within token budget)`);
        break;
      }
      totalChars += entry.length;
      results.push(entry);
    }

    return { content: `${results.length} messages from ${channelInput}:\n\n${results.join("\n\n")}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("403") || msg.includes("50001")) {
      const inviteUrl = getDiscordBotInviteUrl(guildId);
      return { content: `NiaAI bot is not in this server. Add it here: ${inviteUrl}`, error: true };
    }
    return { content: `Discord API error: ${msg}`, error: true };
  }
}
