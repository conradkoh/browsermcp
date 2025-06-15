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
  /**
   * Main action handler that starts the Browser MCP server.
   * Creates and runs the state machine which manages the complete
   * server lifecycle including creation, connection, error recovery,
   * and graceful shutdown.
   * 
   * @async
   */
  .action(async () => {
    // Create state machine with server factory function
    const stateMachine = new ServerStateMachine({
      createServer,
    });
    
    // Start the state machine - this will run until shutdown
    await stateMachine.run();
  });

// Parse command line arguments and execute
program.parse(process.argv); 