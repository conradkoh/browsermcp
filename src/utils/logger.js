/**
 * Logging Utility
 * 
 * This file provides a comprehensive logging system that writes to temporary files
 * while avoiding console.log (which is reserved for MCP communication). The logger
 * handles different log levels, provides structured logging with context, and
 * manages log file lifecycle.
 * 
 * Key features:
 * - Writes to temporary files to avoid interfering with MCP protocol
 * - Supports structured logging with context objects
 * - Handles crash reporting with stack traces
 * - Provides both file-only and file+stderr logging modes
 * 
 * @fileoverview Comprehensive logging system for Browser MCP server
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Logger class that provides structured logging capabilities with file output.
 * Designed to avoid console.log which interferes with MCP protocol communication.
 * 
 * The logger creates a unique temporary file for each server instance and provides
 * methods for different log levels (log, error, crash) with optional context objects.
 * 
 * @class Logger
 */
class Logger {
  /**
   * Creates a new Logger instance and initializes the log file.
   * The log file is created in the system's temporary directory with a unique
   * name based on timestamp and process ID to avoid conflicts.
   * 
   * @constructor
   */
  constructor() {
    // Create temp file for logging
    const tempDir = os.tmpdir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    /**
     * Path to the log file for this logger instance.
     * Format: browsermcp-{timestamp}-{pid}.log
     * 
     * @type {string}
     * @private
     */
    this.logFile = path.join(
      tempDir,
      `browsermcp-${timestamp}-${process.pid}.log`
    );

    // Initialize log file with header information
    try {
      fs.writeFileSync(
        this.logFile,
        `Browser MCP Server Log - Started at ${new Date().toISOString()}\n`
      );
      fs.writeFileSync(this.logFile, `Process ID: ${process.pid}\n`, {
        flag: 'a',
      });
      fs.writeFileSync(this.logFile, `Log file: ${this.logFile}\n\n`, {
        flag: 'a',
      });
    } catch (error) {
      console.error('Failed to initialize log file:', error.message);
    }
  }

  /**
   * Logs a message with optional context to the log file only.
   * This is the primary logging method for general application events.
   * Does not write to console to avoid interfering with MCP protocol.
   * 
   * @method log
   * @param {string} message - The main log message
   * @param {Object} [context={}] - Optional context object with additional data
   * 
   * @example
   * logger.log('Server started successfully');
   * logger.log('User action completed', { userId: 123, action: 'click' });
   */
  log(message, context = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}${
      context && Object.keys(context).length > 0
        ? ' ' + JSON.stringify(context, null, 2)
        : ''
    }\n`;

    try {
      fs.writeFileSync(this.logFile, logEntry, { flag: 'a' });
    } catch (error) {
      // If we can't write to log file, fall back to stderr
      console.error('Failed to write to log file:', error.message);
      console.error('Original message:', message);
    }
  }

  /**
   * Logs an error message to both the log file and stderr.
   * Used for errors that should be visible to users/administrators
   * while still maintaining a permanent record in the log file.
   * 
   * @method error
   * @param {string} message - The error message
   * @param {Object} [context={}] - Optional context object with error details
   * 
   * @example
   * logger.error('Failed to connect to database');
   * logger.error('Validation failed', { field: 'email', value: 'invalid' });
   */
  error(message, context = {}) {
    // Log to temp file with ERROR prefix
    this.log(`ERROR: ${message}`, context);

    // Also log to stderr for immediate visibility
    console.error(message);
    if (context && Object.keys(context).length > 0) {
      console.error('Error context:', context);
    }
  }

  /**
   * Returns the path to the current log file.
   * Useful for displaying log file location to users or for log rotation.
   * 
   * @method getLogFilePath
   * @returns {string} The absolute path to the log file
   * 
   * @example
   * console.log(`Logs available at: ${logger.getLogFilePath()}`);
   */
  getLogFilePath() {
    return this.logFile;
  }

  /**
   * Logs critical crash information and outputs log file path to stderr.
   * This method is used for unrecoverable errors that will cause the
   * application to exit. It ensures crash details are preserved and
   * users know where to find the full logs.
   * 
   * @method crash
   * @param {string} message - Description of the crash
   * @param {Error} [error] - Optional Error object with stack trace
   * 
   * @example
   * logger.crash('Unhandled exception occurred', error);
   * logger.crash('Critical system failure');
   */
  crash(message, error) {
    const crashInfo = {
      message,
      error: error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : undefined,
      timestamp: new Date().toISOString(),
      processId: process.pid,
    };

    // Log crash details to temp file with CRASH prefix
    this.log(`CRASH: ${message}`, crashInfo);

    // Output to stderr for immediate visibility
    console.error(`FATAL ERROR: ${message}`);
    if (error) {
      console.error('Error details:', error.message);
    }
    console.error(`Full logs available at: ${this.logFile}`);
  }
}

/**
 * Global logger instance used throughout the application.
 * This singleton ensures all logging goes to the same file and
 * provides a consistent logging interface across modules.
 * 
 * @type {Logger}
 * @example
 * import { logger } from './utils/logger.js';
 * logger.log('Application started');
 */
export const logger = new Logger(); 