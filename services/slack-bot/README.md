# NiaAI Slack Bot

Slack bot that connects to your NiaAI instance via Socket Mode. Answers questions, processes files, performs web searches, and generates documents — all from Slack.

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in:

```
SLACK_BOT_TOKEN=xoxb-...       # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...       # App-Level Token (with connections:write)
SLACK_SIGNING_SECRET=...       # Signing Secret
NIA_APP_URL=http://localhost:3000
NIA_INTERNAL_TOKEN=            # Must match NIA_INTERNAL_TOKEN on the NiaAI server
```

### 2. Slack App Configuration

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and select your app
2. **Socket Mode** → Enable
3. **Event Subscriptions** → Enable, subscribe to:
   - `app_mention`
   - `message.im`
4. **OAuth & Permissions** → Bot Token Scopes:
   - `app_mentions:read`
   - `channels:history`
   - `chat:write`
   - `files:read`
   - `files:write`
   - `im:history`
   - `im:read`
   - `im:write`
   - `reactions:read`
   - `reactions:write`
   - `users:read`
5. **Slash Commands** → Create `/nia`
6. Install the app to your workspace
7. Invite the bot to channels: `/invite @NiaAI`

### 3. Run

```bash
# From the project root
npm run slack

# Or from this directory
npx tsx src/index.ts
```

You should see:
```
⚡ NiaAI Slack bot connected as @NiaAI (YourWorkspace)
```

## Usage

- **Channel**: `@NiaAI <question>` — bot replies in a thread
- **DM**: Just message the bot directly
- **Thread**: Reply in any bot thread to continue the conversation
- **Slash commands**:
  - `/nia <question>` — Ask a question
  - `/nia model <name>` — Set your preferred model (e.g. `gpt-5`, `claude-sonnet-4.5`)
  - `/nia model` — Show current model
  - `/nia new` — Start fresh context
  - `/nia help` — Show help

## File Support

Attach PDFs, images, or documents to your message — the bot downloads them via the bot token and forwards to NiaAI for analysis. NiaAI-generated files (PDFs, images) are uploaded back into the Slack thread.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `not_in_channel` | Invite the bot: `/invite @NiaAI` |
| `missing_scope` | Add the required scope in OAuth & Permissions, reinstall the app |
| `invalid_auth` | Check `SLACK_BOT_TOKEN` is correct and the app is installed |
| `Couldn't reach NiaAI` | Make sure NiaAI is running on the configured `NIA_APP_URL` |
| No response from bot | Check Socket Mode is enabled, `SLACK_APP_TOKEN` starts with `xapp-` |
