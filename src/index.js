#!/usr/bin/env node

/**
 * Browser MCP Server - Main Entry Point
 * 
 * This is the main entry point for the Browser MCP server application.
 * It orchestrates all components to create a complete browser automation
 * server that communicates via the Model Context Protocol (MCP).
 * 
 * Key responsibilities:
 * - Tool collection and organization
 * - Server configuration and creation
 * - State machine initialization and execution
 * - Command-line interface setup
 * - Version and metadata management
 * 
 * The server provides browser automation capabilities to AI agents through
 * a standardized MCP interface, enabling tasks like navigation, form filling,
 * clicking, and page analysis.
 * 
 * @fileoverview Main entry point for Browser MCP server
 */

import { program } from 'commander';
import { appConfig } from './config/app.config.js';
import { createMcpServer } from './mcp/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { allTools } from './tools/index.js';
import { ProxyServer, isProxyRunning, getProxyConfig } from './proxy.js';
import { logger } from './utils/logger.js';

// Package metadata loading for version information
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';

// Resolve package.json path relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
);

/**
 * Helper function to make HTTP requests to the proxy server.
 * 
 * @async
 * @function makeProxyRequest
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} args - Arguments to pass to the tool
 * @returns {Promise<Object>} Tool execution result
 */
async function makeProxyRequest(toolName, args) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      name: toolName,
      arguments: args,
    });
    
    const options = {
      hostname: 'localhost',
      port: 9008,
      path: '/tool',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          if (res.statusCode !== 200) {
            reject(new Error(`Proxy server error: ${res.statusCode} ${res.statusMessage}`));
            return;
          }
          
          if (!result.success) {
            reject(new Error(result.message || 'Tool execution failed'));
            return;
          }
          
          resolve(result.result);
        } catch (error) {
          reject(new Error(`Failed to parse proxy response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Proxy communication error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

// ============================================================================
// TOOL COLLECTIONS
// Organized by functionality and snapshot behavior
// ============================================================================

/**
 * MCP resources for read-only browser state access.
 * Currently empty but can be extended to provide browser history,
 * bookmarks, or other browser state information.
 * 
 * @type {Array<Object>}
 */
const resources = [];

// Tools are sourced from a single authoritative list.
const runtimeTools = allTools;

/**
 * Factory function for creating MCP server instances.
 * Creates different server types based on whether a proxy server exists:
 * - If no proxy: Creates server with WebSocket for proxy functionality
 * - If proxy exists: Creates forwarding server that communicates with proxy
 * 
 * @async
 * @function createServer
 * @param {boolean} [useProxy=false] - Whether to create a forwarding server for existing proxy
 * @returns {Promise<Server>} Configured MCP server instance
 */
async function createServer() {
  // Forwarding wrappers (MCP -> Proxy HTTP)
  const proxyTools = runtimeTools.map((tool) => ({
    schema: tool.schema,
    handle: async (_context, args) => {
      try {
        return await makeProxyRequest(tool.schema.name, args);
      } catch (error) {
        return {
          content: [
            { type: 'text', text: `Proxy communication error: ${error.message}` },
          ],
          isError: true,
        };
      }
    },
  }));

  return createMcpServer({
    name: appConfig.name,
    version: packageJson.version,
    tools: proxyTools,
    resources,
  });
}

// ============================================================================
// UNIFIED STARTUP LOGIC
// Single unified flow for Browser MCP server
// ============================================================================

/**
 * Unified startup logic for Browser MCP server.
 * Implements the expected flow:
 * 1. Check for existing proxy server
 * 2. If proxy exists and is healthy: Start MCP server that communicates with proxy
 * 3. If no proxy exists: Start new proxy server + MCP server
 * 
 * @async
 * @function startBrowserMcp
 * @returns {Promise<void>} Resolves when server is started
 */
async function startBrowserMcp() {
  logger.log('Starting Browser MCP server...');
  
  // Check if proxy is already running
  const proxyRunning = await isProxyRunning();
  
  if (proxyRunning) {
    logger.log('✅ Existing healthy proxy server detected');
    const config = getProxyConfig();
    logger.log(`📡 Using proxy server:`);
    logger.log(`   HTTP API: ${config.endpoints.health}`);
    logger.log(`   Tool endpoint: ${config.endpoints.tool}`);
    logger.log(`   Browser WebSocket: ws://localhost:${config.MCP_PORT}`);
    
    // Create MCP server and connect via stdio transport.
    const mcpServer = await createServer();
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    logger.log('MCP server running (stdio). Press Ctrl+C to exit.');
    return;
  }
  
  logger.log('🔍 No existing proxy detected, starting new proxy server...');
  
  // Start new proxy server
  const proxy = new ProxyServer({
    tools: runtimeTools,
    resources,
    serverConfig: {
      name: appConfig.name,
      version: packageJson.version,
    },
  });
  
  const result = await proxy.start();
  
  if (result.status === 'started') {
    logger.log('✅ Proxy server started successfully');
    logger.log(`📡 Services available:`);
    logger.log(`   HTTP API: http://localhost:${result.ports.http}`);
    logger.log(`   Browser WebSocket: ws://localhost:${result.ports.mcp}`);
    logger.log(`   Tools: ${result.tools} available`);
    logger.log(`   Resources: ${result.resources} available`);
    
    // Now start MCP server that communicates with the new proxy
    logger.log('🔌 Starting MCP server with stdio transport (connects to new proxy)...');
    
    const mcpServer = await createServer();
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    logger.log('MCP server running (stdio). Press Ctrl+C to exit.');
  } else {
    logger.log('ℹ️  Using existing proxy server');
  }
}

// ============================================================================
// COMMAND LINE INTERFACE
// Setup using Commander.js for version display and execution
// ============================================================================

/**
 * Configure and execute the Browser MCP server.
 * Uses unified logic that automatically handles proxy detection and startup.
 */
program
  .version('Version ' + packageJson.version)
  .name(packageJson.name)
  .description(appConfig.description)
  /**
   * Main action handler that starts the Browser MCP server.
   * Implements unified logic:
   * 1. Check for existing proxy server
   * 2. If proxy exists: Use existing proxy
   * 3. If no proxy: Start new proxy server with MCP integration
   * 
   * @async
   */
  .action(async () => {
    try {
      await startBrowserMcp();
    } catch (error) {
      logger.error('❌ Failed to start Browser MCP server:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments and execute
program.parse(process.argv); 