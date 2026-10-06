# NiaAI

Multi-model AI chat platform with web search, document generation, automations, and integrations.

## Features

- **Multi-model chat** — Route conversations through NiaAI gateway to Anthropic, OpenAI, Google, and local Ollama models
- **Web search** — Real-time search with full page fetching, citations, and source attribution
- **PDF / PPTX generation** — Create styled, multi-page documents from chat (cover page, TOC, themed templates)
- **Image generation** — Generate images via provider APIs with prompt rewriting and local storage
- **File attachments** — Upload and analyze PDF, DOCX, PPTX, XLSX, CSV, images, code, ZIP archives, and more
- **Automations** — Scheduled and event-triggered workflows with email delivery
- **Slack bot** — Full-featured bot with Socket Mode, threaded replies, file handling, web search, and citations
- **Discord bot** — Slash-command and mention-based bot with streaming responses
- **Logs dashboard** — Usage tracking with per-chat breakdowns, tool events, error logs, and token charts
- **Voice mode** — Speech-to-text and text-to-speech support
- **Command palette** — Quick actions and keyboard shortcuts

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in NIA_API_KEY at minimum — see .env.example for all options

# 3. Start the dev server
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

### Slack Bot

```bash
cd services/slack-bot
cp .env.example .env
# Fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET, NIA_INTERNAL_TOKEN
npm install
npm start
```

See [services/slack-bot/README.md](services/slack-bot/README.md) for Slack app setup instructions.

### Discord Bot

```bash
cd services/discord-bot
cp .env.example .env  # or create from root .env.example Discord section
# Fill in DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID
npm install
npm start
```

See [services/discord-bot/README.md](services/discord-bot/README.md) for Discord app setup instructions.

## Project Structure

```
src/
  app/           — Next.js app router (pages, API routes)
  components/    — React components (chat, sidebar, modals, logs)
  lib/           — Shared utilities (provider adapters, config, file extraction)
services/
  slack-bot/     — Standalone Slack bot (Socket Mode)
  discord-bot/   — Standalone Discord bot
```

## License

Private — all rights reserved.
