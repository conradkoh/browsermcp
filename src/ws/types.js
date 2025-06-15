/**
 * WebSocket Message Types
 * 
 * This file defines constants for WebSocket message types used in communication
 * between the MCP server and the browser extension. These constants ensure
 * consistent message type identification across the application.
 * 
 * @fileoverview WebSocket message type constants
 */

/**
 * Message type identifier for WebSocket response messages.
 * This constant is used to identify response messages in the WebSocket
 * communication protocol between the MCP server and browser extension.
 * 
 * When the server sends a request to the browser extension, the extension
 * responds with a message that has this type to indicate it's a response
 * to a previous request.
 * 
 * @type {string}
 * @constant
 * @example
 * // Check if incoming message is a response
 * if (message.type === MESSAGE_RESPONSE_TYPE) {
 *   handleResponse(message);
 * }
 * 
 * @example
 * // Send a response message
 * const responseMessage = {
 *   type: MESSAGE_RESPONSE_TYPE,
 *   payload: { requestId: originalRequestId, result: data }
 * };
 */
export const MESSAGE_RESPONSE_TYPE = 'messageResponse'; 