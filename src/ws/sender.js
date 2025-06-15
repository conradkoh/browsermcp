/**
 * WebSocket Message Sender
 * 
 * This file provides utilities for sending messages over WebSocket connections
 * with timeout handling, response correlation, and error management. It implements
 * a request-response pattern over WebSocket for reliable communication with the
 * browser extension.
 * 
 * Key features:
 * - Request-response correlation using unique IDs
 * - Configurable timeouts with automatic cleanup
 * - Comprehensive error handling and connection state checking
 * - Event listener management to prevent memory leaks
 * 
 * @fileoverview WebSocket message sending utilities with timeout and error handling
 */

import { WebSocket } from 'ws';
import { MESSAGE_RESPONSE_TYPE } from './types.js';

/**
 * Creates a message sender function for a specific WebSocket connection.
 * This factory function returns an object with a sendSocketMessage method
 * that can be used to send messages and wait for responses with timeout handling.
 * 
 * @function createSocketMessageSender
 * @param {WebSocket} ws - The WebSocket connection to use for sending messages
 * @returns {Object} Object containing the sendSocketMessage function
 * 
 * @example
 * const { sendSocketMessage } = createSocketMessageSender(websocket);
 * const result = await sendSocketMessage('browser_click', { element: 'button' });
 */
export function createSocketMessageSender(ws) {
  /**
   * Sends a message over the WebSocket connection and waits for a response.
   * This function implements a request-response pattern with timeout handling
   * and automatic cleanup of event listeners.
   * 
   * @async
   * @function sendSocketMessage
   * @param {string} type - The message type identifier
   * @param {*} payload - The message payload data
   * @param {Object} [options={ timeoutMs: 30000 }] - Configuration options
   * @param {number} [options.timeoutMs=30000] - Timeout in milliseconds
   * @returns {Promise<*>} Promise that resolves with the response data
   * @throws {Error} Throws error on timeout, connection issues, or server errors
   * 
   * @example
   * // Send a simple message
   * const result = await sendSocketMessage('getUrl', undefined);
   * 
   * @example
   * // Send with custom timeout
   * const result = await sendSocketMessage('browser_click', 
   *   { element: 'button' }, 
   *   { timeoutMs: 10000 }
   * );
   */
  async function sendSocketMessage(
    type,
    payload,
    options = { timeoutMs: 30000 }
  ) {
    const { timeoutMs } = options;
    const id = generateId();
    const message = { id, type, payload };
    
    return new Promise((resolve, reject) => {
      /**
       * Cleanup function that removes all event listeners and clears timeout.
       * This prevents memory leaks and ensures proper resource cleanup.
       */
      const cleanup = () => {
        removeSocketMessageResponseListener();
        ws.removeEventListener('error', errorHandler);
        ws.removeEventListener('close', cleanup);
        clearTimeout(timeoutId);
      };
      
      let timeoutId;
      
      // Set up timeout if specified
      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error(`WebSocket response timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      
      /**
       * Set up response listener that correlates responses with requests
       * using the unique message ID.
       */
      const removeSocketMessageResponseListener =
        addSocketMessageResponseListener(ws, (responseMessage) => {
          const { payload: responsePayload } = responseMessage;
          
          // Only handle responses for our specific request
          if (responsePayload.requestId !== id) {
            return;
          }
          
          const { result, error } = responsePayload;
          if (error) {
            reject(new Error(error));
          } else {
            resolve(result);
          }
          cleanup();
        });
      
      /**
       * Error handler for WebSocket connection errors.
       */
      const errorHandler = (_event) => {
        cleanup();
        reject(new Error('WebSocket error occurred'));
      };
      
      // Set up event listeners
      ws.addEventListener('error', errorHandler);
      ws.addEventListener('close', cleanup);
      
      // Send the message if connection is open
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        cleanup();
        reject(new Error('WebSocket is not open'));
      }
    });
  }
  
  return { sendSocketMessage };
}

/**
 * Adds a listener for WebSocket response messages of a specific type.
 * This function filters incoming messages and only calls the listener
 * for messages that match the expected response type.
 * 
 * @function addSocketMessageResponseListener
 * @param {WebSocket} ws - The WebSocket connection to listen on
 * @param {Function} typeListener - Callback function to handle response messages
 * @returns {Function} Function to remove the event listener
 * 
 * @example
 * const removeListener = addSocketMessageResponseListener(ws, (message) => {
 *   console.log('Received response:', message);
 * });
 * 
 * // Later, remove the listener
 * removeListener();
 */
export function addSocketMessageResponseListener(ws, typeListener) {
  /**
   * Internal message handler that filters messages by type.
   * Only processes messages with the MESSAGE_RESPONSE_TYPE.
   */
  const listener = async (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.type !== MESSAGE_RESPONSE_TYPE) {
      return;
    }
    await typeListener(message);
  };
  
  ws.addEventListener('message', listener);
  
  // Return cleanup function
  return () => ws.removeEventListener('message', listener);
}

/**
 * Generates a unique identifier for message correlation.
 * Uses crypto.randomUUID() if available (Node.js 14.17+), otherwise
 * falls back to a timestamp-based approach for compatibility.
 * 
 * @function generateId
 * @returns {string} A unique identifier string
 * 
 * @example
 * const messageId = generateId();
 * // Returns something like: "1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p"
 * // or "1234567890abc-def123456" (fallback format)
 */
function generateId() {
  // Use crypto.randomUUID if available (Node.js 14.17+)
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  
  // Fallback to timestamp + random string for older Node.js versions
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomStr}`;
} 