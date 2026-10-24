#!/usr/bin/env node

import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 3055;
// localhost only; set HOST=0.0.0.0 to allow connections from Windows WSL
const HOST = process.env.HOST || "127.0.0.1";
const DEBUG = process.env.RELAY_DEBUG === "1";

// Store clients by channel
const channels = new Map<string, Set<WebSocket>>();

function sendToPeers(channelName: string, sender: WebSocket, payload: unknown) {
  const channelClients = channels.get(channelName);
  if (!channelClients) return 0;
  let count = 0;
  channelClients.forEach((client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      count++;
      client.send(JSON.stringify(payload));
    }
  });
  return count;
}

function handleMessage(ws: WebSocket, raw: string) {
  const data = JSON.parse(raw);
  console.log(`\n=== Received message from client ===`);
  console.log(`Type: ${data.type}, Channel: ${data.channel || 'N/A'}`);
  if (data.message?.command) {
    console.log(`Command: ${data.message.command}, ID: ${data.id}`);
  } else if (data.message?.result) {
    console.log(`Response: ID: ${data.id}, Has Result: ${!!data.message.result}`);
  }
  // Full payloads can be MBs (node trees); only dump them when RELAY_DEBUG=1
  if (DEBUG) console.log(`Full message:`, JSON.stringify(data, null, 2));

  if (data.type === "join") {
    const channelName = data.channel;
    if (!channelName || typeof channelName !== "string") {
      ws.send(JSON.stringify({ type: "error", message: "Channel name is required" }));
      return;
    }

    // Create channel if it doesn't exist
    if (!channels.has(channelName)) {
      channels.set(channelName, new Set());
    }

    // Add client to channel
    const channelClients = channels.get(channelName)!;
    channelClients.add(ws);

    console.log(`\n✓ Client joined channel "${channelName}" (${channelClients.size} total clients)`);

    // Notify client they joined successfully
    ws.send(JSON.stringify({
      type: "system",
      message: `Joined channel: ${channelName}`,
      channel: channelName
    }));

    ws.send(JSON.stringify({
      type: "system",
      message: {
        id: data.id,
        result: "Connected to channel: " + channelName,
      },
      channel: channelName
    }));

    // Notify other clients in channel
    sendToPeers(channelName, ws, {
      type: "system",
      message: "A new user has joined the channel",
      channel: channelName
    });
    return;
  }

  // Handle regular messages
  if (data.type === "message") {
    const channelName = data.channel;
    if (!channelName || typeof channelName !== "string") {
      ws.send(JSON.stringify({ type: "error", message: "Channel name is required" }));
      return;
    }

    const channelClients = channels.get(channelName);
    if (!channelClients || !channelClients.has(ws)) {
      ws.send(JSON.stringify({ type: "error", message: "You must join the channel first" }));
      return;
    }

    // Broadcast to all OTHER clients in the channel (not the sender)
    // This prevents echo and ensures proper request-response flow
    const broadcastMessage = {
      type: "broadcast",
      message: data.message,
      sender: "peer",
      channel: channelName
    };
    if (DEBUG) {
      console.log(`\n=== Broadcasting ===`);
      console.log(JSON.stringify(broadcastMessage, null, 2));
    }
    const broadcastCount = sendToPeers(channelName, ws, broadcastMessage);

    if (broadcastCount === 0) {
      console.log(`⚠️  No other clients in channel "${channelName}" to receive message!`);
    } else {
      console.log(`✓ Broadcast to ${broadcastCount} peer(s) in channel "${channelName}"`);
    }
  }

  // Forward progress_update messages to the MCP server so it can reset
  if (data.type === "progress_update") {
    const channelName = data.channel;
    if (!channelName) return;

    const channelClients = channels.get(channelName);
    if (!channelClients || !channelClients.has(ws)) return;

    sendToPeers(channelName, ws, data);
  }
}

const httpServer = createServer((req, res) => {
  const headers: Record<string, string> = { "Access-Control-Allow-Origin": "*" };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...headers,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  // Return response for non-WebSocket requests
  res.writeHead(200, { ...headers, "Content-Type": "text/plain" });
  res.end("WebSocket server running");
});

const wss = new WebSocketServer({ server: httpServer });

// Protocol-level ping keeps idle connections open and drops peers that stopped
// answering (e.g. a Figma plugin that was killed without a clean close)
const HEARTBEAT_MS = 30000;
const alive = new WeakMap<WebSocket, boolean>();
const heartbeat = setInterval(() => {
  wss.clients.forEach((client) => {
    if (alive.get(client) === false) {
      console.log("Terminating unresponsive client");
      client.terminate();
      return;
    }
    alive.set(client, false);
    client.ping();
  });
}, HEARTBEAT_MS);
wss.on("close", () => clearInterval(heartbeat));

wss.on("connection", (ws) => {
  // Don't add to clients immediately - wait for channel join
  console.log("New client connected");
  alive.set(ws, true);
  ws.on("pong", () => alive.set(ws, true));

  // Send welcome message to the new client
  ws.send(JSON.stringify({
    type: "system",
    message: "Please join a channel to start chatting",
  }));

  ws.on("message", (message) => {
    try {
      handleMessage(ws, message.toString());
    } catch (err) {
      console.error("Error handling message:", err);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");

    // Remove client from their channel and notify other clients
    channels.forEach((clients, channelName) => {
      if (clients.delete(ws)) {
        sendToPeers(channelName, ws, {
          type: "system",
          message: "A user has left the channel",
          channel: channelName
        });
      }
    });
  });
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Is another relay running? Set PORT to use a different port.`);
  } else {
    console.error("Relay server error:", err);
  }
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  console.log(`WebSocket server running on ${HOST}:${PORT}`);
});
