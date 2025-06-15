/**
 * WebSocket Proxy/Load Balancer for Browser MCP Servers
 * 
 * This proxy server runs on the well-known port 9009 (the port the browser extension
 * expects to connect to) and forwards WebSocket connections to available Browser MCP
 * server instances discovered through the discovery service.
 * 
 * Key features:
 * - Listens on port 9009 for browser extension connections
 * - Queries discovery service to find available Browser MCP servers
 * - Implements round-robin load balancing
 * - Handles connection failures gracefully
 * - Automatically updates server list periodically
 * 
 * @fileoverview WebSocket proxy for distributing browser connections
 */

import { WebSocketServer, WebSocket } from 'ws';
import fetch from 'node-fetch';
import express from 'express';

const PROXY_PORT = 9009;
const DISCOVERY_SERVER_URL = 'http://localhost:3000';
const SERVER_REFRESH_INTERVAL = 5000; // Refresh server list every 5 seconds

/**
 * Available Browser MCP servers discovered from the discovery service
 * @type {Array<{address: string, port: number}>}
 */
let availableServers = [];

/**
 * Current index for round-robin load balancing
 * @type {number}
 */
let currentServerIndex = 0;

/**
 * Currently connected browser WebSocket
 * @type {WebSocket|null}
 */
let connectedBrowser = null;

/**
 * Pending browser command requests waiting for responses
 * @type {Map<string, {resolve: Function, reject: Function, timeout: NodeJS.Timeout}>}
 */
const pendingCommands = new Map();

/**
 * Fetches the list of available Browser MCP servers from the discovery service.
 * @async
 * @returns {Promise<Array<Object>>} Array of server objects with address and port
 */
async function fetchAvailableServers() {
  try {
    const response = await fetch(`${DISCOVERY_SERVER_URL}/servers`);
    if (response.ok) {
      const servers = await response.json();
      console.log(`Found ${servers.length} available Browser MCP servers`);
      return servers;
    } else {
      console.error(`Failed to fetch servers from discovery service: ${response.statusText}`);
      return [];
    }
  } catch (error) {
    console.error(`Error fetching servers from discovery service: ${error.message}`);
    return [];
  }
}

/**
 * Updates the list of available servers and logs changes.
 * @async
 */
async function updateServerList() {
  const newServers = await fetchAvailableServers();
  const previousCount = availableServers.length;
  availableServers = newServers;
  
  if (newServers.length !== previousCount) {
    console.log(`Server list updated: ${newServers.length} servers available`);
    if (newServers.length > 0) {
      console.log('Available servers:', newServers.map(s => `${s.address}:${s.port}`).join(', '));
    }
  }
  
  // Reset round-robin index if we have fewer servers now
  if (currentServerIndex >= availableServers.length) {
    currentServerIndex = 0;
  }
}

/**
 * Generates a unique command ID for tracking browser commands
 * @returns {string} Unique command ID
 */
function generateCommandId() {
  return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sends a browser command to the connected browser extension
 * @param {string} type - Command type
 * @param {*} payload - Command payload
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<*>} Command response
 */
function sendBrowserCommand(type, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!connectedBrowser || connectedBrowser.readyState !== WebSocket.OPEN) {
      reject(new Error('No browser extension connected'));
      return;
    }

    const commandId = generateCommandId();
    const command = {
      id: commandId,
      type,
      payload
    };

    // Set up timeout
    const timeout = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error(`Browser command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Store pending command
    pendingCommands.set(commandId, { resolve, reject, timeout });

    // Send command to browser
    connectedBrowser.send(JSON.stringify(command));
  });
}

/**
 * Handles incoming messages from the browser extension
 * @param {string} data - Raw message data
 */
function handleBrowserMessage(data) {
  try {
    const message = JSON.parse(data);
    
    if (message.id && pendingCommands.has(message.id)) {
      const { resolve, reject, timeout } = pendingCommands.get(message.id);
      clearTimeout(timeout);
      pendingCommands.delete(message.id);
      
      if (message.error) {
        reject(new Error(message.error));
      } else {
        resolve(message.data);
      }
    }
  } catch (error) {
    console.error('Error handling browser message:', error.message);
  }
}

/**
 * Sets up the Express HTTP server for handling Browser MCP server requests
 * @returns {express.Application} Express app instance
 */
function createHttpServer() {
  const app = express();
  app.use(express.json());

  // API endpoint for Browser MCP servers to send browser commands
  app.post('/api/browser-command', async (req, res) => {
    try {
      const { serverId, type, payload, options = {} } = req.body;
      
      if (!type) {
        return res.status(400).json({ error: 'Missing command type' });
      }

      console.log(`Received browser command from server ${serverId}: ${type}`);

      const result = await sendBrowserCommand(type, payload, options.timeoutMs || 30000);
      res.json({ data: result });
    } catch (error) {
      console.error('Error executing browser command:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return app;
}

/**
 * Starts the WebSocket proxy server and HTTP API server.
 * @async
 */
async function startProxyServer() {
  // Initial server list fetch
  await updateServerList();
  
  // Set up periodic server list updates
  setInterval(updateServerList, SERVER_REFRESH_INTERVAL);
  
  // Create HTTP server for Browser MCP server API
  const httpApp = createHttpServer();
  const httpServer = httpApp.listen(PROXY_PORT, () => {
    console.log(`Proxy HTTP server listening on port ${PROXY_PORT}`);
  });
  
  // Create WebSocket server on the same port for browser extension connections
  const wss = new WebSocketServer({ server: httpServer });
  
  console.log(`WebSocket proxy server listening on port ${PROXY_PORT}`);
  
  wss.on('connection', (clientWs, request) => {
    console.log('New browser extension connection received');
    
    // Replace any existing browser connection
    if (connectedBrowser) {
      connectedBrowser.close();
    }
    
    connectedBrowser = clientWs;
    
    // Handle messages from browser extension
    clientWs.on('message', handleBrowserMessage);
    
    // Handle browser disconnection
    clientWs.on('close', () => {
      console.log('Browser extension disconnected');
      connectedBrowser = null;
      
      // Reject all pending commands
      for (const [commandId, { reject, timeout }] of pendingCommands.entries()) {
        clearTimeout(timeout);
        reject(new Error('Browser extension disconnected'));
      }
      pendingCommands.clear();
    });
    
    // Handle errors
    clientWs.on('error', (error) => {
      console.error('Browser WebSocket error:', error.message);
    });
    
    console.log('Browser extension connected successfully');
  });
  
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error.message);
  });
  
  return { httpServer, wss };
}

/**
 * Main entry point for the proxy server.
 */
export async function startProxy() {
  try {
    await startProxyServer();
    console.log('WebSocket proxy server started successfully');
  } catch (error) {
    console.error('Failed to start proxy server:', error.message);
    process.exit(1);
  }
}

// If this file is run directly, start the proxy server
if (process.argv[1] === new URL(import.meta.url).pathname) {
  startProxy();
} 