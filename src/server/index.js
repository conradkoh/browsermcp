/**
 * MCP Server Creation and Configuration
 * 
 * This file provides the core MCP server creation functionality, handling:
 * - Server initialization with tools and resources
 * - WebSocket server setup for browser communication
 * - Request routing and handler registration
 * - Error handling and response formatting
 * - Graceful shutdown and resource cleanup
 * 
 * The server acts as the bridge between MCP clients (like Claude) and the
 * browser extension, translating MCP protocol requests into browser actions.
 * 
 * @fileoverview MCP server creation with tool and resource management
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Context } from '../context.js';
import { createWebSocketServer } from '../ws/index.js';

/**
 * Creates and configures a complete MCP server with tools and resources.
 * This function sets up the entire server infrastructure including:
 * - MCP protocol server with capabilities
 * - WebSocket server for browser communication
 * - Request handlers for all MCP operations
 * - Context management for browser connections
 * - Graceful shutdown procedures
 * 
 * @async
 * @function createServerWithTools
 * @param {Object} options - Server configuration options
 * @param {string} options.name - Server name for MCP identification
 * @param {string} options.version - Server version string
 * @param {Array<Object>} options.tools - Array of tool objects with schema and handle methods
 * @param {Array<Object>} options.resources - Array of resource objects with schema and read methods
 * @param {string} options.port - WebSocket server port
 * @returns {Promise<Server>} Configured MCP server ready to handle requests
 * 
 * @example
 * // Create server with tools and resources
 * const server = await createServerWithTools({
 *   name: 'Browser MCP',
 *   version: '1.0.0',
 *   tools: [navigateTool, clickTool, typeTool],
 *   resources: [pageResource, historyResource],
 *   port: '8080'
 * });
 * 
 * @example
 * // Start server and handle connections
 * const server = await createServerWithTools(config);
 * await server.connect(transport);
 * // Server is now ready to handle MCP requests
 */
export async function createServerWithTools(options) {
  const { name, version, tools, resources, port } = options;
  
  // Create context for managing browser connections
  const context = new Context();
  
  // Initialize MCP server with capabilities
  const server = new Server(
    { name, version },
    {
      capabilities: {
        /** Indicates this server provides browser automation tools */
        tools: {},
        /** Indicates this server provides browser state resources */
        resources: {},
      },
    }
  );
  
  // Create WebSocket server for browser extension communication
  const wss = await createWebSocketServer(port);
  
  /**
   * Handle new WebSocket connections from browser extensions.
   * Only one connection is active at a time - new connections replace old ones.
   */
  wss.on('connection', (websocket) => {
    // Close existing connection if present
    if (context.hasWs()) {
      context.ws.close();
    }
    // Set new connection as active
    context.ws = websocket;
  });
  
  /**
   * Handler for ListTools requests.
   * Returns the schema definitions for all available tools.
   * This allows MCP clients to discover available browser automation capabilities.
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });
  
  /**
   * Handler for ListResources requests.
   * Returns the schema definitions for all available resources.
   * Resources provide read-only access to browser state information.
   */
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });
  
  /**
   * Handler for CallTool requests.
   * Routes tool execution requests to the appropriate tool handler.
   * Provides comprehensive error handling and response formatting.
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Find the requested tool by name
    const tool = tools.find(
      (tool) => tool.schema.name === request.params.name
    );
    
    // Return error if tool not found
    if (!tool) {
      return {
        content: [
          { type: 'text', text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }
    
    try {
      // Execute the tool with provided arguments
      const result = await tool.handle(context, request.params.arguments);
      return result;
    } catch (error) {
      // Return formatted error response
      return {
        content: [{ type: 'text', text: String(error) }],
        isError: true,
      };
    }
  });
  
  /**
   * Handler for ReadResource requests.
   * Routes resource read requests to the appropriate resource handler.
   * Resources provide read-only access to browser state and information.
   */
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    // Find the requested resource by URI
    const resource = resources.find(
      (resource) => resource.schema.uri === request.params.uri
    );
    
    // Return empty contents if resource not found
    if (!resource) {
      return { contents: [] };
    }
    
    // Read and return resource contents
    const contents = await resource.read(context, request.params.uri);
    return { contents };
  });
  
  /**
   * Enhanced server close method with comprehensive cleanup.
   * Ensures all resources are properly cleaned up on server shutdown:
   * - Closes MCP server connection
   * - Shuts down WebSocket server
   * - Closes browser extension connections
   */
  const originalClose = server.close.bind(server);
  server.close = async () => {
    await originalClose();
    await wss.close();
    await context.close();
  };
  
  return server;
} 