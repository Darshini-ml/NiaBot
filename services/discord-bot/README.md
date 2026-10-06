# NiaAI Discord Bot

Discord bot for NiaAI — ask questions, search the web, generate PDFs/images, and analyze files directly from Discord.

## Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it "NiaAI"
3. Go to **Bot** → click **Reset Token** → copy the token

### 2. Enable Intents

In the Bot settings, enable:
- **Message Content Intent** (required — without this the bot sees empty messages)
- **Server Members Intent** (optional)

### 3. Generate Invite URL

Go to **OAuth2 → URL Generator**:
- Scopes: `bot`, `applications.commands`
- Bot Permissions: `Send Messages`, `Send Messages in Threads`, `Create Public Threads`, `Read Message History`, `Add Reactions`, `Attach Files`, `Embed Links`, `Use Slash Commands`, `Manage Messages`

Copy the generated URL and open it to invite the bot to your server.

### 4. Environment Variables

Create a `.env` file in this directory (or set them in your environment):

```env
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_APP_ID=your-application-id
DISCORD_GUILD_ID=your-guild-id          # optional — guild-scoped commands (instant); omit for global (up to 1hr delay)
NIA_APP_URL=http://localhost:3000       # your NiaAI Next.js app
NIA_INTERNAL_TOKEN=                     # optional auth token (must match the app's)
```

### 5. Run

From the repo root:
```bash
npm run discord
```

Or from this directory:
```bash
npm install
npm run discord
```

## Features

| Feature | How |
|---------|-----|
| Channel mentions | `@NiaAI what is the price of iPhone 16` |
| Thread follow-ups | Reply in a bot-created thread (context maintained) |
| Direct messages | DM the bot (no mention needed) |
| Slash commands | `/nia <question>` · `/nia-new` (reset context) |
| File analysis | Attach PDF, DOCX, XLSX, PPTX, CSV, images, code, ZIP |
| PDF generation | `@NiaAI create a 5 page PDF about Kerala tourism` |
| PPTX generation | `@NiaAI create a 6 slide presentation about AI` |
| Image generation | `@NiaAI create an image of a cup of tea` |
| Web search | Automatic for factual/price/news queries |
| Citations | `[1]` `[2]` inline links + Sources line |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot sees empty messages | Enable **Message Content Intent** in Developer Portal → Bot |
| Upload fails with 403 | Bot needs **Attach Files** permission |
| Commands don't appear | Guild-scoped commands are instant; global commands take up to 1 hour |
| "ECONNREFUSED" | Make sure the NiaAI app is running at NIA_APP_URL |
| Bot doesn't respond in threads | Bot must be the thread owner or mentioned |
