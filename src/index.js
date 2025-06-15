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
// UNIFIED STARTUP LOGIC
// Single unified flow for Browser MCP server
// ============================================================================

/**
 * Unified startup logic for Browser MCP server.
 * Implements the expected flow:
 * 1. Check for existing proxy server
 * 2. If proxy exists and is healthy: Use existing proxy
 * 3. If no proxy exists: Start new proxy server with MCP integration
 * 
 * @async
 * @function startBrowserMcp
 * @returns {Promise<void>} Resolves when server is started
 */
async function startBrowserMcp() {
  console.log('Starting Browser MCP server...');
  
  // Check if proxy is already running
  const proxyRunning = await isProxyRunning();
  
  if (proxyRunning) {
    console.log('✅ Existing healthy proxy server detected');
    const config = getProxyConfig();
    console.log(`📡 Using proxy server:`);
    console.log(`   HTTP API: ${config.endpoints.health}`);
    console.log(`   Tool endpoint: ${config.endpoints.tool}`);
    console.log(`   Browser WebSocket: ws://localhost:${config.MCP_PORT}`);
    console.log('🚀 Browser MCP is ready to use existing proxy');
    console.log('💡 Press Ctrl+C to exit');
    
    // Keep process running and monitor proxy health
    const keepAlive = setInterval(async () => {
      // Periodic health check to ensure proxy is still running
      const stillRunning = await isProxyRunning();
      if (!stillRunning) {
        console.log('⚠️  Proxy server is no longer available');
        console.log('🔄 You may want to restart to create a new proxy server');
        // Could automatically restart here, but for now just warn
      }
    }, 30000); // Check every 30 seconds
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n👋 Browser MCP client shutting down...');
      clearInterval(keepAlive);
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n👋 Browser MCP client shutting down...');
      clearInterval(keepAlive);
      process.exit(0);
    });
    
    // Keep the function from returning so the process stays alive
    return new Promise(() => {}); // Never resolves, keeps process alive
  }
  
  console.log('🔍 No existing proxy detected, starting new proxy server...');
  
  // Start new proxy server with full MCP integration
  const proxy = new ProxyServer({
    tools: snapshotTools,
    resources,
    serverConfig: {
      name: appConfig.name,
      version: packageJson.version,
    },
  });
  
  const result = await proxy.start();
  
  if (result.status === 'started') {
    console.log('✅ Proxy server started successfully');
    console.log(`📡 Services available:`);
    console.log(`   HTTP API: http://localhost:${result.ports.http}`);
    console.log(`   Browser WebSocket: ws://localhost:${result.ports.mcp}`);
    console.log(`   Tools: ${result.tools} available`);
    console.log(`   Resources: ${result.resources} available`);
    console.log('🚀 Browser MCP proxy server is ready');
  } else {
    console.log('ℹ️  Using existing proxy server');
  }
}

// ============================================================================
// COMMAND LINE INTERFACE
// Setup using Commander.js for version display and execution
// ============================================================================

/**
 * Configure and execute the Browser MCP server.
 * Uses unified logic that automatically handles proxy detection and startup.
 */
program
  .version('Version ' + packageJson.version)
  .name(packageJson.name)
  .description(appConfig.description)
  /**
   * Main action handler that starts the Browser MCP server.
   * Implements unified logic:
   * 1. Check for existing proxy server
   * 2. If proxy exists: Use existing proxy
   * 3. If no proxy: Start new proxy server with MCP integration
   * 
   * @async
   */
  .action(async () => {
    try {
      await startBrowserMcp();
    } catch (error) {
      console.error('❌ Failed to start Browser MCP server:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments and execute
program.parse(process.argv); 