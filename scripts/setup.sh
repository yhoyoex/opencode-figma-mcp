#!/bin/bash

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PATH="$PROJECT_DIR/dist/server.js"

OPENCODE_CONFIG='{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "opencode-figma": {
      "type": "local",
      "command": ["bun", "'"$SERVER_PATH"'"],
      "enabled": true,
      "environment": {
        "FIGMA_ACCESS_TOKEN": "{env:FIGMA_ACCESS_TOKEN}"
      }
    }
  }
}'

MCP_CONFIG='{
  "mcpServers": {
    "opencode-figma": {
      "command": "bun",
      "args": [
        "dist/server.js"
      ]
    }
  }
}'

cd "$PROJECT_DIR" || exit 1

bun install
bun run build

# OpenCode: write opencode.json in project root
echo "$OPENCODE_CONFIG" > opencode.json
echo "✓ OpenCode MCP config written to opencode.json"

# Claude Code: write .mcp.json in project root
echo "$MCP_CONFIG" > .mcp.json
echo "✓ Claude Code MCP config written to .mcp.json"
