/**
 * Application Context Management
 * 
 * This file provides the Context class which manages the WebSocket connection
 * to the browser extension and provides a unified interface for sending messages.
 * The context serves as the communication layer between the MCP server and
 * the browser extension.
 * 
 * Key responsibilities:
 * - Managing WebSocket connection lifecycle
 * - Providing a safe interface for message sending
 * - Handling connection state and error conditions
 * - Translating MCP errors to user-friendly messages
 * 
 * @fileoverview Application context and WebSocket connection management
 */

import { mcpConfig } from './config/mcp.config.js';
import { createSocketMessageSender } from './ws/sender.js';
import { logger } from './utils/logger.js';

/**
 * User-friendly error message displayed when no browser extension connection exists.
 * This message provides clear instructions on how to establish a connection.
 * 
 * @type {string}
 * @constant
 */
const noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Browser MCP extension icon in the browser toolbar and clicking the 'Connect' button.`;

/**
 * Context class that manages the WebSocket connection to the browser extension.
 * This class provides a safe, managed interface for communicating with the browser
 * and handles connection state, error conditions, and message routing.
 * 
 * The Context class implements a singleton-like pattern where only one WebSocket
 * connection is active at a time, automatically replacing old connections when
 * new ones are established.
 * 
 * @class Context
 * 
 * @example
 * const context = new Context();
 * context.ws = websocketConnection;
 * const result = await context.sendSocketMessage('browser_click', { element: 'button' });
 */
export class Context {
  /**
   * Private WebSocket connection instance.
   * Access should be through the ws getter/setter for proper error handling.
   * 
   * @type {WebSocket|null}
   * @private
   */
  _ws;

  /**
   * Gets the current WebSocket connection.
   * Throws an error if no connection is available, providing user-friendly
   * guidance on how to establish a connection.
   * 
   * @type {WebSocket}
   * @throws {Error} Throws error with connection instructions if no WebSocket is available
   * 
   * @example
   * try {
   *   const ws = context.ws;
   *   // Use WebSocket connection
   * } catch (error) {
   *   console.error(error.message); // User-friendly connection instructions
   * }
   */
  get ws() {
    if (!this._ws) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }

  /**
   * Sets the WebSocket connection.
   * This automatically replaces any existing connection, allowing for
   * seamless connection updates when new browser tabs connect.
   * 
   * @param {WebSocket} ws - The new WebSocket connection to use
   * 
   * @example
   * // Set initial connection
   * context.ws = newWebSocketConnection;
   * 
   * @example
   * // Replace existing connection
   * if (context.hasWs()) {
   *   context.ws.close(); // Optional: explicitly close old connection
   * }
   * context.ws = newWebSocketConnection;
   */
  set ws(ws) {
    this._ws = ws;
  }

  /**
   * Checks if a WebSocket connection is currently available.
   * This is a safe way to test for connection availability without
   * triggering the error that the ws getter would throw.
   * 
   * @method hasWs
   * @returns {boolean} True if a WebSocket connection exists, false otherwise
   * 
   * @example
   * if (context.hasWs()) {
   *   // Safe to use context.ws or sendSocketMessage
   *   const result = await context.sendSocketMessage('getUrl');
   * } else {
   *   console.log('No browser connection available');
   * }
   */
  hasWs() {
    return !!this._ws;
  }

  /**
   * Sends a message over the WebSocket connection and waits for a response.
   * This method provides a high-level interface for browser communication
   * with automatic error translation and timeout handling.
   * 
   * @async
   * @method sendSocketMessage
   * @param {string} type - The message type identifier (e.g., 'browser_click', 'getUrl')
   * @param {*} payload - The message payload data
   * @param {Object} [options={ timeoutMs: 30000 }] - Configuration options
   * @param {number} [options.timeoutMs=30000] - Timeout in milliseconds
   * @returns {Promise<*>} Promise that resolves with the response data
   * @throws {Error} Throws user-friendly error messages for connection and communication issues
   * 
   * @example
   * // Get current page URL
   * const url = await context.sendSocketMessage('getUrl', undefined);
   * 
   * @example
   * // Click an element with custom timeout
   * await context.sendSocketMessage('browser_click', 
   *   { element: 'Login button', ref: 'button[type="submit"]' },
   *   { timeoutMs: 10000 }
   * );
   * 
   * @example
   * // Handle communication errors
   * try {
   *   const result = await context.sendSocketMessage('browser_action', data);
   * } catch (error) {
   *   if (error.message.includes('No connection')) {
   *     // Guide user to connect browser extension
   *   } else {
   *     // Handle other communication errors
   *   }
   * }
   */
  async sendSocketMessage(type, payload, options = { timeoutMs: 30000 }) {
    logger.log('Sending WebSocket message', {
      type,
      hasPayload: !!payload,
      payloadKeys: payload ? Object.keys(payload) : [],
      timeoutMs: options.timeoutMs,
      wsReadyState: this._ws?.readyState,
      wsUrl: this._ws?.url
    });
    
    const { sendSocketMessage } = createSocketMessageSender(this.ws);
    try {
      const startTime = Date.now();
      const result = await sendSocketMessage(type, payload, options);
      const responseTime = Date.now() - startTime;
      
      logger.log('WebSocket message completed successfully', {
        type,
        responseTimeMs: responseTime,
        resultType: typeof result,
        resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
        resultLength: typeof result === 'string' ? result.length : undefined
      });
      
      return result;
    } catch (e) {
      logger.error('WebSocket message failed', {
        type,
        error: e.message,
        stack: e.stack,
        wsReadyState: this._ws?.readyState,
        isNoConnectionError: e.message === mcpConfig.errors.noConnectedTab
      });
      
      // Translate internal MCP errors to user-friendly messages
      if (e instanceof Error && e.message === mcpConfig.errors.noConnectedTab) {
        throw new Error(noConnectionMessage);
      }
      throw e;
    }
  }

  /**
   * Closes the WebSocket connection gracefully.
   * This method safely closes the connection if one exists, without
   * throwing errors if no connection is available.
   * 
   * @async
   * @method close
   * @returns {Promise<void>} Promise that resolves when the connection is closed
   * 
   * @example
   * // Clean shutdown
   * await context.close();
   * 
   * @example
   * // Safe cleanup in error handlers
   * try {
   *   // ... application logic
   * } finally {
   *   await context.close(); // Always safe to call
   * }
   */
  async close() {
    if (!this._ws) {
      return;
    }
    await this._ws.close();
  }
} 