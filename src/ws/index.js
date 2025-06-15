/**
 * WebSocket Server Creation
 * 
 * This file provides functionality for creating and configuring WebSocket servers
 * used for communication with browser extensions. It handles port management,
 * process cleanup, and server initialization with robust error handling.
 * 
 * The WebSocket server serves as the communication bridge between the MCP server
 * and the Browser MCP extension running in web browsers.
 * 
 * @fileoverview WebSocket server creation and configuration
 */

import { WebSocketServer } from 'ws';
import { mcpConfig } from '../config/mcp.config.js';
import { wait } from '../utils/index.js';
import { logger } from '../utils/logger.js';
import { killProcessOnPort, isPortInUse } from '../utils/port.js';

/**
 * Creates and initializes a WebSocket server on the specified port.
 * This function handles the complete server setup process including:
 * - Cleaning up any existing processes on the port
 * - Waiting for port availability with retry logic
 * - Creating and starting the WebSocket server
 * - Comprehensive error handling and logging
 * 
 * @async
 * @function createWebSocketServer
 * @param {number} [port=mcpConfig.defaultWsPort] - The port number to bind the server to
 * @returns {Promise<WebSocketServer>} The configured and running WebSocket server
 * @throws {Error} Throws error if port cannot be freed or server cannot start
 * 
 * @example
 * // Create server on default port
 * const wss = await createWebSocketServer();
 * 
 * @example
 * // Create server on custom port
 * const wss = await createWebSocketServer(8080);
 * wss.on('connection', (ws) => {
 *   console.log('Client connected');
 * });
 * 
 * @example
 * // Handle server creation errors
 * try {
 *   const wss = await createWebSocketServer(9009);
 *   console.log('Server started successfully');
 * } catch (error) {
 *   console.error('Failed to start server:', error.message);
 * }
 */
export async function createWebSocketServer(port = mcpConfig.defaultWsPort) {
  logger.log(`Initializing WebSocket server on port ${port}...`);
  
  // Clean up any existing processes using the target port
  killProcessOnPort(port);

  // Give processes time to fully terminate before checking availability
  await wait(500);

  let attempts = 0;
  const maxAttempts = 50; // Maximum wait time: 5 seconds (50 * 100ms)

  /**
   * Port availability polling loop.
   * Continuously checks if the port is available, with a maximum retry limit
   * to prevent infinite waiting in case of persistent port conflicts.
   */
  while (await isPortInUse(port)) {
    attempts++;
    if (attempts > maxAttempts) {
      throw new Error(
        `Port ${port} is still in use after ${
          maxAttempts * 100
        }ms. Unable to start server.`
      );
    }
    logger.log(
      `Port ${port} still in use, waiting... (attempt ${attempts}/${maxAttempts})`
    );
    await wait(100);
  }

  logger.log(`Port ${port} is now available. Starting WebSocket server...`);
  
  // Create the WebSocket server instance
  const wss = new WebSocketServer({ port });
  
  logger.log(`WebSocket server successfully started on port ${port}`);
  return wss;
} 