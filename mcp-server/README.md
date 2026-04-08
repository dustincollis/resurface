# Resurface MCP Server

A Model Context Protocol (MCP) server that exposes your Resurface data to Claude Desktop and Claude Code. Lets you query items, create tasks, search, and manage discussions through natural language in Claude.

## What it does

Once installed, you can ask Claude things like:

- *"What's on my Resurface dashboard?"*
- *"Create an item to follow up on the Adobe contract by Friday"*
- *"Show me everything in the Business Development stream"*
- *"What's getting stale?"*
- *"Find anything mentioning healthcare"*
- *"Mark the Q2 pipeline review as in progress"*

## Available tools

| Tool | What it does |
|---|---|
| `list_streams` | List all your active streams |
| `list_items` | List items, filtered by stream/status, sorted by staleness/due date/etc |
| `get_item` | Full detail for a single item |
| `create_item` | Create a new item (AI classification runs in background) |
| `update_item` | Update fields on an existing item |
| `search` | Full-text + fuzzy search across items and discussions |
| `get_dashboard` | Today's priority items, ranked by staleness + stakes + due urgency |
| `list_discussions` | Discussions within a date range |
| `get_discussion` | Full detail for a single discussion, including transcript |

---

## Prerequisites

1. **Node.js 18+** installed on your machine. Check with `node --version`.
2. **Claude Desktop** installed: https://claude.ai/download
3. **Your Resurface login credentials** (email + password you use at https://resurface-phi.vercel.app)

---

## Installation

### 1. Clone or copy the mcp-server folder

If you have the Resurface repo:

```bash
cd /path/to/resurface/mcp-server
```

Or download just the `mcp-server` folder from GitHub.

### 2. Install dependencies and build

```bash
npm install
npm run build
```

This creates `dist/index.js` — the executable MCP server.

### 3. Get the absolute path

```bash
pwd
```

Note this path. You'll use it in the next step. The full path to the executable will be something like:
```
/Users/yourname/resurface/mcp-server/dist/index.js
```

### 4. Configure Claude Desktop

Open the Claude Desktop config file:

**Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

If the file doesn't exist, create it. Add a `mcpServers` entry:

```json
{
  "mcpServers": {
    "resurface": {
      "command": "node",
      "args": ["/absolute/path/to/resurface/mcp-server/dist/index.js"],
      "env": {
        "RESURFACE_SUPABASE_URL": "https://biapwycemhtdhcpmgshp.supabase.co",
        "RESURFACE_SUPABASE_ANON_KEY": "<your anon key>",
        "RESURFACE_EMAIL": "you@example.com",
        "RESURFACE_PASSWORD": "your-password"
      }
    }
  }
}
```

Replace:
- The path in `args` with your absolute path from step 3
- `<your anon key>` with the value from `.env.local` in the Resurface repo (it starts with `eyJ`)
- `RESURFACE_EMAIL` and `RESURFACE_PASSWORD` with your Resurface login

If you already have other MCP servers configured, just add `"resurface": { ... }` inside the existing `mcpServers` object.

### 5. Restart Claude Desktop

Quit and reopen Claude Desktop. The Resurface tools should appear in the tools menu (the tool icon at the bottom of the chat window).

---

## Verifying it works

In a new Claude Desktop conversation, try:

> What streams do I have in Resurface?

Claude should call `list_streams` and respond with your streams. If it works, you're set.

---

## Using with Claude Code

Claude Code also supports MCP servers. Add the same config to your Claude Code MCP config file (the location depends on your Claude Code version — check the Claude Code docs).

---

## Troubleshooting

**"Tools menu doesn't show resurface"** — Claude Desktop didn't pick up the config. Check:
1. The JSON file is valid (no trailing commas, proper quoting)
2. The path in `args` is absolute, not relative
3. You restarted Claude Desktop completely (Cmd+Q on Mac, not just close window)

**"Sign-in failed"** — The email or password is wrong. Test by signing in to https://resurface-phi.vercel.app first.

**"Missing required environment variables"** — One of the four env vars is missing or empty. Double-check the JSON.

**"Cannot find module" errors** — `npm install` didn't run or `npm run build` failed. Re-run them.

**Logs** — Claude Desktop writes MCP server logs to:
- Mac: `~/Library/Logs/Claude/mcp-server-resurface.log`
- Windows: `%APPDATA%\Claude\Logs\mcp-server-resurface.log`

Check there for crash messages.

---

## Security notes

- Your email and password are stored in the Claude Desktop config file in plain text. Make sure that file isn't checked into a git repo.
- The MCP server runs locally as a subprocess of Claude Desktop. It doesn't expose any network ports.
- All Supabase queries go through Row Level Security — the MCP server can only see your data, even with the credentials.
- The Supabase anon key is safe to share (it's the same key used in the web app).
