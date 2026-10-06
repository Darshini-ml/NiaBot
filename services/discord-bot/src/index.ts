import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
  ChannelType,
  Message,
  TextChannel,
  ThreadChannel,
  DMChannel,
} from 'discord.js';
import { streamChat, uploadToNia, sendHeartbeat, downloadFromNia, NiaChatRequest, NiaSSEEvent } from './nia-client';
import { processCitations, buildSourcesLine, splitMessage, tablesToCodeBlocks } from './format';
import { withThreadLock } from './rate-limiter';

// ─── Config ──────────────────────────────────────────────────────────────────

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_APP_ID = process.env.DISCORD_APP_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID; // optional — guild-scoped commands

if (!DISCORD_TOKEN || !DISCORD_APP_ID) {
  console.error('[discord-bot] Missing required env vars: DISCORD_BOT_TOKEN, DISCORD_APP_ID');
  process.exit(1);
}

const NIA_APP_URL = process.env.NIA_APP_URL || process.env.NIA_BASE_URL || 'http://localhost:3000';
const NIA_GATEWAY_URL = process.env.NIA_GATEWAY_URL || '';
if (NIA_GATEWAY_URL && NIA_APP_URL === NIA_GATEWAY_URL) {
  console.error(`[discord-bot] FATAL: NIA_APP_URL (${NIA_APP_URL}) equals NIA_GATEWAY_URL. NIA_APP_URL should point to the Next.js app.`);
  process.exit(1);
}
console.log(`[discord-bot] NIA_APP_URL=${NIA_APP_URL}`);

// ─── Client setup ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ─── State ───────────────────────────────────────────────────────────────────

// User → preferred model
const userModels = new Map<string, string>();

// Connection status
let connectionStatus: {
  connected: boolean;
  guild?: string;
  botUser?: string;
  lastEventTime?: string;
} = { connected: false };

// ─── Slash command registration ──────────────────────────────────────────────

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);

  const niaCmd = new SlashCommandBuilder()
    .setName('nia')
    .setDescription('Ask NiaAI anything')
    .addStringOption(opt =>
      opt.setName('prompt').setDescription('Your question or request').setRequired(true)
    );

  const niaNewCmd = new SlashCommandBuilder()
    .setName('nia-new')
    .setDescription('Reset context — start a fresh conversation');

  const commands = [niaCmd.toJSON(), niaNewCmd.toJSON()];

  try {
    if (DISCORD_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(DISCORD_APP_ID!, DISCORD_GUILD_ID), { body: commands });
      console.log(`[discord-bot] Registered ${commands.length} guild commands (guild=${DISCORD_GUILD_ID})`);
    } else {
      await rest.put(Routes.applicationCommands(DISCORD_APP_ID!), { body: commands });
      console.log(`[discord-bot] Registered ${commands.length} global commands`);
    }
  } catch (err) {
    console.error('[discord-bot] Failed to register commands:', err);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getConversationKey(guildId: string | null, threadId: string, userId?: string): string {
  if (!guildId) return `discord:dm:${userId}`;
  return `discord:${guildId}:${threadId}`;
}

function truncateError(msg: string): string {
  const clean = msg.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > 180 ? clean.slice(0, 177) + '…' : clean;
}

// ─── Core: handle a message and stream the response ──────────────────────────

async function handleMessage(
  text: string,
  message: Message,
  threadId: string,
  guildId: string | null,
  channelName: string | undefined,
  isDm: boolean,
) {
  const userId = message.author.id;
  const userName = message.author.username;
  const conversationKey = getConversationKey(guildId, threadId, userId);

  console.log(`[discord] thread=${threadId} channel=${channelName || 'DM'} user=${userId} (${userName}) text="${text.slice(0, 60)}"`);

  // React with 👀
  try {
    await message.react('👀');
  } catch {}

  // If not already in a thread, create one
  let thread: ThreadChannel | null = null;
  let replyChannel: TextChannel | ThreadChannel | DMChannel = message.channel as any;

  if (!isDm && message.channel.type === ChannelType.GuildText) {
    try {
      // Strip mentions (<@123>, <@!123>, <@&123>), collapse whitespace, max 80 chars
      const threadName = text.replace(/<@[!&]?\d+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'NiaAI chat';
      thread = await message.startThread({ name: threadName });
      replyChannel = thread;
    } catch {
      // May fail if already in a thread
    }
  }

  // If we're already in a thread, use it
  if (message.channel.type === ChannelType.PublicThread || message.channel.type === ChannelType.PrivateThread) {
    replyChannel = message.channel;
    thread = message.channel;
  }

  // Post "Thinking…" placeholder
  const placeholder = await replyChannel.send({
    content: '💭 Thinking…',
    flags: [MessageFlags.SuppressEmbeds],
  });

  try {
    // ── Download Discord file attachments ──
    const niaAttachments: Array<{ id: string; name: string; mimeType: string; extractedText?: string }> = [];
    let effectiveAttachments = [...message.attachments.values()];

    // If no attachments, check earlier thread messages
    if (effectiveAttachments.length === 0 && thread) {
      try {
        const messages = await thread.messages.fetch({ limit: 20 });
        for (const msg of messages.values()) {
          if (msg.attachments.size > 0) {
            effectiveAttachments.push(...msg.attachments.values());
          }
        }
      } catch (err) {
        console.error('[discord] Failed to fetch thread attachments:', err);
      }
    }

    if (effectiveAttachments.length > 0) {
      console.log(`[discord] files=${effectiveAttachments.length}`);
      for (const att of effectiveAttachments) {
        try {
          // Status: "Reading {name}…"
          try {
            await placeholder.edit({ content: `📄 Reading ${att.name}…`, flags: [MessageFlags.SuppressEmbeds] });
          } catch {}

          const res = await fetch(att.url);
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());

          // Cap at 25 MB
          if (buf.length > 25 * 1024 * 1024) {
            console.log(`[discord] skipping ${att.name} — ${Math.round(buf.length / 1024 / 1024)}MB exceeds 25MB cap`);
            continue;
          }

          console.log(`[discord] evt=file filename=${att.name} size=${buf.length}`);
          const uploaded = await uploadToNia(buf, att.name, att.contentType || 'application/octet-stream');
          if (uploaded) {
            niaAttachments.push({
              id: uploaded.id,
              name: att.name,
              mimeType: att.contentType || 'application/octet-stream',
              extractedText: uploaded.extractedText,
            });
          }
        } catch (err) {
          console.error(`[discord] Failed to process file ${att.name}:`, err);
        }
      }
    }

    const model = userModels.get(userId);

    // Stream from NiaAI
    let accumulated = '';
    let sources: Array<{ title: string; url: string; favicon?: string }> = [];
    let lastUpdateTime = 0;
    let fileUploaded = false;
    let imageUploaded = false;
    let errorReceived = false;
    const streamStartTime = Date.now();
    const UPDATE_INTERVAL = 1000; // Discord rate limits are stricter

    const pendingFiles: NiaSSEEvent[] = [];
    const pendingImages: NiaSSEEvent[] = [];

    const updatePlaceholder = async (statusText: string) => {
      // Don't double-append timing if the server already includes it (e.g. "Generating image… (25s)")
      let content = statusText;
      if (!/\(\d+s\)/.test(statusText)) {
        const elapsed = Math.round((Date.now() - streamStartTime) / 1000);
        if (elapsed > 3) content += ` (${elapsed}s)`;
      }
      try {
        await placeholder.edit({ content, flags: [MessageFlags.SuppressEmbeds] });
      } catch {}
    };

    for await (const event of streamChat({
      source: 'discord',
      text,
      conversation_key: conversationKey,
      channel_name: isDm ? undefined : channelName,
      user_id: userId,
      user_name: userName,
      model,
      web_search: true,
      ...(niaAttachments.length ? { attachments: niaAttachments } : {}),
    })) {
      connectionStatus.lastEventTime = new Date().toISOString();

      // Log events
      if (event.type === 'file') {
        console.log(`[discord] evt=file filename=${event.filename || '?'} pages=${event.pages || '?'} size=${event.size_bytes || '?'}`);
      } else if (event.type === 'image') {
        console.log(`[discord] evt=image id=${event.id || '?'} prompt="${(event.revised_prompt || '').slice(0, 60)}"`);
      } else if (event.type === 'status') {
        console.log(`[discord] evt=status text="${event.text || ''}"`);
      } else if (event.type === 'content') {
        if (!accumulated) console.log(`[discord] evt=content (first token)`);
      } else if (event.type === 'sources') {
        console.log(`[discord] evt=sources count=${event.items?.length || 0}`);
      } else if (event.type === 'usage') {
        console.log(`[discord] evt=usage in=${event.usage?.input_tokens || 0} out=${event.usage?.output_tokens || 0} served=${event.usage?.served_model || '?'}`);
      } else if (event.type === 'error') {
        console.log(`[discord] evt=error text="${(event.text || '').slice(0, 100)}"`);
      } else if (event.type === 'done') {
        console.log(`[discord] evt=done finish=${event.finish_reason || '?'}`);
      }

      // Status events
      if (event.type === 'status' && event.text) {
        await updatePlaceholder(event.text);
      }

      // Content tokens
      if (event.type === 'content' && event.text) {
        accumulated += event.text;
        const now = Date.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
          lastUpdateTime = now;
          const display = tablesToCodeBlocks(accumulated);
          try {
            await placeholder.edit({
              content: display.slice(0, 1950) + (display.length > 1950 ? '…' : ''),
              flags: [MessageFlags.SuppressEmbeds],
            });
          } catch {}
        }
      }

      if (event.type === 'sources' && event.items) {
        sources = event.items;
      }

      if (event.type === 'replace_content') {
        accumulated = '';
      }

      if (event.type === 'file' && event.url) {
        pendingFiles.push(event);
      }

      if (event.type === 'image' && event.url) {
        pendingImages.push(event);
      }

      if (event.type === 'error') {
        accumulated = `⚠️ ${event.text || 'An error occurred'}`;
        errorReceived = true;
      }
    }

    // ── Stream closed — download and upload deferred files/images ──

    for (const fileEvt of pendingFiles) {
      try {
        await updatePlaceholder(`📄 Uploading ${fileEvt.filename || 'document'}…`);
        const downloaded = await downloadFromNia(fileEvt.url!);
        if (downloaded) {
          const title = fileEvt.title || fileEvt.filename || 'Document';
          const sizeKB = Math.round((fileEvt.size_bytes || 0) / 1024);
          const pageSuffix = fileEvt.pages ? `${fileEvt.pages} pages` : '';
          const sizeSuffix = sizeKB ? `${sizeKB} KB` : '';
          const meta = [pageSuffix, sizeSuffix].filter(Boolean).join(' · ');
          const comment = accumulated && accumulated.length > 10
            ? processCitations(accumulated, sources)
            : `${title}${meta ? ` — ${meta}` : ''}`;

          // Check if over 25 MB
          if (downloaded.buffer.length > 25 * 1024 * 1024) {
            const downloadUrl = `${NIA_APP_URL}${fileEvt.url}`;
            await replyChannel.send({
              content: `${comment}\n\n📎 File too large for Discord (${Math.round(downloaded.buffer.length / 1024 / 1024)}MB). [Download here](${downloadUrl})`,
              flags: [MessageFlags.SuppressEmbeds],
            });
          } else {
            const attachment = new AttachmentBuilder(downloaded.buffer, {
              name: downloaded.filename || fileEvt.filename || 'document.pdf',
            });
            await replyChannel.send({
              content: comment.slice(0, 1950),
              files: [attachment],
              flags: [MessageFlags.SuppressEmbeds],
            });
          }
          fileUploaded = true;

          // Delete placeholder
          try { await placeholder.delete(); } catch {}
        } else {
          console.error(`[discord] Failed to download file from NiaAI: ${fileEvt.url}`);
        }
      } catch (err) {
        console.error('[discord] Failed to upload produced file:', err);
      }
    }

    for (const imgEvt of pendingImages) {
      try {
        await updatePlaceholder('🎨 Uploading image…');
        const downloaded = await downloadFromNia(imgEvt.url!);
        if (downloaded) {
          const imgFilename = downloaded.filename.endsWith('.png') ? downloaded.filename : `${downloaded.filename}.png`;
          const attachment = new AttachmentBuilder(downloaded.buffer, { name: imgFilename });
          // Use the user's original request as caption, not the expanded/revised prompt
          const caption = text ? `Here's your image: ${text}` : 'Generated image';
          await replyChannel.send({
            content: caption.slice(0, 1950),
            files: [attachment],
            flags: [MessageFlags.SuppressEmbeds],
          });
          imageUploaded = true;
        }
      } catch (err) {
        console.error('[discord] Failed to upload produced image:', err);
      }
    }

    if (fileUploaded) {
      // Sources
      if (sources.length) {
        const sourcesLine = buildSourcesLine(sources);
        if (sourcesLine) {
          await replyChannel.send({
            content: sourcesLine,
            flags: [MessageFlags.SuppressEmbeds],
          });
        }
      }
    } else {
      if (!accumulated && !imageUploaded && !errorReceived) {
        accumulated = "I didn't get a response. Please try again.";
      }
      if (!accumulated && imageUploaded) {
        // Delete placeholder — image already sent
        try { await placeholder.delete(); } catch {}
      } else {
        // Process citations
        accumulated = processCitations(accumulated, sources);
        // Tables → code blocks
        accumulated = tablesToCodeBlocks(accumulated);

        // Append sources line
        const sourcesLine = buildSourcesLine(sources);
        if (sourcesLine) {
          accumulated += `\n\n${sourcesLine}`;
        }

        const chunks = splitMessage(accumulated);
        // Update placeholder with first chunk
        try {
          await placeholder.edit({
            content: chunks[0],
            flags: [MessageFlags.SuppressEmbeds],
          });
        } catch {}

        // Send additional chunks
        for (let i = 1; i < chunks.length; i++) {
          await replyChannel.send({
            content: chunks[i],
            flags: [MessageFlags.SuppressEmbeds],
          });
        }
      }
    }

    // Swap 👀 for ✅
    try { await message.reactions.cache.get('👀')?.users.remove(client.user!.id); } catch {}
    try { await message.react('✅'); } catch {}

  } catch (err: any) {
    console.error('[discord-bot] Error:', err);

    const isUnreachable = err?.cause?.code === 'ECONNREFUSED' ||
      err?.message?.includes('ECONNREFUSED') ||
      err?.message?.includes('fetch failed');

    const errorText = isUnreachable
      ? "⚠️ Couldn't reach NiaAI (is it running on localhost:3000?)"
      : `⚠️ NiaAI error: ${truncateError(err?.message || 'Unknown error')}`;

    try {
      await placeholder.edit({ content: errorText, flags: [MessageFlags.SuppressEmbeds] });
    } catch {}

    try { await message.reactions.cache.get('👀')?.users.remove(client.user!.id); } catch {}
    try { await message.react('❌'); } catch {}
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  const isDm = message.channel.type === ChannelType.DM;
  const isThread = message.channel.type === ChannelType.PublicThread || message.channel.type === ChannelType.PrivateThread;
  const isMentioned = message.mentions.has(client.user!);

  // ── DMs: always respond ──
  if (isDm) {
    const text = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!text && message.attachments.size === 0) return;

    const threadKey = `dm:${message.author.id}`;
    await withThreadLock(threadKey, () =>
      handleMessage(text || 'Summarize the attached file(s)', message, message.channel.id, null, undefined, true)
    );
    return;
  }

  // ── Thread follow-ups ──
  if (isThread) {
    const threadChannel = message.channel as ThreadChannel;
    // Check if bot is participant in this thread
    const botIsMember = threadChannel.members.cache.has(client.user!.id) ||
      threadChannel.ownerId === client.user!.id;

    // Also respond if @mentioned in thread
    if (!botIsMember && !isMentioned) return;

    const text = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!text && message.attachments.size === 0) return;

    const guildId = message.guild?.id || null;
    const channelName = threadChannel.parent?.name;
    const threadKey = `${guildId}:${threadChannel.id}`;

    await withThreadLock(threadKey, () =>
      handleMessage(text || 'Summarize the attached file(s)', message, threadChannel.id, guildId, channelName, false)
    );
    return;
  }

  // ── Channel mention: @NiaAI ──
  if (isMentioned) {
    const text = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!text && message.attachments.size === 0) return;

    const guildId = message.guild?.id || null;
    const channelName = (message.channel as TextChannel).name;
    // Thread ID will be the new thread created from this message
    const threadKey = `${guildId}:${message.id}`;

    await withThreadLock(threadKey, () =>
      handleMessage(text || 'Summarize the attached file(s)', message, message.id, guildId, channelName, false)
    );
    return;
  }
});

// ─── Slash commands ──────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'nia') {
    const prompt = interaction.options.getString('prompt', true);
    await interaction.deferReply();

    const guildId = interaction.guild?.id || null;
    const isDm = !interaction.guild;
    const channelName = !isDm && interaction.channel && 'name' in interaction.channel ? (interaction.channel.name || undefined) : undefined;
    const conversationKey = getConversationKey(guildId, interaction.channelId, interaction.user.id);

    // Create a "fake" message context for the handler
    // For slash commands, we'll handle it inline
    const userId = interaction.user.id;
    const userName = interaction.user.username;

    console.log(`[discord] slash=/nia user=${userId} (${userName}) text="${prompt.slice(0, 60)}"`);

    let accumulated = '';
    let sources: Array<{ title: string; url: string; favicon?: string }> = [];
    const pendingFiles: NiaSSEEvent[] = [];
    const pendingImages: NiaSSEEvent[] = [];
    let errorReceived = false;
    const streamStartTime = Date.now();

    try {
      for await (const event of streamChat({
        source: 'discord',
        text: prompt,
        conversation_key: conversationKey,
        channel_name: channelName,
        user_id: userId,
        user_name: userName,
        model: userModels.get(userId),
        web_search: true,
      })) {
        connectionStatus.lastEventTime = new Date().toISOString();

        if (event.type === 'status' && event.text) {
          let statusContent = event.text;
          if (!/\(\d+s\)/.test(statusContent)) {
            const elapsed = Math.round((Date.now() - streamStartTime) / 1000);
            if (elapsed > 3) statusContent += ` (${elapsed}s)`;
          }
          try {
            await interaction.editReply({ content: statusContent });
          } catch {}
        }

        if (event.type === 'content' && event.text) {
          accumulated += event.text;
        }

        if (event.type === 'sources' && event.items) {
          sources = event.items;
        }

        if (event.type === 'replace_content') {
          accumulated = '';
        }

        if (event.type === 'file' && event.url) {
          pendingFiles.push(event);
        }

        if (event.type === 'image' && event.url) {
          pendingImages.push(event);
        }

        if (event.type === 'error') {
          accumulated = `⚠️ ${event.text || 'An error occurred'}`;
          errorReceived = true;
        }
      }

      // Handle files
      for (const fileEvt of pendingFiles) {
        const downloaded = await downloadFromNia(fileEvt.url!);
        if (downloaded) {
          const title = fileEvt.title || fileEvt.filename || 'Document';
          const sizeKB = Math.round((fileEvt.size_bytes || 0) / 1024);
          const meta = [fileEvt.pages ? `${fileEvt.pages} pages` : '', sizeKB ? `${sizeKB} KB` : ''].filter(Boolean).join(' · ');
          const comment = accumulated && accumulated.length > 10
            ? processCitations(accumulated, sources)
            : `${title}${meta ? ` — ${meta}` : ''}`;

          if (downloaded.buffer.length > 25 * 1024 * 1024) {
            await interaction.editReply({ content: `${comment}\n\n📎 File too large for Discord.` });
          } else {
            const attachment = new AttachmentBuilder(downloaded.buffer, {
              name: downloaded.filename || fileEvt.filename || 'document.pdf',
            });
            await interaction.editReply({ content: comment.slice(0, 1950), files: [attachment] });
          }
          return;
        }
      }

      // Handle images
      for (const imgEvt of pendingImages) {
        const downloaded = await downloadFromNia(imgEvt.url!);
        if (downloaded) {
          const imgFilename = downloaded.filename.endsWith('.png') ? downloaded.filename : `${downloaded.filename}.png`;
          const attachment = new AttachmentBuilder(downloaded.buffer, { name: imgFilename });
          // Use the user's original request as caption, not the expanded prompt
          const caption = prompt ? `Here's your image: ${prompt}` : 'Generated image';
          await interaction.editReply({
            content: caption.slice(0, 1950),
            files: [attachment],
          });
          return;
        }
      }

      // Text response
      if (!accumulated && !errorReceived) {
        accumulated = "I didn't get a response. Please try again.";
      }

      accumulated = processCitations(accumulated, sources);
      accumulated = tablesToCodeBlocks(accumulated);
      const sourcesLine = buildSourcesLine(sources);
      if (sourcesLine) accumulated += `\n\n${sourcesLine}`;

      const chunks = splitMessage(accumulated);
      await interaction.editReply({ content: chunks[0] });
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], flags: [MessageFlags.SuppressEmbeds] });
      }

      console.log(`[discord] slash=/nia replied user=${userId} elapsed=${Math.round((Date.now() - streamStartTime) / 1000)}s chunks=${chunks.length}`);

    } catch (err: any) {
      console.error('[discord-bot] Slash command error:', err);
      try {
        await interaction.editReply({
          content: `⚠️ NiaAI error: ${truncateError(err?.message || 'Unknown error')}`,
        });
      } catch {}
      console.log(`[discord] slash=/nia error user=${userId} elapsed=${Math.round((Date.now() - streamStartTime) / 1000)}s`);
    }
    return;
  }

  if (interaction.commandName === 'nia-new') {
    await interaction.reply({
      content: '✅ Fresh context started. Your next message begins a new conversation.',
      ephemeral: true,
    });
    return;
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c: Client<true>) => {
  const guilds = c.guilds.cache;
  const guildName = guilds.first()?.name || 'unknown';
  const guildCount = guilds.size;

  connectionStatus = {
    connected: true,
    guild: guildName,
    botUser: `${c.user.username}#${c.user.discriminator}`,
    lastEventTime: new Date().toISOString(),
  };

  console.log(`⚡ NiaAI Discord bot connected as ${c.user.username}#${c.user.discriminator} in ${guildCount} server${guildCount !== 1 ? 's' : ''}`);

  // Register commands
  await registerCommands();

  // Send initial heartbeat
  await sendHeartbeat(connectionStatus);

  // Heartbeat every 30s
  setInterval(() => {
    sendHeartbeat(connectionStatus);
  }, 30_000);
});

client.login(DISCORD_TOKEN);
