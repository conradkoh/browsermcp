/**
 * MCP Protocol Handler for Proxy Server
 * 
 * This module handles the integration between HTTP API requests and the MCP server.
 * It manages tool execution, message routing, and response formatting.
 * 
 * Key responsibilities:
 * - Bridge HTTP requests to MCP tool calls
 * - Handle MCP server communication on port 9009
 * - Manage tool execution and response formatting
 * - Provide tool listing and schema information
 * 
 * @fileoverview MCP protocol handling for proxy server
 */

import { createWebSocketServer } from '../ws/index.js';
import { PROXY_CONFIG } from './detection.js';
import { Context } from '../context.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Handler class that manages MCP server integration.
 * Provides methods for tool execution and server management.
 * Supports both WebSocket (for browser) and stdio (for IDE) transports.
 */
export class McpHandler {
  constructor(options = {}) {
    this.webSocketServer = null;  // Server with WebSocket for browser communication
    this.stdioServer = null;      // Server with stdio for IDE communication
    this.context = null;
    this.tools = options.tools || [];
    this.resources = options.resources || [];
    this.serverConfig = options.serverConfig || {};
    this.toolMap = new Map();
    
    // Build tool map for quick lookup
    this.tools.forEach(tool => {
      this.toolMap.set(tool.schema.name, tool);
    });
  }
  
  /**
   * Initialize WebSocket MCP server for browser communication.
   * This creates the WebSocket server for browser connections on port 9009.
   * 
   * @async
   * @function initialize
   * @returns {Promise<void>} Resolves when server is initialized
   */
  async initialize() {
    try {
      // Shared Context manages the browser WebSocket connection.
      this.context = new Context();

      // Create a bare WebSocket server – **no MCP logic here**.  The only role
      // is to allow the browser extension to connect and communicate via the
      // Context instance used by the tool implementations.
      this.webSocketServer = await createWebSocketServer(PROXY_CONFIG.MCP_PORT);

      // Ensure singleton connection semantics (new connection replaces old).
      this.webSocketServer.on('connection', (ws) => {
        if (this.context.hasWs()) {
          try {
            this.context.ws.close();
          } catch { /* ignore */ }
        }
        this.context.ws = ws;
      });

      // Note: stdio server is not created in proxy mode – the outer MCP
      // process will forward calls over HTTP.

    } catch (error) {
      throw new Error(`Failed to initialize Proxy WebSocket server: ${error.message}`);
    }
  }
  
  /**
   * Execute a tool call through the MCP server.
   * 
   * @async
   * @function executeToolCall
   * @param {string} toolName - Name of the tool to execute
   * @param {Object} args - Arguments to pass to the tool
   * @returns {Promise<Object>} Tool execution result
   * 
   * @example
   * const result = await handler.executeToolCall('navigate', { url: 'https://example.com' });
   */
  async executeToolCall(toolName, args = {}) {
    // Handle special internal tool calls
    if (toolName === '__list_tools__') {
      return this.listTools();
    }
    
    // Find the tool in our tool map
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found. Available tools: ${Array.from(this.toolMap.keys()).join(', ')}`);
    }
    
    try {
      // Use the real browser context for tool execution
      const result = await tool.handle(this.context, args);
      
      return result;
    } catch (error) {
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  }
  
  /**
   * List all available tools and their schemas.
   * 
   * @function listTools
   * @returns {Array<Object>} Array of tool schemas
   */
  listTools() {
    return this.tools.map(tool => ({
      name: tool.schema.name,
      description: tool.schema.description,
      inputSchema: tool.schema.inputSchema
    }));
  }
  
  /**
   * List all available resources and their schemas.
   * 
   * @function listResources
   * @returns {Array<Object>} Array of resource schemas
   */
  listResources() {
    return this.resources.map(resource => ({
      uri: resource.schema.uri,
      name: resource.schema.name,
      description: resource.schema.description,
      mimeType: resource.schema.mimeType
    }));
  }
  
  /**
   * Get the browser context for tool execution.
   * This provides access to the actual browser WebSocket connection.
   * 
   * @function getBrowserContext
   * @returns {Context} Browser context with WebSocket connection
   */
  getBrowserContext() {
    return this.context;
  }
  
  /**
   * Get server health information.
   * 
   * @function getHealthInfo
   * @returns {Object} Server health information
   */
  getHealthInfo() {
    return {
      status: this.webSocketServer ? 'connected' : 'disconnected',
      toolCount: this.tools.length,
      resourceCount: this.resources.length,
      availableTools: Array.from(this.toolMap.keys()),
      mcpPort: PROXY_CONFIG.MCP_PORT,
      httpPort: PROXY_CONFIG.HTTP_PORT,
    };
  }
  
  /**
   * Gracefully shutdown the MCP server and clean up resources.
   * 
   * @async
   * @function shutdown
   * @returns {Promise<void>} Resolves when shutdown is complete
   */
  async shutdown() {
    try {
      if (this.webSocketServer) {
        await this.webSocketServer.close();
        this.webSocketServer = null;
      }
      
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      
      if (this.stdioServer) {
        await this.stdioServer.close();
        this.stdioServer = null;
      }
      
      this.toolMap.clear();
    } catch (error) {
      // Log error but don't throw to ensure cleanup continues
      console.error('Error during MCP handler shutdown:', error);
    }
  }
}

/**
 * Factory function to create and initialize an MCP handler.
 * 
 * @async
 * @function createMcpHandler
 * @param {Object} options - Handler configuration options
 * @param {Array<Object>} options.tools - Array of tool objects
 * @param {Array<Object>} options.resources - Array of resource objects
 * @param {Object} options.serverConfig - Server configuration
 * @returns {Promise<McpHandler>} Initialized MCP handler
 * 
 * @example
 * const handler = await createMcpHandler({
 *   tools: [navigateTool, clickTool],
 *   resources: [pageResource],
 *   serverConfig: { name: 'My Proxy', version: '1.0.0' }
 * });
 */
export async function createMcpHandler(options) {
  const handler = new McpHandler(options);
  await handler.initialize();
  return handler;
}

/**
 * Create a tool call handler function for use with HTTP server.
 * This function bridges HTTP requests to MCP tool execution.
 * 
 * @function createToolCallHandler
 * @param {McpHandler} mcpHandler - Initialized MCP handler
 * @returns {Function} Tool call handler function
 * 
 * @example
 * const handler = await createMcpHandler(options);
 * const toolCallHandler = createToolCallHandler(handler);
 * 
 * const httpServer = await createHttpServer({
 *   handleToolCall: toolCallHandler
 * });
 */
export function createToolCallHandler(mcpHandler) {
  return async (toolName, args) => {
    try {
      const result = await mcpHandler.executeToolCall(toolName, args);
      return result;
    } catch (error) {
      // Re-throw with additional context
      throw new Error(`MCP tool call failed: ${error.message}`);
    }
  };
} 