/**
 * Port Management Utilities
 * 
 * This file provides utilities for managing network ports, including checking
 * port availability and cleaning up processes that may be using required ports.
 * These functions are essential for ensuring the WebSocket server can start
 * cleanly without port conflicts.
 * 
 * Key features:
 * - Cross-platform port availability checking
 * - Graceful and forceful process termination
 * - Protection against self-termination
 * - Comprehensive error handling and logging
 * 
 * @fileoverview Port management and process cleanup utilities
 */

import { execSync } from 'node:child_process';
import net from 'node:net';
import { logger } from './logger.js';

/**
 * Checks if a specific port is currently in use by attempting to bind to it.
 * This is a reliable cross-platform method that works by creating a temporary
 * server and checking if it can successfully listen on the port.
 * 
 * @async
 * @function isPortInUse
 * @param {number} port - The port number to check (1-65535)
 * @returns {Promise<boolean>} True if the port is in use, false if available
 * 
 * @example
 * // Check if port 3000 is available
 * const inUse = await isPortInUse(3000);
 * if (inUse) {
 *   console.log('Port 3000 is already in use');
 * }
 * 
 * @example
 * // Wait for a port to become available
 * while (await isPortInUse(8080)) {
 *   await new Promise(resolve => setTimeout(resolve, 1000));
 * }
 */
export async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    // If there's an error binding to the port, it's in use
    server.once('error', () => resolve(true));
    
    // If we can listen successfully, the port is available
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    
    // Attempt to bind to the port
    server.listen(port);
  });
}

/**
 * Attempts to kill processes using a specific port using platform-specific commands.
 * This function handles both Windows and Unix-like systems (Linux, macOS) and
 * implements graceful shutdown with fallback to forceful termination.
 * 
 * The function includes safety measures to prevent killing the current process
 * and provides detailed logging of all operations.
 * 
 * @function killProcessOnPort
 * @param {number} port - The port number whose processes should be terminated
 * 
 * @example
 * // Clean up port 9009 before starting server
 * killProcessOnPort(9009);
 * 
 * @example
 * // Use in server startup sequence
 * try {
 *   killProcessOnPort(config.port);
 *   await startServer(config.port);
 * } catch (error) {
 *   logger.error('Failed to start server', { error: error.message });
 * }
 */
export function killProcessOnPort(port) {
  try {
    logger.log(`Checking for existing processes on port ${port}...`);
    
    if (process.platform === 'win32') {
      /**
       * Windows-specific process termination using netstat and taskkill.
       * Uses FOR loop to iterate through processes and kill them.
       */
      const result = execSync(
        `FOR /F "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      if (result.trim()) {
        logger.log(`Killed existing process on port ${port}`);
      }
    } else {
      /**
       * Unix-like systems (Linux, macOS) process termination using lsof and kill.
       * Implements graceful shutdown (TERM) with fallback to forceful (KILL).
       */
      
      // Find all process IDs using the specified port
      const pids = execSync(`lsof -ti:${port}`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      
      if (pids) {
        const pidList = pids.split('\n').filter((pid) => pid.trim());
        const currentPid = process.pid.toString();

        // Filter out our own process to avoid self-termination
        const otherPids = pidList.filter((pid) => pid !== currentPid);

        if (otherPids.length > 0) {
          // First attempt: graceful termination with SIGTERM
          try {
            execSync(`kill -TERM ${otherPids.join(' ')}`, { stdio: 'pipe' });
            logger.log(
              `Sent TERM signal to process(es) on port ${port}: ${otherPids.join(
                ', '
              )}`
            );

            // Wait briefly for graceful shutdown
            execSync('sleep 1', { stdio: 'pipe' });

            // Check if any processes are still running
            const stillRunning = execSync(`lsof -ti:${port}`, {
              encoding: 'utf8',
              stdio: 'pipe',
            }).trim();

            if (stillRunning) {
              // Some processes didn't respond to SIGTERM, use SIGKILL
              const stillRunningPids = stillRunning
                .split('\n')
                .filter((pid) => pid.trim() && pid !== currentPid);
              
              if (stillRunningPids.length > 0) {
                execSync(`kill -9 ${stillRunningPids.join(' ')}`, {
                  stdio: 'pipe',
                });
                logger.log(
                  `Force killed remaining process(es) on port ${port}: ${stillRunningPids.join(
                    ', '
                  )}`
                );
              }
            }
          } catch (killError) {
            // If graceful termination fails, go straight to force kill
            execSync(`kill -9 ${otherPids.join(' ')}`, { stdio: 'pipe' });
            logger.log(
              `Force killed process(es) on port ${port}: ${otherPids.join(
                ', '
              )}`
            );
          }
        } else {
          // All found processes are the current process
          logger.log(
            `Process on port ${port} is current process (PID: ${currentPid}), skipping kill`
          );
        }
      } else {
        // No processes found using the port
        logger.log(`No existing processes found on port ${port}`);
      }
    }
  } catch (error) {
    /**
     * Error handling for process termination failures.
     * Exit status 1 is expected when no processes are using the port.
     */
    if (error.status === 1) {
      // This is expected when no process is using the port
      logger.log(`No existing processes found on port ${port}`);
    } else {
      // Unexpected error occurred during process termination
      logger.error(`Failed to kill process on port ${port}:`, {
        error: error.message,
      });
    }
  }
}

/**
 * Finds an available port starting from a given port.
 * @async
 * @function findAvailablePort
 * @param {number} startPort - The port number to start searching from.
 * @returns {Promise<number>} An available port number.
 * @throws {Error} If no available port is found within a reasonable range.
 */
export async function findAvailablePort(startPort) {
  let port = startPort;
  const maxPort = 65535;
  const maxAttempts = 100; // Limit search to 100 ports
  let attempts = 0;

  while (attempts < maxAttempts && port <= maxPort) {
    if (!(await isPortInUse(port))) {
      return port;
    }
    port++;
    attempts++;
  }
  throw new Error(`No available port found in range ${startPort}-${port - 1}`);
} 