/**
 * General Utility Functions
 * 
 * This file contains commonly used utility functions that are shared across
 * the application. These are pure functions that don't depend on application
 * state and can be used in any context.
 * 
 * @fileoverview General purpose utility functions
 */

/**
 * Creates a Promise that resolves after a specified number of milliseconds.
 * This is useful for adding delays in async operations, implementing retry
 * logic with backoff, or creating timeouts.
 * 
 * @async
 * @function wait
 * @param {number} ms - The number of milliseconds to wait before resolving
 * @returns {Promise<undefined>} A Promise that resolves to undefined after the specified delay
 * 
 * @example
 * // Wait for 1 second
 * await wait(1000);
 * 
 * @example
 * // Use in retry logic
 * for (let i = 0; i < 3; i++) {
 *   try {
 *     await someOperation();
 *     break;
 *   } catch (error) {
 *     if (i < 2) await wait(1000 * (i + 1)); // Exponential backoff
 *   }
 * }
 */
export async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(undefined), ms);
  });
} 