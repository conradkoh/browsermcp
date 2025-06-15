#!/usr/bin/env node

/**
 * Browser MCP Proxy Server - Main Implementation
 * 
 * This is the main proxy server that provides HTTP API access to MCP tools
 * while maintaining browser connections. It implements a peer-to-peer architecture
 * where each MCP instance can act as a proxy server.
 * 
 * Key responsibilities:
 * - Proxy server detection and lifecycle management
 * - HTTP API server on port 9008 for tool calls
 * - MCP server integration on port 9009 for browser communication
 * - Graceful handling of multiple instances
 * - Tool execution and response formatting
 * 
 * Architecture:
 * HTTP Client → :9008/tool → Proxy Server → MCP Tools → Browser
 * 
 * @fileoverview Main proxy server implementation
 */

import { detectExistingProxy, PROXY_CONFIG } from './proxy/detection.js';
import { createHttpServer, startHttpServer } from './proxy/server.js';
import { createMcpHandler, createToolCallHandler } from './proxy/mcp-handler.js';
import { logger } from './utils/logger.js';

/**
 * Proxy Server class that manages the complete proxy lifecycle.
 * Handles detection, startup, tool execution, and shutdown.
 */
export class ProxyServer {
  constructor(options = {}) {
    this.tools = options.tools || [];
    this.resources = options.resources || [];
    this.serverConfig = options.serverConfig || {};
    this.httpServer = null;
    this.mcpHandler = null;
    this.isRunning = false;
    this.shutdownHandlers = [];
  }
  
  /**
   * Start the proxy server with automatic detection of existing instances.
   * 
   * @async
   * @function start
   * @returns {Promise<Object>} Startup result with status information
   * 
   * @example
   * const proxy = new ProxyServer({ tools, resources });
   * const result = await proxy.start();
   * logger.log(`Proxy server status: ${result.status}`);
   */
  async start() {
    try {
      // Check for existing proxy server
      const detection = await detectExistingProxy();
      
      if (detection.exists && detection.healthy) {
        return {
          status: 'existing',
          message: 'Using existing healthy proxy server',
          ports: {
            http: PROXY_CONFIG.HTTP_PORT,
            mcp: PROXY_CONFIG.MCP_PORT
          },
          detection
        };
      }
      
      if (detection.exists && !detection.healthy) {
        logger.warn('Existing proxy found but unhealthy, starting new proxy server');
      }
      
      // Start new proxy server
      await this.startProxyServer();
      
      return {
        status: 'started',
        message: 'New proxy server started successfully',
        ports: {
          http: PROXY_CONFIG.HTTP_PORT,
          mcp: PROXY_CONFIG.MCP_PORT
        },
        tools: this.tools.length,
        resources: this.resources.length
      };
      
    } catch (error) {
      throw new Error(`Failed to start proxy server: ${error.message}`);
    }
  }
  
  /**
   * Start the actual proxy server components.
   * 
   * @async
   * @function startProxyServer
   * @returns {Promise<void>} Resolves when server is started
   * @private
   */
  async startProxyServer() {
    try {
      // Initialize MCP handler
      this.mcpHandler = await createMcpHandler({
        tools: this.tools,
        resources: this.resources,
        serverConfig: this.serverConfig
      });
      
      // Create tool call handler for HTTP server
      const toolCallHandler = createToolCallHandler(this.mcpHandler);
      
      // Create HTTP server
      this.httpServer = await createHttpServer({
        handleToolCall: toolCallHandler,
        port: PROXY_CONFIG.HTTP_PORT
      });
      
      // Start HTTP server
      await startHttpServer(this.httpServer, PROXY_CONFIG.HTTP_PORT);
      
      this.isRunning = true;
      
      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();
      
      logger.log(`Proxy server started successfully:`);
      logger.log(`  HTTP API: http://localhost:${PROXY_CONFIG.HTTP_PORT}`);
      logger.log(`  MCP Port: ${PROXY_CONFIG.MCP_PORT}`);
      logger.log(`  Tools: ${this.tools.length}`);
      logger.log(`  Resources: ${this.resources.length}`);
      
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }
  
  /**
   * Setup graceful shutdown handlers for process signals.
   * 
   * @function setupShutdownHandlers
   * @private
   */
  setupShutdownHandlers() {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach(signal => {
      const handler = async () => {
        logger.log(`\nReceived ${signal}, shutting down proxy server gracefully...`);
        await this.stop();
        process.exit(0);
      };
      
      process.on(signal, handler);
      this.shutdownHandlers.push({ signal, handler });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception:', error);
      await this.stop();
      process.exit(1);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      await this.stop();
      process.exit(1);
    });
  }
  
  /**
   * Stop the proxy server and clean up resources.
   * 
   * @async
   * @function stop
   * @returns {Promise<void>} Resolves when server is stopped
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    logger.log('Stopping proxy server...');
    
    try {
      await this.cleanup();
      this.isRunning = false;
      logger.log('Proxy server stopped successfully');
    } catch (error) {
      logger.error('Error during proxy server shutdown:', error);
    }
  }
  
  /**
   * Clean up all server resources.
   * 
   * @async
   * @function cleanup
   * @returns {Promise<void>} Resolves when cleanup is complete
   * @private
   */
  async cleanup() {
    const cleanupPromises = [];
    
    // Close HTTP server
    if (this.httpServer) {
      cleanupPromises.push(
        this.httpServer.close().catch(error => 
          logger.error('Error closing HTTP server:', error)
        )
      );
      this.httpServer = null;
    }
    
    // Shutdown MCP handler
    if (this.mcpHandler) {
      cleanupPromises.push(
        this.mcpHandler.shutdown().catch(error => 
          logger.error('Error shutting down MCP handler:', error)
        )
      );
      this.mcpHandler = null;
    }
    
    // Remove shutdown handlers
    this.shutdownHandlers.forEach(({ signal, handler }) => {
      process.removeListener(signal, handler);
    });
    this.shutdownHandlers = [];
    
    // Wait for all cleanup to complete
    await Promise.all(cleanupPromises);
  }
  
  /**
   * Get proxy server status information.
   * 
   * @function getStatus
   * @returns {Object} Server status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      ports: {
        http: PROXY_CONFIG.HTTP_PORT,
        mcp: PROXY_CONFIG.MCP_PORT
      },
      tools: this.tools.length,
      resources: this.resources.length,
      mcpHandler: this.mcpHandler ? this.mcpHandler.getHealthInfo() : null
    };
  }
}

/**
 * Factory function to create and start a proxy server.
 * 
 * @async
 * @function createProxyServer
 * @param {Object} options - Proxy server configuration
 * @param {Array<Object>} options.tools - Array of tool objects
 * @param {Array<Object>} options.resources - Array of resource objects
 * @param {Object} options.serverConfig - Server configuration
 * @returns {Promise<ProxyServer>} Started proxy server instance
 * 
 * @example
 * const proxy = new ProxyServer({
 *   tools: [navigateTool, clickTool],
 *   resources: [pageResource],
 *   serverConfig: { name: 'My Proxy', version: '1.0.0' }
 * });
 * const result = await proxy.start();
 * logger.log(`Proxy server status: ${result.status}`);
 */
export async function createProxyServer(options) {
  const proxy = new ProxyServer(options);
  await proxy.start();
  return proxy;
}

/**
 * Check if a proxy server is already running and healthy.
 * 
 * @async
 * @function isProxyRunning
 * @returns {Promise<boolean>} True if proxy is running and healthy
 * 
 * @example
 * const running = await isProxyRunning();
 * if (running) {
 *   console.log('Proxy server is already running');
 * }
 */
export async function isProxyRunning() {
  const detection = await detectExistingProxy();
  return detection.exists && detection.healthy;
}

/**
 * Get proxy server configuration.
 * 
 * @function getProxyConfig
 * @returns {Object} Proxy configuration
 */
export function getProxyConfig() {
  return {
    ...PROXY_CONFIG,
    endpoints: {
      health: `http://localhost:${PROXY_CONFIG.HTTP_PORT}/health`,
      tool: `http://localhost:${PROXY_CONFIG.HTTP_PORT}/tool`,
      tools: `http://localhost:${PROXY_CONFIG.HTTP_PORT}/tools`
    }
  };
} 