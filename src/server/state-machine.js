/**
 * Server State Machine for Robust Lifecycle Management
 * 
 * This file implements a finite state machine (FSM) for managing the MCP server
 * lifecycle with explicit state transitions, comprehensive error handling, and
 * graceful shutdown procedures. The state machine ensures reliable server
 * operation with automatic recovery from transient failures.
 * 
 * Key Features:
 * - Explicit state management with validation
 * - Automatic retry logic with exponential backoff
 * - Comprehensive error handling and recovery
 * - Graceful shutdown with resource cleanup
 * - State history tracking for debugging
 * - Signal handling for process management
 * 
 * @fileoverview Finite state machine for MCP server lifecycle management
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { wait } from '../utils/index.js';
import { logger } from '../utils/logger.js';

/**
 * ServerStateMachine manages the lifecycle of the MCP server with explicit state transitions.
 *
 * **States:**
 * - **INITIALIZING**: Initial state, transitions to CREATING_SERVER
 * - **CREATING_SERVER**: Attempting to create server instance
 * - **RETRYING_SERVER_CREATION**: Waiting before retrying server creation
 * - **CONNECTING**: Attempting to connect server to transport
 * - **RETRYING_CONNECTION**: Waiting before retrying connection
 * - **CONNECTED**: Successfully connected and running
 * - **RECONNECTING**: Connection lost, attempting to reconnect
 * - **RESTARTING**: Max connection retries exceeded, full restart
 * - **SHUTTING_DOWN**: Graceful shutdown in progress
 * - **SHUTDOWN**: Shutdown complete
 * - **FAILED**: Permanent failure, will exit
 *
 * **State Transitions:**
 * ```
 * INITIALIZING -> CREATING_SERVER
 * CREATING_SERVER -> CONNECTING (success) | RETRYING_SERVER_CREATION (failure)
 * RETRYING_SERVER_CREATION -> CREATING_SERVER (after delay)
 * CONNECTING -> CONNECTED (success) | RETRYING_CONNECTION (failure)
 * RETRYING_CONNECTION -> CONNECTING (after delay) | RESTARTING (max retries)
 * CONNECTED -> RECONNECTING (connection lost) | SHUTTING_DOWN (exit signal)
 * RECONNECTING -> CREATING_SERVER
 * RESTARTING -> CREATING_SERVER
 * SHUTTING_DOWN -> SHUTDOWN
 * Any state -> FAILED (permanent error)
 * ```
 *
 * **Benefits of this FSM approach:**
 * 1. **Clear separation of concerns** - each state has a single responsibility
 * 2. **Predictable error handling** - errors are handled based on current state
 * 3. **Proper resource cleanup** - resources are cleaned up at appropriate state transitions
 * 4. **Debuggability** - state history and current state are tracked
 * 5. **Maintainability** - adding new states or transitions is straightforward
 * 6. **Reliability** - prevents race conditions and ensures proper shutdown
 * 
 * @class ServerStateMachine
 * 
 * @example
 * // Create and run state machine
 * const stateMachine = new ServerStateMachine({
 *   createServer: () => createServerWithTools(config),
 *   maxRetries: 3,
 *   retryDelay: 5000
 * });
 * await stateMachine.run();
 * 
 * @example
 * // Monitor state machine status
 * const info = stateMachine.getStateInfo();
 * console.log(`Current state: ${info.currentState}`);
 * console.log(`Retry count: ${info.retryCount}/${info.maxRetries}`);
 */
export class ServerStateMachine {
  /**
   * Creates a new ServerStateMachine instance with configuration options.
   * 
   * @constructor
   * @param {Object} [config={}] - Configuration options for the state machine
   * @param {Function} config.createServer - Function that creates and returns a server instance
   * @param {number} [config.maxRetries=3] - Maximum number of retry attempts before giving up
   * @param {number} [config.retryDelay=5000] - Delay in milliseconds between retry attempts
   * @param {number} [config.maxStateHistory=100] - Maximum number of state transitions to keep in history
   */
  constructor(config = {}) {
    /** @type {string} Current state of the state machine */
    this.state = 'INITIALIZING';
    
    /** @type {Object|null} Current MCP server instance */
    this.server = null;
    
    /** @type {Object|null} Current transport instance for MCP communication */
    this.transport = null;
    
    /** @type {number} Current retry attempt count */
    this.retryCount = 0;
    
    // Configuration options with defaults
    /** @type {number} Maximum retry attempts before permanent failure */
    this.maxRetries = config.maxRetries || 3;
    
    /** @type {number} Delay between retry attempts in milliseconds */
    this.retryDelay = config.retryDelay || 5000;
    
    /** @type {number} Maximum state history entries to maintain */
    this.maxStateHistory = config.maxStateHistory || 100;
    
    /** @type {boolean} Flag indicating if shutdown is in progress */
    this.isShuttingDown = false;
    
    /** @type {Array<Object>} History of state transitions for debugging */
    this.stateHistory = [];
    
    /** @type {Function} Factory function for creating server instances */
    this.createServer = config.createServer;

    /**
     * Valid state transitions map for validation.
     * Each key represents a state, and the value is an array of valid next states.
     * @type {Object<string, string[]>}
     */
    this.validTransitions = {
      'INITIALIZING': ['CREATING_SERVER'],
      'CREATING_SERVER': ['CONNECTING', 'RETRYING_SERVER_CREATION', 'FAILED'],
      'RETRYING_SERVER_CREATION': ['CREATING_SERVER'],
      'CONNECTING': ['CONNECTED', 'RETRYING_CONNECTION', 'FAILED'],
      'RETRYING_CONNECTION': ['CONNECTING', 'RESTARTING'],
      'CONNECTED': ['RECONNECTING', 'SHUTTING_DOWN'],
      'RECONNECTING': ['CREATING_SERVER'],
      'RESTARTING': ['CREATING_SERVER'],
      'SHUTTING_DOWN': ['SHUTDOWN'],
      'SHUTDOWN': [],
      'FAILED': [],
    };

    // Bind methods to preserve 'this' context for event handlers
    this.transition = this.transition.bind(this);
    this.handleError = this.handleError.bind(this);
    this.cleanup = this.cleanup.bind(this);
  }

  /**
   * Performs a state transition with validation, logging, and history tracking.
   * This method ensures all state changes are properly recorded and validated
   * against the allowed transition rules.
   * 
   * @method transition
   * @param {string} newState - The target state to transition to
   * @param {Object} [context={}] - Additional context information for the transition
   * 
   * @example
   * // Transition to connected state with context
   * this.transition('CONNECTED', { 
   *   connectionTime: Date.now(),
   *   serverPort: 9009 
   * });
   */
  transition(newState, context = {}) {
    const previousState = this.state;

    // Validate transition against allowed transitions
    if (!this.validTransitions[previousState]?.includes(newState)) {
      logger.error(`Invalid state transition: ${previousState} -> ${newState}`);
      // Allow it but log the warning for debugging
    }

    // Maintain state history with size limit to prevent memory leaks
    if (this.stateHistory.length >= this.maxStateHistory) {
      this.stateHistory.shift(); // Remove oldest entry
    }

    // Record transition in history with full context
    this.stateHistory.push({
      from: previousState,
      to: newState,
      timestamp: new Date().toISOString(),
      context,
      retryCount: this.retryCount,
    });

    // Update current state
    this.state = newState;
    logger.log(`State transition: ${previousState} -> ${newState}`, context);

    // Reset retry count on successful connection
    if (newState === 'CONNECTED') {
      this.retryCount = 0;
    }
  }

  /**
   * Centralized error handling with state-aware recovery logic.
   * This method determines the appropriate recovery action based on the
   * current state and error context, implementing retry logic and
   * escalation strategies.
   * 
   * @async
   * @method handleError
   * @param {Error} error - The error that occurred
   * @param {string} currentOperation - Description of the operation that failed
   * 
   * @example
   * // Handle server creation error
   * try {
   *   this.server = await this.createServer();
   * } catch (error) {
   *   await this.handleError(error, 'server creation');
   * }
   */
  async handleError(error, currentOperation) {
    const errorContext = {
      message: error.message,
      stack: error.stack,
      operation: currentOperation,
      timestamp: new Date().toISOString(),
      currentRetryCount: this.retryCount,
    };

    logger.error(`Error in ${currentOperation}:`, errorContext);

    // If already shutting down, transition to shutdown immediately
    if (this.isShuttingDown) {
      this.transition('SHUTDOWN', {
        reason: 'Error during shutdown',
        errorContext,
      });
      return;
    }

    // State-specific error handling with retry logic
    switch (this.state) {
      case 'CREATING_SERVER':
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          this.transition('RETRYING_SERVER_CREATION', {
            attempt: this.retryCount,
            maxRetries: this.maxRetries,
            errorContext,
          });
        } else {
          this.transition('FAILED', {
            reason: 'Max server creation retries exceeded',
            errorContext,
          });
        }
        break;

      case 'CONNECTING':
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          this.transition('RETRYING_CONNECTION', {
            attempt: this.retryCount,
            maxRetries: this.maxRetries,
            errorContext,
          });
        } else {
          this.transition('RESTARTING', {
            reason: 'Max connection retries exceeded',
            errorContext,
          });
        }
        break;

      case 'CONNECTED':
        // Reset retry count when transitioning from CONNECTED to handle new connection issues
        this.retryCount = 0;
        this.transition('RECONNECTING', {
          reason: 'Connection lost',
          errorContext,
        });
        break;

      default:
        // Unexpected error in any other state leads to permanent failure
        this.transition('FAILED', {
          reason: `Unexpected error in state ${this.state}`,
          errorContext,
        });
    }
  }

  /**
   * Cleans up resources based on current state.
   * This method ensures proper resource cleanup including server shutdown
   * and transport cleanup to prevent resource leaks.
   * 
   * @async
   * @method cleanup
   * 
   * @example
   * // Clean up resources during shutdown
   * await this.cleanup();
   */
  async cleanup() {
    logger.log(`Cleaning up resources in state: ${this.state}`);

    // Close server if it exists
    try {
      if (this.server) {
        await this.server.close();
        this.server = null;
      }
    } catch (error) {
      logger.error('Error closing server:', { error: error.message });
    }

    // Clear transport reference
    this.transport = null;
  }

  /**
   * Sets up exit handlers with state machine integration.
   * This method configures signal handlers for graceful shutdown and
   * error handling for uncaught exceptions and unhandled rejections.
   * 
   * @method setupExitWatchdog
   * 
   * @example
   * // Setup is called automatically in run() method
   * this.setupExitWatchdog();
   */
  setupExitWatchdog() {
    /**
     * Graceful shutdown handler for various exit signals.
     * Ensures proper cleanup and state transition during shutdown.
     * 
     * @async
     * @param {string} signal - The signal that triggered the shutdown
     */
    const gracefulShutdown = async (signal) => {
      if (this.isShuttingDown) {
        logger.log(`Already shutting down, ignoring ${signal}`);
        return;
      }

      this.isShuttingDown = true;
      this.transition('SHUTTING_DOWN', { signal });

      try {
        await this.cleanup();
        this.transition('SHUTDOWN', { signal });
        logger.log('Server closed successfully');
        logger.error(
          `Exiting. Full logs available at: ${logger.getLogFilePath()}`
        );
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', {
          error: error.message,
          stack: error.stack,
        });
        logger.error(
          `Exiting with error. Full logs available at: ${logger.getLogFilePath()}`
        );
        process.exit(1);
      }
    };

    // Handle various exit signals for graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

    // Handle stdin close (parent process termination)
    process.stdin.on('close', async () => {
      if (!this.isShuttingDown) {
        logger.log('stdin closed, shutting down...');
        // Set timeout to prevent hanging
        setTimeout(() => {
          logger.log('Forced exit after timeout');
          logger.error(
            `Forced exit after timeout. Full logs available at: ${logger.getLogFilePath()}`
          );
          process.exit(0);
        }, 15000);
        await gracefulShutdown('stdin close');
      }
    });

    // Handle uncaught exceptions with crash logging
    process.on('uncaughtException', (error) => {
      logger.crash('Uncaught exception', error);
      if (!this.isShuttingDown) {
        gracefulShutdown('uncaughtException');
      }
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.crash(
        'Unhandled rejection',
        new Error(`Unhandled rejection at: ${promise}, reason: ${reason}`)
      );
      if (!this.isShuttingDown) {
        gracefulShutdown('unhandledRejection');
      }
    });
  }

  /**
   * Main state machine execution loop.
   * This method runs the state machine, handling state transitions and
   * executing state-specific logic until shutdown or failure.
   * 
   * @async
   * @method run
   * 
   * @example
   * // Start the state machine
   * const stateMachine = new ServerStateMachine(config);
   * await stateMachine.run();
   */
  async run() {
    // Set up signal handlers and error handling
    this.setupExitWatchdog();

    // Main execution loop - continues until shutdown
    while (!this.isShuttingDown) {
      try {
        switch (this.state) {
          case 'INITIALIZING':
            // Initial state - immediately transition to server creation
            this.transition('CREATING_SERVER');
            break;

          case 'CREATING_SERVER':
            // Attempt to create server instance
            try {
              this.server = await this.createServer();
              this.transition('CONNECTING');
            } catch (error) {
              await this.handleError(error, 'server creation');
            }
            break;

          case 'RETRYING_SERVER_CREATION':
            // Wait before retrying server creation
            logger.log(
              `Retrying server creation in ${this.retryDelay}ms (attempt ${this.retryCount}/${this.maxRetries})`
            );
            await wait(this.retryDelay);
            this.transition('CREATING_SERVER');
            break;

          case 'CONNECTING':
            // Attempt to connect server to transport
            try {
              if (!this.server) {
                throw new Error('Server not initialized');
              }
              this.transport = new StdioServerTransport();
              await this.server.connect(this.transport);
              this.transition('CONNECTED');
            } catch (error) {
              await this.handleError(error, 'connection');
            }
            break;

          case 'RETRYING_CONNECTION':
            // Wait before retrying connection
            logger.log(
              `Retrying connection in ${this.retryDelay}ms (attempt ${this.retryCount}/${this.maxRetries})`
            );
            await wait(this.retryDelay);
            this.transition('CONNECTING');
            break;

          case 'CONNECTED':
            // Successfully connected - wait for external events
            logger.log('Server connected successfully. Running...');
            // Use event-driven approach instead of polling for efficiency
            await new Promise((resolve) => {
              /**
               * Handler to check for state changes that require action.
               * Monitors for shutdown signals or state changes.
               */
              const stateChangeHandler = () => {
                if (this.isShuttingDown || this.state !== 'CONNECTED') {
                  resolve(undefined);
                }
              };

              // Check every 5 seconds to reduce CPU usage
              const intervalId = setInterval(stateChangeHandler, 5000);

              // Initial check
              stateChangeHandler();

              // Cleanup interval when promise resolves
              const originalResolve = resolve;
              resolve = (value) => {
                clearInterval(intervalId);
                originalResolve(value);
              };
            });
            break;

          case 'RECONNECTING':
            // Connection lost - clean up and restart server creation
            logger.log('Attempting to reconnect...');
            await this.cleanup();
            this.retryCount = 0;
            this.transition('CREATING_SERVER');
            break;

          case 'RESTARTING':
            // Max connection retries reached - full restart
            logger.log('Max connection retries reached. Restarting server...');
            await this.cleanup();
            this.retryCount = 0;
            this.transition('CREATING_SERVER');
            break;

          case 'FAILED':
            // Permanent failure - log and exit
            logger.crash('Server failed permanently. Exiting...');
            await this.cleanup();
            process.exit(1);
            break;

          case 'SHUTTING_DOWN':
          case 'SHUTDOWN':
            // These states are handled by the exit watchdog
            return;

          default:
            // Unknown state - transition to failed
            logger.error(`Unknown state: ${this.state}`);
            this.transition('FAILED', { reason: 'Unknown state' });
        }
      } catch (error) {
        // Catch any unexpected errors in the state machine loop
        logger.error('Unexpected error in state machine:', {
          error: error.message,
          stack: error.stack,
        });
        await this.handleError(error, `state ${this.state}`);
      }
    }
  }

  /**
   * Returns current state information for debugging and monitoring.
   * This method provides a snapshot of the state machine's current status
   * including state, retry counts, and recent state history.
   * 
   * @method getStateInfo
   * @returns {Object} Current state information
   * @returns {string} returns.currentState - Current state name
   * @returns {number} returns.retryCount - Current retry attempt count
   * @returns {number} returns.maxRetries - Maximum allowed retries
   * @returns {boolean} returns.isShuttingDown - Whether shutdown is in progress
   * @returns {boolean} returns.hasServer - Whether server instance exists
   * @returns {boolean} returns.hasTransport - Whether transport instance exists
   * @returns {Array<Object>} returns.stateHistory - Recent state transitions (last 10)
   * 
   * @example
   * // Get current state information
   * const info = stateMachine.getStateInfo();
   * console.log(`State: ${info.currentState}`);
   * console.log(`Retries: ${info.retryCount}/${info.maxRetries}`);
   * console.log(`Recent transitions:`, info.stateHistory);
   */
  getStateInfo() {
    return {
      currentState: this.state,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      isShuttingDown: this.isShuttingDown,
      hasServer: !!this.server,
      hasTransport: !!this.transport,
      stateHistory: this.stateHistory.slice(-10), // Last 10 transitions
    };
  }
} 