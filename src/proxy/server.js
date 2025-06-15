/**
 * Proxy HTTP Server Implementation
 * 
 * This module provides the HTTP server that exposes MCP tools via REST API.
 * It handles incoming HTTP requests and forwards them to the MCP server.
 * 
 * Key responsibilities:
 * - HTTP server setup on port 9008
 * - Request validation and sanitization
 * - Tool call forwarding to MCP server
 * - Response formatting and error handling
 * - Health check endpoint
 * 
 * @fileoverview HTTP server for MCP tool REST API
 */

import http from 'http';
import { URL } from 'url';
import { PROXY_CONFIG } from './detection.js';

/**
 * Create and configure HTTP server for proxy API.
 * 
 * @async
 * @function createHttpServer
 * @param {Object} options - Server configuration options
 * @param {Function} options.handleToolCall - Function to handle tool calls
 * @param {number} [options.port=9008] - Port to listen on
 * @returns {Promise<http.Server>} Configured HTTP server
 * 
 * @example
 * const server = await createHttpServer({
 *   handleToolCall: async (toolName, args) => {
 *     // Handle tool call logic
 *     return { success: true, result: 'Tool executed' };
 *   }
 * });
 */
export async function createHttpServer(options) {
  const { handleToolCall, port = PROXY_CONFIG.HTTP_PORT } = options;
  
  const server = http.createServer(async (req, res) => {
    // Set CORS headers for cross-origin requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      
      // Route requests to appropriate handlers
      if (url.pathname === '/health') {
        await handleHealthCheck(req, res);
      } else if (url.pathname === '/tool' && req.method === 'POST') {
        await handleToolRequest(req, res, handleToolCall);
      } else if (url.pathname === '/tools' && req.method === 'GET') {
        await handleListTools(req, res, handleToolCall);
      } else {
        // Handle 404 for unknown endpoints
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Not Found',
          message: `Endpoint ${url.pathname} not found`,
          availableEndpoints: ['/health', '/tool', '/tools']
        }));
      }
    } catch (error) {
      // Handle unexpected errors
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }));
    }
  });
  
  // Enhanced server close method
  const originalClose = server.close.bind(server);
  server.close = () => {
    return new Promise((resolve) => {
      originalClose(() => resolve());
    });
  };
  
  return server;
}

/**
 * Handle health check requests.
 * Returns server status and basic information.
 * 
 * @async
 * @function handleHealthCheck
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 */
async function handleHealthCheck(req, res) {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    ports: {
      http: PROXY_CONFIG.HTTP_PORT,
      mcp: PROXY_CONFIG.MCP_PORT
    }
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(healthData, null, 2));
}

/**
 * Handle tool execution requests.
 * Validates request format and forwards to MCP server.
 * 
 * @async
 * @function handleToolRequest
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 * @param {Function} handleToolCall - Tool call handler function
 */
async function handleToolRequest(req, res, handleToolCall) {
  try {
    // Parse request body
    const body = await parseRequestBody(req);
    
    // Validate request format
    const validation = validateToolRequest(body);
    if (!validation.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad Request',
        message: validation.message,
        expectedFormat: {
          name: 'string (required) - Tool name to execute',
          arguments: 'object (optional) - Tool arguments'
        }
      }));
      return;
    }
    
    // Execute tool call
    const result = await handleToolCall(body.name, body.arguments || {});
    
    // Return successful response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      tool: body.name,
      result: result
    }, null, 2));
    
  } catch (error) {
    // Handle tool execution errors
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Tool Execution Error',
      message: error.message,
      tool: body?.name || 'unknown'
    }));
  }
}

/**
 * Handle list tools requests.
 * Returns available tools and their schemas.
 * 
 * @async
 * @function handleListTools
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 * @param {Function} handleToolCall - Tool call handler function (for getting tool list)
 */
async function handleListTools(req, res, handleToolCall) {
  try {
    // Get available tools from MCP server
    const tools = await handleToolCall('__list_tools__', {});
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      tools: tools
    }, null, 2));
    
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to list tools',
      message: error.message
    }));
  }
}

/**
 * Parse HTTP request body as JSON.
 * 
 * @async
 * @function parseRequestBody
 * @param {http.IncomingMessage} req - HTTP request object
 * @returns {Promise<Object>} Parsed request body
 * @throws {Error} If body parsing fails
 */
async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        if (!body.trim()) {
          resolve({});
          return;
        }
        
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    
    req.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Validate tool request format.
 * 
 * @function validateToolRequest
 * @param {Object} body - Request body to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether request is valid
 * @returns {string} returns.message - Validation message
 */
function validateToolRequest(body) {
  if (!body || typeof body !== 'object') {
    return {
      valid: false,
      message: 'Request body must be a JSON object'
    };
  }
  
  if (!body.name || typeof body.name !== 'string') {
    return {
      valid: false,
      message: 'Tool name is required and must be a string'
    };
  }
  
  if (body.arguments && typeof body.arguments !== 'object') {
    return {
      valid: false,
      message: 'Tool arguments must be an object if provided'
    };
  }
  
  return { valid: true, message: 'Valid request' };
}

/**
 * Start HTTP server and return promise that resolves when server is listening.
 * 
 * @async
 * @function startHttpServer
 * @param {http.Server} server - HTTP server instance
 * @param {number} port - Port to listen on
 * @returns {Promise<void>} Resolves when server is listening
 * 
 * @example
 * const server = await createHttpServer(options);
 * await startHttpServer(server, 9008);
 * console.log('HTTP server listening on port 9008');
 */
export async function startHttpServer(server, port) {
  return new Promise((resolve, reject) => {
    server.listen(port, 'localhost', (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
} 