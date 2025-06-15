/**
 * Model Context Protocol (MCP) Configuration
 * 
 * This file contains configuration specific to the MCP protocol implementation,
 * including network settings, error messages, and protocol-specific constants.
 * These settings control how the server communicates with MCP clients and
 * handles various protocol-level operations.
 * 
 * @fileoverview MCP protocol configuration and constants
 */

/**
 * MCP protocol configuration object containing settings for server behavior,
 * network communication, and standardized error messages.
 * 
 * @type {Object}
 * @property {number} defaultWsPort - Default WebSocket port for browser extension communication
 * @property {Object} errors - Standardized error messages used throughout the application
 * @property {string} errors.noConnectedTab - Error message when no browser tab is connected
 */
export const mcpConfig = {
  /**
   * Default WebSocket port for communication with the browser extension.
   * This port is used to establish a bidirectional communication channel
   * between the MCP server and the Browser MCP extension running in the browser.
   * 
   * @type {number}
   * @default 9009
   */
  defaultWsPort: 9009,
  
  /**
   * Standardized error messages used throughout the application.
   * Centralizing error messages here ensures consistency and makes
   * internationalization easier in the future.
   * 
   * @type {Object}
   */
  errors: {
    /**
     * Error message displayed when attempting to perform browser operations
     * without an active connection to a browser tab. This occurs when:
     * - No browser extension is installed
     * - Extension is installed but no tab is connected
     * - Connection was lost due to network issues
     * 
     * @type {string}
     */
    noConnectedTab: 'No tab is connected',
  },
}; 