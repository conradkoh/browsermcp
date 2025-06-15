/**
 * Application Context Management
 * 
 * This file provides the Context class which manages communication with the browser
 * through the proxy server. Instead of requiring direct WebSocket connections,
 * all Browser MCP servers now route messages through the proxy via HTTP API.
 * 
 * Key responsibilities:
 * - Providing a unified interface for sending browser commands
 * - Routing messages through the proxy server
 * - Always reporting as "connected" for seamless operation
 * - Handling communication errors gracefully
 * 
 * @fileoverview Application context and proxy communication management
 */

import { mcpConfig } from './config/mcp.config.js';
import fetch from 'node-fetch';

/**
 * Context class that manages communication with the browser through the proxy server.
 * This class provides a unified interface for browser communication without requiring
 * direct WebSocket connections to individual Browser MCP servers.
 * 
 * All Browser MCP servers are now considered "always connected" and route their
 * browser commands through the centralized proxy server.
 * 
 * @class Context
 * 
 * @example
 * const context = new Context();
 * const result = await context.sendSocketMessage('browser_click', { element: 'button' });
 */
export class Context {
  /**
   * Proxy server URL for routing browser commands
   * @type {string}
   * @private
   */
  _proxyUrl = 'http://localhost:9009';

  /**
   * Server ID for identifying this Browser MCP server instance
   * @type {string}
   * @private
   */
  _serverId;

  /**
   * Creates a new Context instance.
   * @param {string} serverId - Unique identifier for this Browser MCP server
   */
  constructor(serverId) {
    this._serverId = serverId;
  }

  /**
   * Always returns true since all servers are considered connected through the proxy.
   * This ensures that all Browser MCP servers can process commands regardless of
   * direct browser connections.
   * 
   * @type {boolean}
   * @readonly
   */
  get ws() {
    // Always return a truthy value to indicate "connected" state
    return { connected: true };
  }

  /**
   * Setter for WebSocket compatibility (no-op since we use proxy routing).
   * @param {*} ws - Ignored parameter for compatibility
   */
  set ws(ws) {
    // No-op: We don't use direct WebSocket connections anymore
  }

  /**
   * Always returns true since all servers route through the proxy.
   * This ensures consistent behavior across all Browser MCP server instances.
   * 
   * @method hasWs
   * @returns {boolean} Always returns true
   */
  hasWs() {
    return true;
  }

  /**
   * Sends a browser command through the proxy server.
   * This method routes the command to the proxy, which handles browser communication
   * and returns the result back to this Browser MCP server.
   * 
   * @async
   * @method sendSocketMessage
   * @param {string} type - The message type identifier (e.g., 'browser_click', 'getUrl')
   * @param {*} payload - The message payload data
   * @param {Object} [options={ timeoutMs: 30000 }] - Configuration options
   * @param {number} [options.timeoutMs=30000] - Timeout in milliseconds
   * @returns {Promise<*>} Promise that resolves with the response data
   * @throws {Error} Throws error for communication issues
   * 
   * @example
   * // Get current page URL
   * const url = await context.sendSocketMessage('getUrl', undefined);
   * 
   * @example
   * // Click an element
   * await context.sendSocketMessage('browser_click', 
   *   { element: 'Login button', ref: 'button[type="submit"]' }
   * );
   */
  async sendSocketMessage(type, payload, options = { timeoutMs: 30000 }) {
    try {
      const response = await fetch(`${this._proxyUrl}/api/browser-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: this._serverId,
          type,
          payload,
          options
        }),
        timeout: options.timeoutMs
      });

      if (!response.ok) {
        throw new Error(`Proxy server error: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }

      return result.data;
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Unable to connect to proxy server. Please ensure the proxy is running.');
      }
      throw error;
    }
  }

  /**
   * No-op close method for compatibility.
   * Since we use HTTP requests instead of persistent connections,
   * there's nothing to close.
   * 
   * @async
   * @method close
   * @returns {Promise<void>} Promise that resolves immediately
   */
  async close() {
    // No-op: HTTP requests don't need explicit closing
    return Promise.resolve();
  }
} 