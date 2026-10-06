import 'dotenv/config';
import { App, LogLevel } from '@slack/bolt';
import { streamChat, uploadToNia, sendHeartbeat, downloadFromNia, NiaSSEEvent } from './nia-client';
import { markdownToSlack, splitMessage, buildSourceBlocks, processCitations } from './markdown-to-slack';
import { withThreadLock, withRetry } from './rate-limiter';

// ─── Config ──────────────────────────────────────────────────────────────────

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN || !SLACK_SIGNING_SECRET) {
  console.error('[slack-bot] Missing required env vars: SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET');
  process.exit(1);
}

const NIA_APP_URL = process.env.NIA_APP_URL || process.env.NIA_BASE_URL || 'http://localhost:3000';
const NIA_GATEWAY_URL = process.env.NIA_GATEWAY_URL || '';
if (NIA_GATEWAY_URL && NIA_APP_URL === NIA_GATEWAY_URL) {
  console.error(`[slack-bot] FATAL: NIA_APP_URL (${NIA_APP_URL}) equals NIA_GATEWAY_URL (${NIA_GATEWAY_URL}). NIA_APP_URL should point to the Next.js app (e.g. http://localhost:3000), not the gateway.`);
  process.exit(1);
}
console.log(`[slack-bot] NIA_APP_URL=${NIA_APP_URL}`);

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

// ─── State ───────────────────────────────────────────────────────────────────

// Thread → NiaAI chat ID mapping for conversation memory
const threadChatMap = new Map<string, string>();

// Threads the bot has participated in (channel:thread_ts)
const botParticipatedThreads = new Set<string>();

// Deduplication: set of handled message keys (client_msg_id or channel:ts)
const handledMessages = new Set<string>();
const HANDLED_MSG_TTL = 60_000; // 60s — evict old entries to prevent memory leak

// Bot user ID (resolved on startup)
let botUserId = '';

// DM user → daily chat ID mapping (one chat per user per day)
const dmChatMap = new Map<string, { chatId: string; date: string }>();

// User → preferred model
const userModels = new Map<string, string>();

// Connection status (exported for the settings API)
let connectionStatus: {
  connected: boolean;
  workspace?: string;
  botUser?: string;
  lastEventTime?: string;
} = { connected: false };

export function getConnectionStatus() {
  return connectionStatus;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getThreadKey(channel: string, threadTs?: string): string {
  return `${channel}:${threadTs || 'root'}`;
}

function getChatId(channel: string, threadTs?: string, userId?: string): string {
  const key = threadTs ? `${channel}:${threadTs}` : `dm:${userId}`;

  if (threadTs) {
    const existing = threadChatMap.get(key);
    if (existing) return existing;
    const id = `slack-${channel}-${threadTs}`;
    threadChatMap.set(key, id);
    return id;
  }

  // DM: one chat per user per day
  const today = new Date().toISOString().slice(0, 10);
  const dmKey = `dm:${userId}`;
  const existing = dmChatMap.get(dmKey);
  if (existing && existing.date === today) return existing.chatId;
  const id = `slack-dm-${userId}-${today}`;
  dmChatMap.set(dmKey, { chatId: id, date: today });
  return id;
}

/** Resolve a channel ID to its human name via conversations.info (cached). */
const channelNameCache = new Map<string, string>();

async function resolveChannelName(channelId: string): Promise<{ name: string; isDm: boolean }> {
  // Check cache first
  const cached = channelNameCache.get(channelId);
  if (cached) return { name: cached, isDm: cached === '__DM__' };

  try {
    const info = await app.client.conversations.info({ channel: channelId });
    const ch = info.channel as any;
    const isDm = ch?.is_im === true;
    if (isDm) {
      channelNameCache.set(channelId, '__DM__');
      return { name: '__DM__', isDm: true };
    }
    const name = ch?.name || channelId;
    channelNameCache.set(channelId, name);
    return { name, isDm: false };
  } catch {
    channelNameCache.set(channelId, channelId);
    return { name: channelId, isDm: false };
  }
}

async function downloadSlackFile(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function getUserDisplayName(userId: string): Promise<string> {
  try {
    const result = await app.client.users.info({ user: userId });
    return result.user?.profile?.display_name || result.user?.real_name || userId;
  } catch {
    return userId;
  }
}

// ─── Core: handle a message and stream the response ──────────────────────────

async function handleMessage(
  text: string,
  channel: string,
  threadTs: string,
  userId: string,
  files?: Array<{ url_private: string; name: string; mimetype: string }>,
) {
  const threadKey = getThreadKey(channel, threadTs);
  const [userName, channelInfo] = await Promise.all([
    getUserDisplayName(userId),
    resolveChannelName(channel),
  ]);

  // Track that the bot has participated in this thread
  botParticipatedThreads.add(`${channel}:${threadTs}`);

  console.log(`[slack-bot] thread=${threadTs} channel=${channel} user=${userId} (${userName}) text="${text.slice(0, 60)}"`);

  // React with 👀
  try {
    await withRetry(() =>
      app.client.reactions.add({ channel, name: 'eyes', timestamp: threadTs })
    );
  } catch {}

  // Post initial "Thinking…" message
  const thinkingMsg = await withRetry(() =>
    app.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: '💭 Thinking…',
      unfurl_links: false,
      unfurl_media: false,
    })
  );
  const messageTs = thinkingMsg.ts!;

  try {
    // ── Download Slack file attachments ──
    // If no files on this message, check earlier thread messages for files
    let effectiveFiles = files;
    if ((!effectiveFiles || effectiveFiles.length === 0) && threadTs) {
      try {
        const replies = await app.client.conversations.replies({
          channel,
          ts: threadTs,
          limit: 20,
        });
        const threadFiles: Array<{ url_private: string; name: string; mimetype: string }> = [];
        for (const msg of replies.messages || []) {
          const msgFiles = (msg as any).files;
          if (msgFiles && Array.isArray(msgFiles)) {
            for (const f of msgFiles) {
              if (f.url_private_download || f.url_private) {
                threadFiles.push({
                  url_private: f.url_private_download || f.url_private,
                  name: f.name || 'file',
                  mimetype: f.mimetype || 'application/octet-stream',
                });
              }
            }
          }
        }
        if (threadFiles.length > 0) {
          effectiveFiles = threadFiles;
          console.log(`[slack] thread_files=${threadFiles.length} (inherited from earlier messages)`);
        }
      } catch (err) {
        console.error('[slack-bot] Failed to fetch thread files:', err);
      }
    }

    const niaAttachments: Array<{ id: string; name: string; mimeType: string; extractedText?: string }> = [];
    if (effectiveFiles?.length) {
      console.log(`[slack] files=${effectiveFiles.length}`);
      for (const file of effectiveFiles) {
        try {
          // Status: "Reading {name}…" (show file count hint for archives)
          const isZip = /\.(zip|rar|7z|tar|gz)$/i.test(file.name);
          const statusText = isZip
            ? `📦 Reading ${file.name}…`
            : `📄 Reading ${file.name}…`;
          try {
            await withRetry(() =>
              app.client.chat.update({ channel, ts: messageTs, text: statusText })
            );
          } catch {}

          const buf = await downloadSlackFile(file.url_private);

          // Cap at 25 MB
          if (buf.length > 25 * 1024 * 1024) {
            console.log(`[slack] skipping ${file.name} — ${Math.round(buf.length / 1024 / 1024)}MB exceeds 25MB cap`);
            continue;
          }

          const uploaded = await uploadToNia(buf, file.name, file.mimetype);
          if (uploaded) {
            niaAttachments.push({
              id: uploaded.id,
              name: file.name,
              mimeType: file.mimetype,
              extractedText: uploaded.extractedText,
            });

            // Update status with extraction details for archives
            if (isZip && uploaded.entries) {
              try {
                await withRetry(() =>
                  app.client.chat.update({
                    channel, ts: messageTs,
                    text: `📦 Reading ${file.name} (${uploaded.entries} files)…`,
                  })
                );
              } catch {}
            }
          }
        } catch (err) {
          console.error(`[slack-bot] Failed to process file ${file.name}:`, err);
        }
      }
    }

    const model = userModels.get(userId);

    // Stream from NiaAI — send only {text, channel_id, thread_ts, slack_user_id}
    // The server persists and manages conversation history
    let accumulated = '';
    let sources: Array<{ title: string; url: string; favicon?: string }> = [];
    let lastUpdateTime = 0;
    let fileUploaded = false;
    let imageUploaded = false;
    let errorReceived = false;
    const streamStartTime = Date.now();
    const UPDATE_INTERVAL = 800; // ms

    // Deferred file/image events — processed AFTER the SSE stream ends
    // so downloads don't block the reader and cause abort timeouts
    const pendingFiles: NiaSSEEvent[] = [];
    const pendingImages: NiaSSEEvent[] = [];

    // Helper: update placeholder with elapsed time
    const updatePlaceholder = async (statusText: string) => {
      const elapsed = Math.round((Date.now() - streamStartTime) / 1000);
      const suffix = elapsed > 3 ? ` (${elapsed}s)` : '';
      try {
        await withRetry(() =>
          app.client.chat.update({
            channel,
            ts: messageTs,
            text: `${statusText}${suffix}`,
          })
        );
      } catch {}
    };

    for await (const event of streamChat({
      text,
      channel_id: channel,
      thread_ts: threadTs,
      slack_user_id: userId,
      slack_user_name: userName,
      channel_name: channelInfo.isDm ? undefined : channelInfo.name,
      model,
      web_search: true,
      ...(niaAttachments.length ? { attachments: niaAttachments } : {}),
    })) {
      connectionStatus.lastEventTime = new Date().toISOString();

      // Log every event type
      if (event.type === 'file') {
        console.log(`[slack] evt=file filename=${event.filename || '?'} pages=${event.pages || '?'} size=${event.size_bytes || '?'}`);
      } else if (event.type === 'image') {
        console.log(`[slack] evt=image id=${event.id || '?'} prompt="${(event.revised_prompt || '').slice(0, 60)}"`);
      } else if (event.type === 'status') {
        console.log(`[slack] evt=status text="${event.text || ''}"`);
      } else if (event.type === 'content') {
        // Only log periodically to avoid spam
        if (!accumulated) console.log(`[slack] evt=content (first token)`);
      } else if (event.type === 'sources') {
        console.log(`[slack] evt=sources count=${event.items?.length || 0}`);
      } else if (event.type === 'usage') {
        console.log(`[slack] evt=usage in=${event.usage?.input_tokens || 0} out=${event.usage?.output_tokens || 0} served=${event.usage?.served_model || '?'}`);
      } else if (event.type === 'error') {
        console.log(`[slack] evt=error text="${(event.text || '').slice(0, 100)}"`);
      } else if (event.type === 'done') {
        console.log(`[slack] evt=done finish=${event.finish_reason || '?'}`);
      } else {
        console.log(`[slack] evt=${event.type}`);
      }

      // ── Handle status events — update placeholder text ──
      if (event.type === 'status' && event.text) {
        await updatePlaceholder(event.text);
      }

      // ── Handle content tokens ──
      if (event.type === 'content' && event.text) {
        accumulated += event.text;

        // Throttle updates to every ~800ms
        const now = Date.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
          lastUpdateTime = now;
          const slackText = markdownToSlack(accumulated);
          try {
            await withRetry(() =>
              app.client.chat.update({
                channel,
                ts: messageTs,
                text: slackText.slice(0, 3900) + (slackText.length > 3900 ? '…' : ''),
              })
            );
          } catch {}
        }
      }

      // ── Handle sources ──
      if (event.type === 'sources' && event.items) {
        sources = event.items;
      }

      // ── Handle replace_content event — clear accumulated text ──
      if (event.type === 'replace_content') {
        accumulated = '';
      }

      // ── Defer file events — download AFTER stream ends to not block reader ──
      if (event.type === 'file' && event.url) {
        pendingFiles.push(event);
      }

      // ── Defer image events — download AFTER stream ends to not block reader ──
      if (event.type === 'image' && event.url) {
        pendingImages.push(event);
      }

      // ── Handle errors ──
      if (event.type === 'error') {
        accumulated = `⚠️ ${event.text || 'An error occurred'}`;
        errorReceived = true;
      }
    }

    // ── SSE stream is fully closed — now download and upload deferred files/images ──
    // These have their own AbortControllers (60s each), never share with SSE

    for (const fileEvt of pendingFiles) {
      try {
        await updatePlaceholder(`📄 Uploading ${fileEvt.filename || 'document'}…`);

        const downloaded = await downloadFromNia(fileEvt.url!);
        if (downloaded) {
          // Build a one-line summary for initial_comment
          const title = fileEvt.title || fileEvt.filename || 'Document';
          const sizeKB = Math.round((fileEvt.size_bytes || 0) / 1024);
          const pageSuffix = fileEvt.pages ? `${fileEvt.pages} pages` : '';
          const sizeSuffix = sizeKB ? `${sizeKB} KB` : '';
          const meta = [pageSuffix, sizeSuffix].filter(Boolean).join(' · ');
          // If model produced text, use that as initial_comment; otherwise use the title + meta
          const comment = accumulated && accumulated.length > 10
            ? markdownToSlack(processCitations(accumulated, sources))
            : `${title}${meta ? ` — ${meta}` : ''}`;

          await withRetry(() =>
            app.client.filesUploadV2({
              channel_id: channel,
              thread_ts: threadTs,
              filename: downloaded.filename || fileEvt.filename || 'document.pdf',
              file: downloaded.buffer,
              title: title,
              initial_comment: comment,
            })
          );
          fileUploaded = true;
          console.log(`[slack] uploaded file=${fileEvt.file_id} (${fileEvt.filename}) to thread=${threadTs}`);

          // Delete the "Thinking…" placeholder — the file message is the only bot message
          try {
            await app.client.chat.delete({ channel, ts: messageTs });
            console.log(`[slack] deleted placeholder ts=${messageTs}`);
          } catch (delErr) {
            console.error(`[slack] Failed to delete placeholder:`, delErr);
          }
        } else {
          console.error(`[slack] Failed to download file from NiaAI: ${fileEvt.url}`);
        }
      } catch (err) {
        console.error(`[slack] Failed to upload produced file:`, err);
      }
    }

    for (const imgEvt of pendingImages) {
      try {
        await updatePlaceholder('🎨 Uploading image…');

        const downloaded = await downloadFromNia(imgEvt.url!);
        if (downloaded) {
          const imgFilename = downloaded.filename.endsWith('.png') ? downloaded.filename : `${downloaded.filename}.png`;
          await withRetry(() =>
            app.client.filesUploadV2({
              channel_id: channel,
              thread_ts: threadTs,
              filename: imgFilename,
              file: downloaded.buffer,
              title: imgEvt.revised_prompt ? imgEvt.revised_prompt.slice(0, 100) : 'Generated image',
            })
          );
          imageUploaded = true;
          console.log(`[slack] uploaded image=${imgEvt.id} to thread=${threadTs}`);
        } else {
          console.error(`[slack] Failed to download image from NiaAI: ${imgEvt.url}`);
        }
      } catch (err) {
        console.error(`[slack] Failed to upload produced image:`, err);
      }
    }

    // If a file was uploaded, placeholder is already deleted and initial_comment was set.
    // Do NOT post any additional text messages — the file message is the single result.
    if (fileUploaded) {
      // Add source blocks if any (as a separate message — only for search-backed file generation)
      if (sources.length) {
        const blocks = buildSourceBlocks(sources);
        await withRetry(() =>
          app.client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: 'Sources',
            blocks,
            unfurl_links: false,
            unfurl_media: false,
          })
        );
      }
    } else {
      // No file — handle text/image/error responses normally

      // "No response" only fires if stream ended with NO token, NO file, NO image, NO error
      if (!accumulated && !imageUploaded && !errorReceived) {
        accumulated = "I didn't get a response. Please try again.";
      }

      // If image was uploaded but no text, set a summary message
      if (!accumulated && imageUploaded) {
        accumulated = '🎨 Image uploaded above.';
      }

      // Process citations: convert [n] to Slack links or strip if no sources
      accumulated = processCitations(accumulated, sources);

      // Final update with complete message
      const finalSlack = markdownToSlack(accumulated);
      const chunks = splitMessage(finalSlack);

      // Update the placeholder with the final text
      await withRetry(() =>
        app.client.chat.update({
          channel,
          ts: messageTs,
          text: chunks[0],
        })
      );

      // Send additional chunks as separate messages in thread
      for (let i = 1; i < chunks.length; i++) {
        await withRetry(() =>
          app.client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: chunks[i],
            unfurl_links: false,
            unfurl_media: false,
          })
        );
      }

      // Add source blocks if any
      if (sources.length) {
        const blocks = buildSourceBlocks(sources);
        await withRetry(() =>
          app.client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: 'Sources',
            blocks,
            unfurl_links: false,
            unfurl_media: false,
          })
        );
      }
    }

    // Swap 👀 for ✅
    try {
      await withRetry(() =>
        app.client.reactions.remove({ channel, name: 'eyes', timestamp: threadTs })
      );
    } catch {}
    try {
      await withRetry(() =>
        app.client.reactions.add({ channel, name: 'white_check_mark', timestamp: threadTs })
      );
    } catch {}

  } catch (err: any) {
    console.error('[slack-bot] Error:', err);

    // Check if NiaAI is unreachable
    const isUnreachable = err?.cause?.code === 'ECONNREFUSED' ||
      err?.message?.includes('ECONNREFUSED') ||
      err?.message?.includes('fetch failed');

    const errorText = isUnreachable
      ? "⚠️ Couldn't reach NiaAI (is it running on localhost:3000?)"
      : `⚠️ Something went wrong: ${err?.message || 'Unknown error'}`;

    try {
      await withRetry(() =>
        app.client.chat.update({ channel, ts: messageTs, text: errorText })
      );
    } catch {}

    // ❌ reaction
    try {
      await app.client.reactions.remove({ channel, name: 'eyes', timestamp: threadTs });
    } catch {}
    try {
      await app.client.reactions.add({ channel, name: 'x', timestamp: threadTs });
    } catch {}
  }
}

// ─── Helpers: extract files from Slack events ───────────────────────────────

function extractFilesFromEvent(event: any): Array<{ url_private: string; name: string; mimetype: string }> {
  const files: Array<{ url_private: string; name: string; mimetype: string }> = [];
  if (event.files && Array.isArray(event.files)) {
    for (const f of event.files) {
      if (f.url_private_download || f.url_private) {
        files.push({
          url_private: f.url_private_download || f.url_private,
          name: f.name || 'file',
          mimetype: f.mimetype || 'application/octet-stream',
        });
      }
    }
  }
  return files;
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

// @NiaAI mention in channels
app.event('app_mention', async ({ event }) => {
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
  const files = extractFilesFromEvent(event as any);
  console.log(`[slack] event=app_mention subtype= thread=${event.thread_ts || ''} files=${files.length} handled=${!!(text || files.length)} reason=${text || files.length ? 'mention' : 'empty_text'}`);
  if (!text && !files.length) return;

  const threadTs = event.thread_ts || event.ts;
  const threadKey = getThreadKey(event.channel, threadTs);

  try {
    await withThreadLock(threadKey, () =>
      handleMessage(text || '(attached file)', event.channel, threadTs, event.user!, files.length ? files : undefined)
    );
  } catch (err: any) {
    console.error(`[slack] app_mention handler crashed:`, err);
    try {
      await app.client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: `⚠️ NiaAI error: ${(err?.message || 'Unknown error').slice(0, 200)}`,
      });
      await app.client.reactions.add({ channel: event.channel, name: 'x', timestamp: threadTs });
    } catch {}
  }
});

// DMs + thread follow-ups (no mention needed)
app.event('message', async ({ event }) => {
  const msg = event as any;
  const channelType = msg.channel_type || '';
  const subtype = msg.subtype || '';

  // ── Normalize: for message_changed, unwrap the inner message ──
  // Slack sometimes delivers file uploads as message_changed with event.message.files
  const inner = subtype === 'message_changed' ? msg.message : null;
  const effectiveText = msg.text ?? inner?.text ?? '';
  const effectiveFiles = msg.files ?? inner?.files ?? [];
  const effectiveUser = msg.user ?? inner?.user ?? '';
  const effectiveThreadTs = msg.thread_ts ?? inner?.thread_ts ?? undefined;
  const effectiveBotId = msg.bot_id ?? inner?.bot_id ?? undefined;
  const effectiveClientMsgId = msg.client_msg_id ?? inner?.client_msg_id ?? undefined;
  const effectiveTs = msg.ts ?? inner?.ts ?? '';

  // ── Skip bot messages ──
  if (effectiveBotId) {
    console.log(`[slack] event=message subtype=${subtype} thread=${effectiveThreadTs || ''} handled=false reason=bot_message`);
    return;
  }

  // ── Allow only: no subtype, file_share, message_changed (with files+thread) ──
  if (subtype && subtype !== 'file_share') {
    if (subtype === 'message_changed') {
      // Only handle message_changed if the inner message has files AND is in a thread
      if (!effectiveFiles.length || !effectiveThreadTs) {
        console.log(`[slack] event=message subtype=message_changed thread=${effectiveThreadTs || ''} handled=false reason=message_changed_no_files_or_thread`);
        return;
      }
      // OK — fall through to handle it
    } else {
      console.log(`[slack] event=message subtype=${subtype} thread=${effectiveThreadTs || ''} handled=false reason=subtype_${subtype}`);
      return;
    }
  }

  // ── Deduplicate by client_msg_id or channel:ts ──
  const dedupeKey = effectiveClientMsgId || `${msg.channel}:${effectiveTs}`;
  if (handledMessages.has(dedupeKey)) {
    console.log(`[slack] event=message subtype=${subtype} thread=${effectiveThreadTs || ''} handled=false reason=duplicate_${dedupeKey}`);
    return;
  }
  handledMessages.add(dedupeKey);
  // Evict after TTL to prevent memory leak
  setTimeout(() => handledMessages.delete(dedupeKey), HANDLED_MSG_TTL);

  // ── Extract text and files ──
  const cleanText = effectiveText.replace(new RegExp(`<@${botUserId}>`, 'gi'), '').trim();
  const extractedFiles = extractFilesFromEvent({ files: effectiveFiles });

  // ── DMs: every message, no mention needed ──
  if (channelType === 'im') {
    console.log(`[slack] event=message subtype=${subtype} thread=${effectiveThreadTs || ''} files=${extractedFiles.length} handled=${!!(cleanText || extractedFiles.length)} reason=${cleanText || extractedFiles.length ? 'dm' : 'empty_dm'}`);
    if (!cleanText && !extractedFiles.length) return;

    const ts = effectiveThreadTs || msg.ts;
    const prompt = cleanText || 'Describe what this file contains.';
    const threadKey = getThreadKey(msg.channel, ts);
    try {
      await withThreadLock(threadKey, () =>
        handleMessage(prompt, msg.channel, ts, effectiveUser, extractedFiles.length ? extractedFiles : undefined)
      );
    } catch (err: any) {
      console.error(`[slack] dm handler crashed:`, err);
      try {
        await app.client.chat.postMessage({
          channel: msg.channel, thread_ts: ts,
          text: `⚠️ NiaAI error: ${(err?.message || 'Unknown error').slice(0, 200)}`,
        });
      } catch {}
    }
    return;
  }

  // ── Channel/group thread follow-ups (no mention needed) ──
  if (channelType === 'channel' || channelType === 'group') {
    // Not in a thread → skip (handled by app_mention if @mentioned)
    if (!effectiveThreadTs) {
      console.log(`[slack] event=message subtype=${subtype} thread= handled=false reason=channel_no_thread`);
      return;
    }

    // Already has bot mention → will be handled by app_mention handler, skip
    // (but only for non-file_share/message_changed — those may not trigger app_mention)
    if (botUserId && !subtype && effectiveText.includes(`<@${botUserId}>`)) {
      console.log(`[slack] event=message subtype=${subtype} thread=${effectiveThreadTs} handled=false reason=has_mention_handled_by_app_mention`);
      return;
    }

    // Check if bot has participated in this thread
    const participationKey = `${msg.channel}:${effectiveThreadTs}`;
    if (!botParticipatedThreads.has(participationKey)) {
      console.log(`[slack] event=message subtype=${subtype} thread=${effectiveThreadTs} files=${extractedFiles.length} handled=false reason=bot_not_in_thread`);
      return;
    }

    const prompt = cleanText || (extractedFiles.length ? 'Describe what this file contains.' : '');
    console.log(`[slack] event=message subtype=${subtype} thread=${effectiveThreadTs} files=${extractedFiles.length} handled=${!!(prompt || extractedFiles.length)} reason=${prompt || extractedFiles.length ? 'thread_followup' : 'empty_thread'}`);
    if (!prompt && !extractedFiles.length) return;

    const threadKey = getThreadKey(msg.channel, effectiveThreadTs);
    try {
      await withThreadLock(threadKey, () =>
        handleMessage(prompt, msg.channel, effectiveThreadTs, effectiveUser, extractedFiles.length ? extractedFiles : undefined)
      );
    } catch (err: any) {
      console.error(`[slack] thread_followup handler crashed:`, err);
      try {
        await app.client.chat.postMessage({
          channel: msg.channel, thread_ts: effectiveThreadTs,
          text: `⚠️ NiaAI error: ${(err?.message || 'Unknown error').slice(0, 200)}`,
        });
      } catch {}
    }
    return;
  }

  // Unknown channel type
  console.log(`[slack] event=message subtype=${subtype} thread=${effectiveThreadTs || ''} handled=false reason=unknown_channel_type_${channelType}`);
});

// /nia slash command
app.command('/nia', async ({ command, ack, respond }) => {
  await ack();

  const text = command.text.trim();

  // /nia help
  if (text === 'help') {
    await respond({
      response_type: 'ephemeral',
      text: [
        '*NiaAI Slack Bot Commands*',
        '• `/nia <question>` — Ask NiaAI anything',
        '• `/nia model <name>` — Set your preferred model (e.g. `gpt-5`, `claude-sonnet-4.5`, `gemini-2.5-pro`)',
        '• `/nia model` — Show your current model',
        '• `/nia new` — Fresh context (forget previous conversation)',
        '• `/nia help` — Show this help',
        '',
        'You can also:',
        '• Mention `@NiaAI` in any channel the bot is in',
        '• DM the bot directly',
        '• Reply in a thread for follow-up questions (context is maintained)',
        '• Attach files (PDFs, images) for analysis',
      ].join('\n'),
    });
    return;
  }

  // /nia model [name]
  if (text.startsWith('model')) {
    const modelName = text.replace('model', '').trim();
    if (!modelName) {
      const current = userModels.get(command.user_id) || 'default';
      await respond({
        response_type: 'ephemeral',
        text: `Your current model: *${current}*\nUse \`/nia model <name>\` to change it.`,
      });
      return;
    }
    userModels.set(command.user_id, modelName);
    await respond({
      response_type: 'ephemeral',
      text: `✅ Model set to *${modelName}* for your messages.`,
    });
    return;
  }

  // /nia new — fresh context
  if (text === 'new') {
    // Clear thread → chat mapping for this channel (server-side history resets with new chatId)
    for (const [key] of threadChatMap) {
      if (key.startsWith(command.channel_id)) {
        threadChatMap.delete(key);
      }
    }
    // Clear DM memory for this user
    dmChatMap.delete(`dm:${command.user_id}`);
    await respond({
      response_type: 'ephemeral',
      text: '✅ Fresh context started. Your next message begins a new conversation.',
    });
    return;
  }

  if (!text) {
    await respond({
      response_type: 'ephemeral',
      text: 'Usage: `/nia <question>` or `/nia help`',
    });
    return;
  }

  // Post the question as a message and handle it
  const threadTs = command.trigger_id; // Use trigger as thread root
  const threadKey = getThreadKey(command.channel_id, command.trigger_id);

  // Post the answer in the channel
  await withThreadLock(threadKey, async () => {
    // Post user's question
    const questionMsg = await withRetry(() =>
      app.client.chat.postMessage({
        channel: command.channel_id,
        text: `*${command.user_name}* asked: ${text}`,
        unfurl_links: false,
        unfurl_media: false,
      })
    );

    await handleMessage(text, command.channel_id, questionMsg.ts!, command.user_id);
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

(async () => {
  try {
    await app.start();

    // Get bot info
    const authResult = await app.client.auth.test();
    connectionStatus = {
      connected: true,
      workspace: authResult.team || undefined,
      botUser: authResult.user || undefined,
      lastEventTime: new Date().toISOString(),
    };

    // Store bot user ID for mention stripping
    botUserId = authResult.user_id || '';

    console.log(`⚡ NiaAI Slack bot connected as @${authResult.user} (${authResult.team}) [bot_id=${botUserId}]`);

    // Send initial heartbeat
    await sendHeartbeat(connectionStatus);

    // Ping heartbeat every 30s
    setInterval(() => {
      sendHeartbeat(connectionStatus);
    }, 30_000);
  } catch (err) {
    console.error('[slack-bot] Failed to start:', err);
    process.exit(1);
  }
})();
