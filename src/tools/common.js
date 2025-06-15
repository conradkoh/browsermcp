/**
 * Common Browser Automation Tools
 * 
 * This file contains basic browser automation tools that provide fundamental
 * browser operations like navigation, timing control, and keyboard input.
 * These tools form the foundation for more complex browser automation workflows.
 * 
 * All tools in this file follow the MCP tool pattern:
 * - Schema definition with Zod validation
 * - Handle function that executes the tool logic
 * - Consistent error handling and response formatting
 * 
 * @fileoverview Basic browser automation tools for navigation and input
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  NavigateTool,
  GoBackTool,
  GoForwardTool,
  WaitTool,
  PressKeyTool,
} from '../types/mcp-tool.js';
import { captureAriaSnapshot } from '../utils/aria-snapshot.js';

/**
 * Creates a navigation tool that can optionally capture page snapshots.
 * This factory function allows the tool to be configured for different use cases:
 * - With snapshot: Returns page state after navigation for AI context
 * - Without snapshot: Simple navigation confirmation for performance
 * 
 * @function navigate
 * @param {boolean} snapshot - Whether to capture page snapshot after navigation
 * @returns {Object} MCP tool object with schema and handler
 * 
 * @example
 * // Navigation with snapshot (for AI agents)
 * const navWithSnapshot = navigate(true);
 * 
 * @example
 * // Simple navigation (for performance)
 * const navSimple = navigate(false);
 */
export const navigate = (snapshot) => ({
  schema: {
    name: NavigateTool.shape.name.value,
    description: NavigateTool.shape.description.value,
    inputSchema: zodToJsonSchema(NavigateTool.shape.arguments),
  },
  /**
   * Handles URL navigation requests.
   * Validates the URL parameter and sends navigation command to browser.
   * Optionally captures page snapshot for AI context.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} params - Tool parameters
   * @param {string} params.url - Target URL to navigate to
   * @returns {Promise<Object>} MCP response with navigation result
   */
  handle: async (context, params) => {
    const { url } = NavigateTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_navigate', { url });
    
    if (snapshot) {
      return captureAriaSnapshot(context);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `Navigated to ${url}`,
        },
      ],
    };
  },
});

/**
 * Creates a back navigation tool that can optionally capture page snapshots.
 * Navigates to the previous page in browser history.
 * 
 * @function goBack
 * @param {boolean} snapshot - Whether to capture page snapshot after navigation
 * @returns {Object} MCP tool object with schema and handler
 * 
 * @example
 * // Back navigation with page context
 * const backTool = goBack(true);
 * await backTool.handle(context, {});
 */
export const goBack = (snapshot) => ({
  schema: {
    name: GoBackTool.shape.name.value,
    description: GoBackTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoBackTool.shape.arguments),
  },
  /**
   * Handles browser back navigation requests.
   * Sends back navigation command to browser and optionally captures
   * the resulting page state for AI context.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @returns {Promise<Object>} MCP response with navigation result
   */
  handle: async (context) => {
    await context.sendSocketMessage('browser_go_back', {});
    
    if (snapshot) {
      return captureAriaSnapshot(context);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: 'Navigated back',
        },
      ],
    };
  },
});

/**
 * Creates a forward navigation tool that can optionally capture page snapshots.
 * Navigates to the next page in browser history.
 * 
 * @function goForward
 * @param {boolean} snapshot - Whether to capture page snapshot after navigation
 * @returns {Object} MCP tool object with schema and handler
 * 
 * @example
 * // Forward navigation with page context
 * const forwardTool = goForward(true);
 * await forwardTool.handle(context, {});
 */
export const goForward = (snapshot) => ({
  schema: {
    name: GoForwardTool.shape.name.value,
    description: GoForwardTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoForwardTool.shape.arguments),
  },
  /**
   * Handles browser forward navigation requests.
   * Sends forward navigation command to browser and optionally captures
   * the resulting page state for AI context.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @returns {Promise<Object>} MCP response with navigation result
   */
  handle: async (context) => {
    await context.sendSocketMessage('browser_go_forward', {});
    
    if (snapshot) {
      return captureAriaSnapshot(context);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: 'Navigated forward',
        },
      ],
    };
  },
});

/**
 * Wait tool for introducing delays in automation sequences.
 * Useful for waiting for page loads, animations, or timed events.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Wait for 2 seconds
 * await wait.handle(context, { time: 2 });
 * 
 * @example
 * // Wait for page load after navigation
 * await navigate(false).handle(context, { url: 'https://example.com' });
 * await wait.handle(context, { time: 3 });
 */
export const wait = {
  schema: {
    name: WaitTool.shape.name.value,
    description: WaitTool.shape.description.value,
    inputSchema: zodToJsonSchema(WaitTool.shape.arguments),
  },
  /**
   * Handles wait/delay requests.
   * Validates the time parameter and sends wait command to browser.
   * The browser extension handles the actual delay to ensure proper timing.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} params - Tool parameters
   * @param {number} params.time - Time to wait in seconds
   * @returns {Promise<Object>} MCP response confirming the wait completion
   */
  handle: async (context, params) => {
    const { time } = WaitTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_wait', { time });
    
    return {
      content: [
        {
          type: 'text',
          text: `Waited for ${time} seconds`,
        },
      ],
    };
  },
};

/**
 * Keyboard input tool for sending key presses to the browser.
 * Supports both special keys (arrows, function keys) and regular characters.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Press Enter key
 * await pressKey.handle(context, { key: 'Enter' });
 * 
 * @example
 * // Press arrow key for navigation
 * await pressKey.handle(context, { key: 'ArrowDown' });
 * 
 * @example
 * // Type a single character
 * await pressKey.handle(context, { key: 'a' });
 */
export const pressKey = {
  schema: {
    name: PressKeyTool.shape.name.value,
    description: PressKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema(PressKeyTool.shape.arguments),
  },
  /**
   * Handles keyboard input requests.
   * Validates the key parameter and sends key press command to browser.
   * Supports both special keys and regular characters.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} params - Tool parameters
   * @param {string} params.key - Key to press (e.g., 'Enter', 'ArrowLeft', 'a')
   * @returns {Promise<Object>} MCP response confirming the key press
   */
  handle: async (context, params) => {
    const { key } = PressKeyTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_press_key', { key });
    
    return {
      content: [
        {
          type: 'text',
          text: `Pressed key ${key}`,
        },
      ],
    };
  },
}; 