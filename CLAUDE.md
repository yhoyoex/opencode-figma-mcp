# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that bridges OpenCode with Figma. Three components communicate in a pipeline:

```
OpenCode ←(stdio)→ MCP Server ←(WebSocket)→ WebSocket Relay ←(WebSocket)→ Figma Plugin
```

## Build & Development Commands

```bash
bun install              # Install dependencies
bun run build            # Build MCP server (tsup → dist/)
bun run dev              # Build in watch mode
bun socket               # Start WebSocket relay server (port 3055)
bun run start            # Run built MCP server
bun setup                # Full setup (install + build + write opencode.json + .mcp.json)
```

There is no test suite or linter configured.

## Architecture

### MCP Server (`src/opencode_figma_mcp/server.ts`)
The main server implementing the MCP protocol via `@modelcontextprotocol/sdk`. Exposes 50+ tools (create shapes, modify text, manage layouts, export images, etc.) and several AI prompts (design strategies). Communicates with OpenCode over stdio and with the WebSocket relay via `ws`. Each request gets a UUID, is tracked in a `pendingRequests` Map with timeout/promise callbacks, and resolves when the plugin responds.

### Design-to-code (`src/opencode_figma_mcp/design/`)
`simplify.ts` converts Figma REST-format nodes (plugin `JSON_REST_V1` export or REST API) into a compact, code-oriented spec with deduplicated style references. `figma_rest.ts` is a minimal Figma REST API client (needs `FIGMA_ACCESS_TOKEN`). Used by `get_design_context` (plugin), `get_figma_design_from_url` (REST) and `download_design_assets`.

### WebSocket Relay (`src/socket.ts`)
Lightweight Bun WebSocket server on port 3055 (configurable via `PORT` env). Routes messages between MCP server and Figma plugin using channel-based isolation. Clients call `join` to enter a channel; messages broadcast only within the same channel.

### Figma Plugin (`src/opencode_mcp_plugin/`)
Runs inside Figma. `code.js` is the plugin main thread handling 30+ commands via a dispatcher. `ui.html` is the plugin UI for WebSocket connection management. `manifest.json` declares permissions (dynamic-page access, localhost network). The plugin is **not built/bundled** — `code.js` is written directly as the runtime artifact.

## Key Patterns

- **Colors**: Figma uses RGBA 0-1 range. The MCP tools accept 0-1 floats and the filter converts to hex for display.
- **Logging**: All logs go to stderr. Stdout is reserved for MCP protocol messages.
- **Timeouts**: 30s default per command. Progress updates from the plugin reset the inactivity timer.
- **Chunking**: Large operations (scanning 100+ nodes) are chunked with progress updates to prevent Figma UI freezing.
- **Reconnection**: WebSocket auto-reconnects after 2 seconds on disconnect.
- **Zod validation**: All tool parameters are validated with Zod schemas.

## Setup

1. Run `bun setup` — installs dependencies and writes MCP config for both OpenCode (`opencode.json`) and Claude Code (`.mcp.json`)
2. `bun socket` in one terminal (WebSocket relay)
3. In Figma: Plugins → Development → Link existing plugin → select `src/opencode_mcp_plugin/manifest.json`
4. Run plugin in Figma, join a channel, then use tools from OpenCode or Claude Code

The OpenCode config written by `bun setup` points to the local build (absolute path):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "opencode-figma": {
      "type": "local",
      "command": ["bun", "/path/to/figma-mcp/dist/server.js"],
      "enabled": true,
      "environment": {
        "FIGMA_ACCESS_TOKEN": "{env:FIGMA_ACCESS_TOKEN}"
      }
    }
  }
}
```

The Claude Code config (`.mcp.json`) runs the local build relative to the project root:

```json
{
  "mcpServers": {
    "opencode-figma": {
      "command": "bun",
      "args": ["dist/server.js"]
    }
  }
}
```

You can also add it manually for Claude Code via the CLI:

```bash
claude mcp add opencode-figma -e FIGMA_ACCESS_TOKEN=<token> -- bun /path/to/figma-mcp/dist/server.js
```
