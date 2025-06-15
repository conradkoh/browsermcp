/**
 * Proxy Server Detection Utilities
 * 
 * This module provides utilities for detecting existing proxy servers
 * and managing proxy server lifecycle in a peer-to-peer architecture.
 * 
 * Key responsibilities:
 * - Check if ports 9008 and 9009 are already in use
 * - Attempt health check connections to existing proxies
 * - Provide graceful fallback mechanisms
 * - Handle proxy server conflicts
 * 
 * @fileoverview Proxy server detection and management utilities
 */

import { createConnection } from 'net';
import http from 'http';

/**
 * Configuration for proxy server ports and detection
 */
export const PROXY_CONFIG = {
  HTTP_PORT: 9008,    // HTTP API port for tool calls
  MCP_PORT: 9009,     // MCP protocol port for browser communication
  HEALTH_TIMEOUT: 2000, // Health check timeout in milliseconds
  CONNECTION_TIMEOUT: 1000, // Port check timeout in milliseconds
};

/**
 * Check if a specific port is in use by attempting to connect to it.
 * 
 * @async
 * @function isPortInUse
 * @param {number} port - Port number to check
 * @param {string} [host='localhost'] - Host to check (defaults to localhost)
 * @returns {Promise<boolean>} True if port is in use, false otherwise
 * 
 * @example
 * const inUse = await isPortInUse(9008);
 * if (inUse) {
 *   console.log('Port 9008 is already in use');
 * }
 */
export async function isPortInUse(port, host = 'localhost') {
  return new Promise((resolve) => {
    const connection = createConnection({ port, host });
    
    // Set timeout for connection attempt
    const timeout = setTimeout(() => {
      connection.destroy();
      resolve(false); // Port is not in use if connection times out
    }, PROXY_CONFIG.CONNECTION_TIMEOUT);
    
    connection.on('connect', () => {
      clearTimeout(timeout);
      connection.destroy();
      resolve(true); // Port is in use if connection succeeds
    });
    
    connection.on('error', () => {
      clearTimeout(timeout);
      resolve(false); // Port is not in use if connection fails
    });
  });
}

/**
 * Perform health check on existing proxy server.
 * Attempts to connect to the HTTP API and verify it's responding correctly.
 * 
 * @async
 * @function checkProxyHealth
 * @param {number} [port=9008] - HTTP API port to check
 * @returns {Promise<boolean>} True if proxy is healthy, false otherwise
 * 
 * @example
 * const healthy = await checkProxyHealth();
 * if (healthy) {
 *   console.log('Existing proxy server is healthy');
 * }
 */
export async function checkProxyHealth(port = PROXY_CONFIG.HTTP_PORT) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path: '/health',
      method: 'GET',
      timeout: PROXY_CONFIG.HEALTH_TIMEOUT,
    }, (res) => {
      // Consider proxy healthy if it responds with any status
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    
    req.on('error', () => {
      resolve(false); // Proxy is not healthy if request fails
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve(false); // Proxy is not healthy if request times out
    });
    
    req.end();
  });
}

/**
 * Comprehensive proxy detection that checks both ports and health.
 * This is the main function to determine if a proxy server is already running.
 * 
 * @async
 * @function detectExistingProxy
 * @returns {Promise<Object>} Detection result with status and details
 * @returns {boolean} returns.exists - Whether a proxy server exists
 * @returns {boolean} returns.healthy - Whether the existing proxy is healthy
 * @returns {Object} returns.ports - Port usage status
 * @returns {boolean} returns.ports.http - Whether HTTP port (9008) is in use
 * @returns {boolean} returns.ports.mcp - Whether MCP port (9009) is in use
 * 
 * @example
 * const detection = await detectExistingProxy();
 * if (detection.exists && detection.healthy) {
 *   console.log('Using existing healthy proxy server');
 * } else if (detection.exists && !detection.healthy) {
 *   console.log('Existing proxy found but unhealthy');
 * } else {
 *   console.log('No existing proxy found, starting new one');
 * }
 */
export async function detectExistingProxy() {
  // Check both ports in parallel
  const [httpPortInUse, mcpPortInUse] = await Promise.all([
    isPortInUse(PROXY_CONFIG.HTTP_PORT),
    isPortInUse(PROXY_CONFIG.MCP_PORT),
  ]);
  
  const ports = {
    http: httpPortInUse,
    mcp: mcpPortInUse,
  };
  
  // If HTTP port is in use, check if it's a healthy proxy
  let healthy = false;
  if (httpPortInUse) {
    healthy = await checkProxyHealth();
  }
  
  return {
    exists: httpPortInUse || mcpPortInUse,
    healthy,
    ports,
  };
}

/**
 * Wait for proxy server to become available.
 * Useful for coordinating startup between multiple instances.
 * 
 * @async
 * @function waitForProxy
 * @param {number} [maxWaitMs=10000] - Maximum time to wait in milliseconds
 * @param {number} [checkIntervalMs=500] - Interval between checks in milliseconds
 * @returns {Promise<boolean>} True if proxy becomes available, false if timeout
 * 
 * @example
 * const available = await waitForProxy(5000);
 * if (available) {
 *   console.log('Proxy server is now available');
 * } else {
 *   console.log('Timeout waiting for proxy server');
 * }
 */
export async function waitForProxy(maxWaitMs = 10000, checkIntervalMs = 500) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const detection = await detectExistingProxy();
    if (detection.exists && detection.healthy) {
      return true;
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }
  
  return false;
}

/**
 * Get next available ports if default ports are in use.
 * Useful for handling port conflicts gracefully.
 * 
 * @async
 * @function getAvailablePorts
 * @param {number} [startHttpPort=9010] - Starting port to check for HTTP API
 * @param {number} [startMcpPort=9011] - Starting port to check for MCP protocol
 * @returns {Promise<Object>} Available ports
 * @returns {number} returns.httpPort - Available HTTP API port
 * @returns {number} returns.mcpPort - Available MCP protocol port
 * 
 * @example
 * const ports = await getAvailablePorts();
 * console.log(`Using HTTP port: ${ports.httpPort}, MCP port: ${ports.mcpPort}`);
 */
export async function getAvailablePorts(startHttpPort = 9010, startMcpPort = 9011) {
  let httpPort = startHttpPort;
  let mcpPort = startMcpPort;
  
  // Find available HTTP port
  while (await isPortInUse(httpPort)) {
    httpPort++;
  }
  
  // Find available MCP port (ensure it's different from HTTP port)
  while (await isPortInUse(mcpPort) || mcpPort === httpPort) {
    mcpPort++;
  }
  
  return { httpPort, mcpPort };
} 