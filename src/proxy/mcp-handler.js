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

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServerWithTools } from '../server/index.js';
import { PROXY_CONFIG } from './detection.js';

/**
 * MCP Handler class that manages MCP server integration.
 * Provides methods for tool execution and server management.
 */
export class McpHandler {
  constructor(options = {}) {
    this.server = null;
    this.transport = null;
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
   * Initialize the MCP server and start listening for connections.
   * 
   * @async
   * @function initialize
   * @returns {Promise<void>} Resolves when server is initialized
   * 
   * @example
   * const handler = new McpHandler({ tools, resources });
   * await handler.initialize();
   */
  async initialize() {
    try {
      // Create MCP server with tools and resources
      this.server = await createServerWithTools({
        name: this.serverConfig.name || 'Browser MCP Proxy',
        version: this.serverConfig.version || '1.0.0',
        tools: this.tools,
        resources: this.resources,
      });
      
      // Create stdio transport for MCP communication
      this.transport = new StdioServerTransport();
      
      // Connect server to transport
      await this.server.connect(this.transport);
      
    } catch (error) {
      throw new Error(`Failed to initialize MCP server: ${error.message}`);
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
       // Create a mock context for tool execution
       // In a full implementation, this would be the actual browser context
       const context = await this.createToolContext();
       
       // Execute the tool
       const result = await tool.handle(context, args);
       
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
   * Create a context object for tool execution.
   * This would typically include browser connection and state.
   * 
   * @async
   * @function createToolContext
   * @returns {Promise<Object>} Context object for tool execution
   * @private
   */
  async createToolContext() {
    // In a full implementation, this would return the actual browser context
    // For now, we'll create a mock context that tools can use
    return {
      // Mock WebSocket connection - in real implementation this would be the browser connection
      ws: null,
      hasWs: () => false,
      close: async () => {},
      
      // Additional context methods can be added here
      getTimestamp: () => new Date().toISOString(),
      getSessionId: () => 'proxy-session-' + Date.now(),
    };
  }
  
  /**
   * Get server health information.
   * 
   * @function getHealthInfo
   * @returns {Object} Server health information
   */
  getHealthInfo() {
    return {
      status: this.server ? 'connected' : 'disconnected',
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
      if (this.server) {
        await this.server.close();
        this.server = null;
      }
      
      if (this.transport) {
        // Transport cleanup if needed
        this.transport = null;
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