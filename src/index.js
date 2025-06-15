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
import { createServerWithTools, createForwardingMcpServer } from './server/index.js';
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
import { logger } from './utils/logger.js';

// Package metadata loading for version information
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';

// Resolve package.json path relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
);

/**
 * Helper function to make HTTP requests to the proxy server.
 * 
 * @async
 * @function makeProxyRequest
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} args - Arguments to pass to the tool
 * @returns {Promise<Object>} Tool execution result
 */
async function makeProxyRequest(toolName, args) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      name: toolName,
      arguments: args,
    });
    
    const options = {
      hostname: 'localhost',
      port: 9008,
      path: '/tool',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          if (res.statusCode !== 200) {
            reject(new Error(`Proxy server error: ${res.statusCode} ${res.statusMessage}`));
            return;
          }
          
          if (!result.success) {
            reject(new Error(result.message || 'Tool execution failed'));
            return;
          }
          
          resolve(result.result);
        } catch (error) {
          reject(new Error(`Failed to parse proxy response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Proxy communication error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
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
 * Factory function for creating MCP server instances.
 * Creates different server types based on whether a proxy server exists:
 * - If no proxy: Creates server with WebSocket for proxy functionality
 * - If proxy exists: Creates forwarding server that communicates with proxy
 * 
 * @async
 * @function createServer
 * @param {boolean} [useProxy=false] - Whether to create a forwarding server for existing proxy
 * @returns {Promise<Server>} Configured MCP server instance
 */
async function createServer(useProxy = false) {
  // Create proxy-forwarding tools that send requests to the proxy server
  const proxyTools = snapshotTools.map(tool => ({
    schema: tool.schema,
    handle: async (context, args) => {
      // Forward tool call to proxy server via HTTP API
      try {
        const result = await makeProxyRequest(tool.schema.name, args);
        return result;
      } catch (error) {
        // Return MCP-formatted error response
        return {
          content: [{ type: 'text', text: `Proxy communication error: ${error.message}` }],
          isError: true,
        };
      }
    },
  }));
  
  if (useProxy) {
    // Create forwarding MCP server (no WebSocket) that forwards to proxy
    return createForwardingMcpServer({
      name: appConfig.name,
      version: packageJson.version,
      tools: proxyTools,
      resources,
    });
  } else {
    // Create full MCP server with WebSocket for proxy functionality
    return createServerWithTools({
      name: appConfig.name,
      version: packageJson.version,
      tools: snapshotTools,
      resources,
    });
  }
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
 * 2. If proxy exists and is healthy: Start MCP server that communicates with proxy
 * 3. If no proxy exists: Start new proxy server + MCP server
 * 
 * @async
 * @function startBrowserMcp
 * @returns {Promise<void>} Resolves when server is started
 */
async function startBrowserMcp() {
  logger.log('Starting Browser MCP server...');
  
  // Check if proxy is already running
  const proxyRunning = await isProxyRunning();
  
  if (proxyRunning) {
    logger.log('✅ Existing healthy proxy server detected');
    const config = getProxyConfig();
    logger.log(`📡 Using proxy server:`);
    logger.log(`   HTTP API: ${config.endpoints.health}`);
    logger.log(`   Tool endpoint: ${config.endpoints.tool}`);
    logger.log(`   Browser WebSocket: ws://localhost:${config.MCP_PORT}`);
    
    // Start MCP server that communicates with existing proxy
    logger.log('🔌 Starting MCP server with stdio transport (connects to existing proxy)...');
    
    const stateMachine = new ServerStateMachine({
      createServer: () => createServer(true), // Use proxy forwarding
      maxRetries: 3,
      retryDelay: 2000,
    });
    
    await stateMachine.run();
    return;
  }
  
  logger.log('🔍 No existing proxy detected, starting new proxy server...');
  
  // Start new proxy server
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
    logger.log('✅ Proxy server started successfully');
    logger.log(`📡 Services available:`);
    logger.log(`   HTTP API: http://localhost:${result.ports.http}`);
    logger.log(`   Browser WebSocket: ws://localhost:${result.ports.mcp}`);
    logger.log(`   Tools: ${result.tools} available`);
    logger.log(`   Resources: ${result.resources} available`);
    
    // Now start MCP server that communicates with the new proxy
    logger.log('🔌 Starting MCP server with stdio transport (connects to new proxy)...');
    
    const stateMachine = new ServerStateMachine({
      createServer: () => createServer(true), // Use proxy forwarding
      maxRetries: 3,
      retryDelay: 2000,
    });
    
    await stateMachine.run();
  } else {
    logger.log('ℹ️  Using existing proxy server');
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
      logger.error('❌ Failed to start Browser MCP server:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments and execute
program.parse(process.argv); 