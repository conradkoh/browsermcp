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
import { ProxyServer, isProxyRunning, getProxyConfig } from './proxy.js';

// Package metadata loading for version information
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Resolve package.json path relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
);

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
 * @returns {Promise<Server>} Configured MCP server instance
 * 
 * @example
 * // Used by state machine to create server instances
 * const server = await createServer();
 * await server.connect(transport);
 */
async function createServer() {
  return createServerWithTools({
    name: appConfig.name,
    version: packageJson.version,
    tools: snapshotTools,
    resources,
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

// ============================================================================
// STARTUP MODE FUNCTIONS
// Different ways to start the Browser MCP server
// ============================================================================

/**
 * Start only the proxy server without the MCP state machine.
 * This mode is useful for dedicated proxy instances.
 * 
 * @async
 * @function startProxyOnly
 * @returns {Promise<void>} Resolves when proxy server is started
 */
async function startProxyOnly() {
  console.log('Starting Browser MCP in proxy-only mode...');
  
  const proxy = new ProxyServer({
    tools: snapshotTools,
    resources,
    serverConfig: {
      name: appConfig.name,
      version: packageJson.version,
    },
  });
  
  const result = await proxy.start();
  
  if (result.status === 'existing') {
    console.log('Existing proxy server detected and healthy');
    console.log('Proxy-only mode: Using existing proxy server');
  } else {
    console.log('Proxy server started successfully in proxy-only mode');
  }
  
  // Keep the process running
  process.on('SIGINT', async () => {
    console.log('\nShutting down proxy server...');
    await proxy.stop();
    process.exit(0);
  });
}

/**
 * Start with proxy server (forced or auto-detected).
 * 
 * @async
 * @function startWithProxy
 * @param {boolean} [force=false] - Force start proxy even if one exists
 * @returns {Promise<void>} Resolves when started
 */
async function startWithProxy(force = false) {
  console.log('Starting Browser MCP with proxy server...');
  
  if (!force) {
    // Check if proxy is already running
    const proxyRunning = await isProxyRunning();
    if (proxyRunning) {
      console.log('Existing healthy proxy server detected');
      const config = getProxyConfig();
      console.log(`Using proxy server at:`);
      console.log(`  HTTP API: ${config.endpoints.health}`);
      console.log(`  Tool endpoint: ${config.endpoints.tool}`);
      console.log('Browser MCP is ready to use existing proxy');
      return;
    }
  }
  
  // Start new proxy server
  const proxy = new ProxyServer({
    tools: snapshotTools,
    resources,
    serverConfig: {
      name: appConfig.name,
      version: packageJson.version,
    },
  });
  
  await proxy.start();
  console.log('Browser MCP proxy server started successfully');
}

/**
 * Start in direct MCP mode using the state machine.
 * This bypasses the proxy system entirely.
 * 
 * @async
 * @function startDirectMcp
 * @returns {Promise<void>} Resolves when state machine is running
 */
async function startDirectMcp() {
  console.log('Starting Browser MCP in direct mode (no proxy)...');
  
  // Create state machine with server factory function
  const stateMachine = new ServerStateMachine({
    createServer,
  });
  
  // Start the state machine - this will run until shutdown
  await stateMachine.run();
}

/**
 * Auto-detection mode: Check for existing proxy, use if available,
 * otherwise start direct MCP mode.
 * 
 * @async
 * @function startWithAutoDetection
 * @returns {Promise<void>} Resolves when started
 */
async function startWithAutoDetection() {
  console.log('Starting Browser MCP with auto-detection...');
  
  // Check if proxy is already running
  const proxyRunning = await isProxyRunning();
  
  if (proxyRunning) {
    console.log('Existing healthy proxy server detected');
    const config = getProxyConfig();
    console.log(`Using proxy server at:`);
    console.log(`  HTTP API: ${config.endpoints.health}`);
    console.log(`  Tool endpoint: ${config.endpoints.tool}`);
    console.log('Browser MCP is ready to use existing proxy');
    return;
  }
  
  console.log('No existing proxy detected, starting direct MCP mode...');
  await startDirectMcp();
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
  .description(appConfig.description)
  .option('--proxy', 'Start in proxy mode (HTTP API + MCP server)')
  .option('--no-proxy', 'Force direct MCP mode (disable proxy detection)')
  .option('--proxy-only', 'Start only the proxy server without MCP state machine')
  /**
   * Main action handler that starts the Browser MCP server.
   * Supports multiple modes:
   * - Default: Auto-detect proxy and use if available, otherwise start direct MCP
   * - --proxy: Force start proxy server
   * - --no-proxy: Force direct MCP mode
   * - --proxy-only: Start only proxy server
   * 
   * @async
   */
  .action(async (options) => {
    try {
      if (options.proxyOnly) {
        // Start only the proxy server
        await startProxyOnly();
      } else if (options.proxy) {
        // Force start proxy server
        await startWithProxy(true);
      } else if (options.proxy === false) {
        // Force direct MCP mode
        await startDirectMcp();
      } else {
        // Auto-detect mode (default)
        await startWithAutoDetection();
      }
    } catch (error) {
      console.error('Failed to start Browser MCP server:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments and execute
program.parse(process.argv); 