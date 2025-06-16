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
import { logger } from '../utils/logger.js';

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
    
    logger.log('Initializing MCP Handler', {
      toolCount: this.tools.length,
      resourceCount: this.resources.length,
      serverConfig: this.serverConfig
    });
    
    // Build tool map for quick lookup
    this.tools.forEach(tool => {
      this.toolMap.set(tool.schema.name, tool);
      logger.log('Registered tool', {
        name: tool.schema.name,
        description: tool.schema.description
      });
      
      // Add friendly alias without the "browser_" prefix (e.g., "navigate")
      if (tool.schema.name.startsWith('browser_')) {
        const alias = tool.schema.name.replace(/^browser_/, '');
        // Do not overwrite if an explicit tool already exists under that name
        if (!this.toolMap.has(alias)) {
          this.toolMap.set(alias, tool);
          logger.log('Added friendly alias', {
            original: tool.schema.name,
            alias: alias
          });
        }
        // Add alias with the historical duplicated prefix that some IDEs generate
        const doublePrefixed = `mcp_browser${tool.schema.name}`;
        if (!this.toolMap.has(doublePrefixed)) {
          this.toolMap.set(doublePrefixed, tool);
          logger.log('Added double-prefixed alias', {
            original: tool.schema.name,
            alias: doublePrefixed
          });
        }
        // Support historical double "mcp_" prefix (e.g., "mcp_browsermcp_browser_click")
        const legacyDoublePrefix = `mcp_browsermcp_${tool.schema.name}`;
        if (!this.toolMap.has(legacyDoublePrefix)) {
          this.toolMap.set(legacyDoublePrefix, tool);
          logger.log('Added legacy double-prefix alias', {
            original: tool.schema.name,
            alias: legacyDoublePrefix
          });
        }
      }
    });
    
    logger.log('Tool map built successfully', {
      totalMappings: this.toolMap.size,
      availableNames: Array.from(this.toolMap.keys())
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
      logger.log('Starting MCP Handler initialization', {
        mcpPort: PROXY_CONFIG.MCP_PORT
      });
      
      // Shared Context manages the browser WebSocket connection.
      this.context = new Context();
      logger.log('Created browser context');

      // Create a bare WebSocket server – **no MCP logic here**.  The only role
      // is to allow the browser extension to connect and communicate via the
      // Context instance used by the tool implementations.
      this.webSocketServer = await createWebSocketServer(PROXY_CONFIG.MCP_PORT);
      logger.log('WebSocket server created successfully', {
        port: PROXY_CONFIG.MCP_PORT
      });

      // Ensure singleton connection semantics (new connection replaces old).
      this.webSocketServer.on('connection', (ws) => {
        logger.log('Browser WebSocket connection received', {
          hasExistingConnection: this.context.hasWs(),
          remoteAddress: ws._socket?.remoteAddress,
          remotePort: ws._socket?.remotePort
        });
        
        if (this.context.hasWs()) {
          try {
            logger.log('Closing existing WebSocket connection');
            this.context.ws.close();
          } catch (error) {
            logger.error('Error closing existing WebSocket', { error: error.message });
          }
        }
        
        this.context.ws = ws;
        logger.log('Browser WebSocket connection established');
        
        // Add connection event handlers for debugging
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            logger.log('Received WebSocket message from browser', {
              type: message.type,
              id: message.id,
              hasPayload: !!message.payload
            });
          } catch (error) {
            logger.log('Received non-JSON WebSocket message', {
              dataLength: data.length,
              dataPreview: data.toString().substring(0, 100)
            });
          }
        });
        
        ws.on('close', (code, reason) => {
          logger.log('Browser WebSocket connection closed', {
            code,
            reason: reason?.toString(),
            wasClean: code === 1000
          });
        });
        
        ws.on('error', (error) => {
          logger.error('Browser WebSocket error', {
            error: error.message,
            stack: error.stack
          });
        });
      });

      // Note: stdio server is not created in proxy mode – the outer MCP
      // process will forward calls over HTTP.
      
      logger.log('MCP Handler initialization completed successfully');

    } catch (error) {
      logger.error('Failed to initialize MCP Handler', {
        error: error.message,
        stack: error.stack
      });
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
    logger.log('Tool call received', {
      toolName,
      args,
      hasContext: !!this.context,
      hasWebSocket: this.context?.hasWs(),
      availableTools: Array.from(this.toolMap.keys()).slice(0, 10) // First 10 for brevity
    });
    
    // Handle special internal tool calls
    if (toolName === '__list_tools__') {
      logger.log('Handling internal __list_tools__ call');
      return this.listTools();
    }
    
    // Find the tool in our tool map
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      logger.error('Tool not found', {
        requestedTool: toolName,
        availableTools: Array.from(this.toolMap.keys()),
        toolMapSize: this.toolMap.size
      });
      throw new Error(`Tool "${toolName}" not found. Available tools: ${Array.from(this.toolMap.keys()).join(', ')}`);
    }
    
    logger.log('Tool found and resolved', {
      toolName,
      resolvedName: tool.schema.name,
      toolDescription: tool.schema.description,
      hasHandle: typeof tool.handle === 'function'
    });
    
    // Check browser connection state before execution
    if (!this.context) {
      logger.error('No browser context available for tool execution', { toolName });
      throw new Error('Browser context not initialized');
    }
    
    if (!this.context.hasWs()) {
      logger.error('No browser WebSocket connection available', {
        toolName,
        contextExists: !!this.context
      });
      throw new Error('No browser connection available. Please connect the browser extension.');
    }
    
    logger.log('Browser connection verified, executing tool', {
      toolName,
      wsReadyState: this.context.ws.readyState,
      wsUrl: this.context.ws.url
    });
    
    try {
      // Use the real browser context for tool execution
      const startTime = Date.now();
      const result = await tool.handle(this.context, args);
      const executionTime = Date.now() - startTime;
      
      logger.log('Tool execution completed', {
        toolName,
        executionTimeMs: executionTime,
        resultType: typeof result,
        hasContent: !!(result?.content),
        contentLength: result?.content?.length,
        isError: result?.isError
      });
      
      // Log result content for debugging (truncated)
      if (result?.content) {
        result.content.forEach((item, index) => {
          logger.log(`Tool result content [${index}]`, {
            type: item.type,
            textLength: item.text?.length,
            textPreview: item.text?.substring(0, 200),
            hasData: !!item.data,
            mimeType: item.mimeType
          });
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Tool execution failed', {
        toolName,
        error: error.message,
        stack: error.stack,
        contextHasWs: this.context?.hasWs(),
        wsReadyState: this.context?.ws?.readyState
      });
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