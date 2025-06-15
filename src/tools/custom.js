/**
 * Custom Browser MCP Tools
 * 
 * This file contains Browser MCP specific tools that provide advanced browser
 * capabilities not available in standard browser automation frameworks.
 * These tools leverage the browser extension's privileged access to provide
 * features like screenshots and console log access.
 * 
 * Key features:
 * - Screenshot capture with PNG format
 * - Console log retrieval for debugging
 * - Direct browser API access through extension
 * 
 * @fileoverview Browser MCP specific tools for advanced browser features
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { GetConsoleLogsTool, ScreenshotTool } from '../types/mcp-tool.js';

/**
 * Console logs retrieval tool.
 * Provides access to browser console logs for debugging and monitoring.
 * This tool captures all console output including errors, warnings, and
 * custom log messages from the current page.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Get all console logs
 * const result = await getConsoleLogs.handle(context, {});
 * console.log(result.content[0].text); // JSON formatted log entries
 * 
 * @example
 * // Use for debugging page issues
 * await navigate(false).handle(context, { url: 'https://example.com' });
 * const logs = await getConsoleLogs.handle(context, {});
 * // Check for JavaScript errors in the logs
 */
export const getConsoleLogs = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetConsoleLogsTool.shape.arguments),
  },
  /**
   * Handles console log retrieval requests.
   * Sends a request to the browser extension to collect all console logs
   * from the current page and formats them as JSON strings.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} _params - Tool parameters (unused for this tool)
   * @returns {Promise<Object>} MCP response with console logs as text content
   * 
   * @example
   * // Retrieve and process console logs
   * const response = await getConsoleLogs.handle(context, {});
   * const logText = response.content[0].text;
   * const logEntries = logText.split('\n').map(line => JSON.parse(line));
   */
  handle: async (context, _params) => {
    // Request console logs from browser extension
    const consoleLogs = await context.sendSocketMessage(
      'browser_get_console_logs',
      {}
    );
    
    // Format logs as JSON strings for easy parsing
    const text = consoleLogs.map((log) => JSON.stringify(log)).join('\n');
    
    return {
      content: [{ type: 'text', text }],
    };
  },
};

/**
 * Screenshot capture tool.
 * Captures a visual screenshot of the current browser page in PNG format.
 * This tool provides pixel-perfect visual representation of the page state,
 * useful for visual verification and documentation.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Capture current page screenshot
 * const result = await screenshot.handle(context, {});
 * // result.content[0] contains base64 PNG image data
 * 
 * @example
 * // Screenshot after navigation for verification
 * await navigate(false).handle(context, { url: 'https://example.com' });
 * await wait.handle(context, { time: 2 }); // Wait for page load
 * const screenshot = await screenshot.handle(context, {});
 */
export const screenshot = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScreenshotTool.shape.arguments),
  },
  /**
   * Handles screenshot capture requests.
   * Sends a request to the browser extension to capture a screenshot
   * of the current page and returns it as base64-encoded PNG data.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} _params - Tool parameters (unused for this tool)
   * @returns {Promise<Object>} MCP response with image content
   * 
   * @example
   * // Capture and save screenshot
   * const response = await screenshot.handle(context, {});
   * const imageData = response.content[0].data;
   * // imageData is base64-encoded PNG that can be saved or displayed
   */
  handle: async (context, _params) => {
    // Request screenshot from browser extension
    const screenshotData = await context.sendSocketMessage(
      'browser_screenshot',
      {}
    );
    
    return {
      content: [
        {
          type: 'image',
          data: screenshotData,
          mimeType: 'image/png',
        },
      ],
    };
  },
}; 