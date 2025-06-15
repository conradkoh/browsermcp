#!/usr/bin/env node

/**
 * Browser MCP Server - Main Entry Point
 * 
 * This is the main entry point for the Browser MCP server application.
 * It orchestrates all components to create a complete browser automation
 * server that communicates via the Model Context Protocol (MCP).
 * 
 * Key responsibilities:
 * - Tool collection and organization
 * - Server configuration and creation
 * - State machine initialization and execution
 * - Command-line interface setup
 * - Version and metadata management
 * 
 * The server provides browser automation capabilities to AI agents through
 * a standardized MCP interface, enabling tasks like navigation, form filling,
 * clicking, and page analysis.
 * 
 * @fileoverview Main entry point for Browser MCP server
 */

import { program } from 'commander';
import { appConfig } from './config/app.config.js';
import { createServerWithTools } from './server/index.js';
import { ServerStateMachine } from './server/state-machine.js';
import { navigate, goBack, goForward, pressKey, wait } from './tools/common.js';
import { getConsoleLogs, screenshot } from './tools/custom.js';
import {
  snapshot,
  click,
  hover,
  type,
  selectOption,
} from './tools/snapshot.js';
import { mcpConfig } from './config/mcp.config.js';
import { startDiscoveryServer } from './discovery/index.js';
import { fork } from 'child_process';
import { isPortInUse, killProcessOnPort, findAvailablePort } from './utils/port.js';
import { startProxy } from './proxy/index.js';
import { logger } from './utils/logger.js';

// Package metadata loading for version information
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';

// Resolve package.json path relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
);

// Unique ID for this server instance
const serverId = uuidv4();

// Discovery server URL (default to localhost:3000, can be overridden via CLI)
let discoveryServerUrl = 'http://localhost:3000';

// Current server port (set when server starts)
let currentServerPort = null;

/**
 * Registers this server instance with the discovery server.
 * @async
 */
async function registerWithDiscoveryServer(serverPort) {
  try {
    const response = await fetch(`${discoveryServerUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: serverId, address: 'localhost', port: serverPort }),
    });
    if (response.ok) {
      logger.log(`Registered server ${serverId} with discovery service.`);
    } else {
      logger.error(`Failed to register server ${serverId}: ${response.statusText}`);
    }
  } catch (error) {
    logger.error(`Error registering with discovery service: ${error.message}`);
  }
}

/**
 * Sends a heartbeat to the discovery server to keep this server active in the registry.
 * @async
 */
async function sendHeartbeat() {
  try {
    const response = await fetch(`${discoveryServerUrl}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: serverId }),
    });
    if (!response.ok) {
      if (response.status === 404) {
        // Server not found, need to re-register
        logger.log(`Server ${serverId} not found in discovery service, re-registering...`);
        await registerWithDiscoveryServer(currentServerPort);
      } else {
        logger.error(`Failed to send heartbeat for server ${serverId}: ${response.statusText}`);
      }
    }
  } catch (error) {
    logger.error(`Error sending heartbeat to discovery service: ${error.message}`);
    logger.log('Attempting to restart discovery server...');
    await runDiscoveryServerOnce(); // Attempt to restart discovery server
    // After restarting discovery server, re-register this server
    logger.log('Re-registering with restarted discovery server...');
    await registerWithDiscoveryServer(currentServerPort);
  }
}

/**
 * Fetches the list of active servers from the discovery server.
 * @async
 * @returns {Promise<Array<Object>>} An array of active server objects.
 */
async function getActiveServers() {
  try {
    const response = await fetch(`${discoveryServerUrl}/servers`);
    if (response.ok) {
      const servers = await response.json();
      logger.log('Active servers:', servers);
      return servers;
    } else {
      logger.error(`Failed to fetch active servers: ${response.statusText}`);
      return [];
    }
  } catch (error) {
    logger.error(`Error fetching active servers: ${error.message}`);
    return [];
  }
}

// ============================================================================
// TOOL COLLECTIONS
// Organized by functionality and snapshot behavior
// ============================================================================

/**
 * Common browser tools that don't require page snapshots.
 * These tools perform basic browser operations and return simple confirmations.
 * 
 * @type {Array<Object>}
 */
const commonTools = [pressKey, wait];

/**
 * Browser MCP specific tools for advanced browser features.
 * These tools provide capabilities unique to the Browser MCP extension.
 * 
 * @type {Array<Object>}
 */
const customTools = [getConsoleLogs, screenshot];

/**
 * DOM interaction tools that automatically capture page snapshots.
 * These tools perform actions and return updated page context for AI agents.
 * Navigation tools are configured with snapshot=true for AI context.
 * 
 * @type {Array<Object>}
 */
const snapshotTools = [
  // Navigation tools with snapshot capture for AI context
  navigate(true),   // Navigate to URL and capture resulting page
  goBack(true),     // Go back and capture resulting page
  goForward(true),  // Go forward and capture resulting page
  
  // Page analysis and DOM interaction tools
  snapshot,         // Capture current page accessibility tree
  click,            // Click element and capture resulting page
  hover,            // Hover over element and capture resulting page
  type,             // Type text and capture resulting page
  selectOption,     // Select dropdown option and capture resulting page
  
  // Include common and custom tools
  ...commonTools,
  ...customTools,
];

/**
 * MCP resources for read-only browser state access.
 * Currently empty but can be extended to provide browser history,
 * bookmarks, or other browser state information.
 * 
 * @type {Array<Object>}
 */
const resources = [];

/**
 * Factory function for creating configured MCP server instances.
 * This function encapsulates server creation with all tools and resources,
 * providing a clean interface for the state machine.
 * 
 * @async
 * @function createServer
 * @param {number} port - The port to run the WebSocket server on.
 * @param {string} serverId - The unique server ID.
 * @returns {Promise<Server>} Configured MCP server instance
 * 
 * @example
 * // Used by state machine to create server instances
 * const server = await createServer(9010, 'server-123');
 * await server.connect(transport);
 */
async function createServer(port, serverId) {
  return createServerWithTools({
    name: appConfig.name,
    version: packageJson.version,
    tools: snapshotTools,
    resources,
    port: port,
    serverId: serverId,
  });
}

/**
 * Server State Machine Diagram
 * ============================
 *
 * This diagram shows the state transitions in the ServerStateMachine:
 *
 * ```
 *     ┌─────────────────┐
 *     │   INITIALIZING  │
 *     └─────────┬───────┘
 *               │
 *               ▼
 *     ┌─────────────────┐    ┌───────────────────────────┐
 *     │ CREATING_SERVER │◄───┤ RETRYING_SERVER_CREATION  │
 *     └─────┬───────────┘    └─────────▲─────────────────┘
 *           │                          │
 *           ▼                          │ (retry if < maxRetries)
 *     ┌─────────────────┐              │
 *     │   CONNECTING    │              │
 *     └─────┬───────────┘              │
 *           │                          │
 *           ▼                          │
 *     ┌─────────────────┐    ┌────────────────────────┐  │
 *     │   CONNECTED     │    │ RETRYING_CONNECTION    │  │
 *     └─────┬───────────┘    └──────▲─────────────────┘  │
 *           │                       │                    │
 *           │ (connection lost)     │ (retry if < max)   │
 *           ▼                       │                    │
 *     ┌─────────────────┐           │                    │
 *     │  RECONNECTING   │───────────┘                    │
 *     └─────┬───────────┘                                │
 *           │                                            │
 *           └─────────────┐                              │
 *                         ▼                              │
 *     ┌─────────────────┐           ┌─────────────────┐  │
 *     │   RESTARTING    │──────────►│     FAILED      │──┘
 *     └─────┬───────────┘           └─────────────────┘
 *           │                             ▲
 *           └─────────────────────────────┘
 *                         │
 *                         │ (max retries exceeded)
 *
 *     Exit Signals (SIGTERM, SIGINT, etc.)
 *                │
 *                ▼
 *     ┌─────────────────┐
 *     │ SHUTTING_DOWN   │
 *     └─────┬───────────┘
 *           │
 *           ▼
 *     ┌─────────────────┐
 *     │    SHUTDOWN     │
 *     └─────────────────┘
 * ```
 *
 * **State Descriptions:**
 * - **INITIALIZING**: Initial state at startup
 * - **CREATING_SERVER**: Attempting to create MCP server instance
 * - **RETRYING_SERVER_CREATION**: Waiting before retrying server creation
 * - **CONNECTING**: Attempting to connect server to transport (stdio)
 * - **RETRYING_CONNECTION**: Waiting before retrying connection
 * - **CONNECTED**: Successfully running and handling requests
 * - **RECONNECTING**: Connection lost, attempting to reconnect
 * - **RESTARTING**: Max connection retries exceeded, performing full restart
 * - **SHUTTING_DOWN**: Graceful shutdown initiated
 * - **SHUTDOWN**: Shutdown complete
 * - **FAILED**: Permanent failure, process will exit
 */

async function runDiscoveryServerOnce() {
  const DISCOVERY_SERVER_PORT = 3000;
  // Check if discovery server is already running
  if (await isPortInUse(DISCOVERY_SERVER_PORT)) {
    logger.log(`Discovery server already running on port ${DISCOVERY_SERVER_PORT}`);
    return;
  }

  logger.log('Discovery server not found, starting a new one...');

  // Start the discovery server as a child process
  const discoveryProcess = fork('./src/discovery/index.js', [], {
    silent: true, // Keep child process output separate
    env: { PORT: DISCOVERY_SERVER_PORT },
  });

  // Optional: You can listen to process messages or errors if needed
  discoveryProcess.on('error', (err) => {
    logger.error('Discovery server child process error:', err);
  });

  discoveryProcess.on('exit', (code, signal) => {
    logger.log(
      `Discovery server child process exited with code ${code} and signal ${signal}`
    );
  });

  // Poll until the discovery server port is in use
  let attempts = 0;
  const maxAttempts = 20; // Try for up to 2 seconds (20 * 100ms)
  while (attempts < maxAttempts && !(await isPortInUse(DISCOVERY_SERVER_PORT))) {
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms before next check
  }

  if (!(await isPortInUse(DISCOVERY_SERVER_PORT))) {
    throw new Error(`Discovery server did not start on port ${DISCOVERY_SERVER_PORT} within the expected time.`);
  }

  logger.log(`Discovery server is now active on port ${DISCOVERY_SERVER_PORT}`);
}

async function runProxyServerOnce() {
  const PROXY_PORT = 9009;
  // Check if proxy server is already running
  if (await isPortInUse(PROXY_PORT)) {
    logger.log(`Proxy server already running on port ${PROXY_PORT}`);
    return;
  }

  logger.log('Proxy server not found, starting a new one...');

  // Start the proxy server as a child process
  const proxyProcess = fork('./src/proxy/index.js', [], {
    silent: true, // Keep child process output separate
  });

  // Optional: You can listen to process messages or errors if needed
  proxyProcess.on('error', (err) => {
    logger.error('Proxy server child process error:', err);
  });

  proxyProcess.on('exit', (code, signal) => {
    logger.log(
      `Proxy server child process exited with code ${code} and signal ${signal}`
    );
  });

  // Poll until the proxy server port is in use
  let attempts = 0;
  const maxAttempts = 20; // Try for up to 2 seconds (20 * 100ms)
  while (attempts < maxAttempts && !(await isPortInUse(PROXY_PORT))) {
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms before next check
  }

  if (!(await isPortInUse(PROXY_PORT))) {
    throw new Error(`Proxy server did not start on port ${PROXY_PORT} within the expected time.`);
  }

  logger.log(`Proxy server is now active on port ${PROXY_PORT}`);
}

// ============================================================================
// COMMAND LINE INTERFACE
// Setup using Commander.js for version display and execution
// ============================================================================

/**
 * Configure and execute the Browser MCP server.
 * Sets up command-line interface with version information and
 * initializes the state machine for robust server lifecycle management.
 */
program
  .version('Version ' + packageJson.version)
  .name(packageJson.name)
  .description(appConfig.description);

/**
 * Command to start just the proxy server.
 */
program
  .command('proxy')
  .description('Start the WebSocket proxy server on port 9009')
  .action(async () => {
    await runDiscoveryServerOnce(); // Ensure discovery server is running
    await startProxy(); // Start the proxy server directly
  });

/**
 * Command to list all active Browser MCP servers registered with the discovery service.
 * This allows users to see all available instances.
 */
program
  .command('list-servers')
  .description('List all active Browser MCP servers')
  .action(async () => {
    await runDiscoveryServerOnce(); // Ensure discovery server is running
    logger.log('Fetching active servers...');
    const activeServers = await getActiveServers();
    if (activeServers.length > 0) {
      logger.log('--- Active Browser MCP Servers ---');
      activeServers.forEach(server => {
        logger.log(`ID: ${server.id}, Address: ${server.address}:${server.port}`);
      });
      logger.log('----------------------------------');
    } else {
      logger.log('No active Browser MCP servers found.');
    }
  });

/**
 * Default command to start the Browser MCP server.
 * Creates and runs the state machine which manages the complete
 * server lifecycle including creation, connection, error recovery,
 * and graceful shutdown.
 */
program
  .command('start', { isDefault: true })
  .description('Start the Browser MCP server')
  .action(async () => {
    // Ensure discovery server is running (or start it)
    await runDiscoveryServerOnce();

    // Ensure proxy server is running (or start it)
    await runProxyServerOnce();

    // Find an available port for this Browser MCP server
    const serverPort = await findAvailablePort(mcpConfig.defaultWsPort + 1); // Start from 9010, since 9009 is for proxy
    currentServerPort = serverPort; // Store for use in heartbeat function
    logger.log(`Browser MCP server will use port: ${serverPort}`);

    // Create state machine with server factory function
    const stateMachine = new ServerStateMachine({
      createServer: () => createServer(serverPort, serverId),
    });
    
    // Register with discovery server on startup
    await registerWithDiscoveryServer(serverPort);

    // Start sending heartbeats periodically (e.g., every 10 seconds)
    setInterval(sendHeartbeat, 10000);

    // Start the state machine - this will run until shutdown
    await stateMachine.run();
  });

// Add option to specify discovery server URL
program.option('--discovery-server-url <url>', 'URL of the discovery server', (url) => {
  discoveryServerUrl = url;
});

// Parse command line arguments and execute
program.parse(process.argv); 