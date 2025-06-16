/**
 * ARIA Snapshot Utilities
 * 
 * This file provides utilities for capturing and formatting accessibility tree
 * snapshots from web pages. These snapshots are essential for AI agents to
 * understand page structure and identify interactive elements for automation.
 * 
 * The ARIA snapshot includes:
 * - Page URL and title for context
 * - Accessibility tree in YAML format for readability
 * - Optional status messages for operation feedback
 * 
 * @fileoverview ARIA accessibility tree snapshot capture utilities
 */

import { logger } from './logger.js';

/**
 * Captures a comprehensive accessibility snapshot of the current web page.
 * This function combines page metadata (URL, title) with the accessibility tree
 * to provide AI agents with complete context about the page state.
 * 
 * The snapshot is formatted as structured text that includes:
 * - Optional status message (e.g., "Clicked button X")
 * - Current page URL for navigation context
 * - Page title for content identification
 * - ARIA accessibility tree in YAML format for element identification
 * 
 * @async
 * @function captureAriaSnapshot
 * @param {Object} context - The application context containing WebSocket connection
 * @param {string} [status=''] - Optional status message to include in the snapshot
 * @returns {Promise<Object>} MCP-formatted response with snapshot content
 * 
 * @example
 * // Basic snapshot without status
 * const snapshot = await captureAriaSnapshot(context);
 * 
 * @example
 * // Snapshot with operation status
 * const snapshot = await captureAriaSnapshot(context, 'Successfully clicked login button');
 * 
 * @example
 * // Using in tool response
 * return {
 *   content: [
 *     { type: 'text', text: 'Operation completed' },
 *     ...await captureAriaSnapshot(context, 'Button clicked').content
 *   ]
 * };
 */
export async function captureAriaSnapshot(context, status = '') {
  logger.log('Starting ARIA snapshot capture', {
    hasStatus: !!status,
    statusLength: status.length,
    hasContext: !!context,
    hasWebSocket: context?.hasWs()
  });
  
  try {
    // Gather page metadata and accessibility information
    logger.log('Requesting page URL from browser');
    const url = await context.sendSocketMessage('getUrl', undefined);
    logger.log('URL received', { url, urlLength: url?.length });
    
    logger.log('Requesting page title from browser');
    const title = await context.sendSocketMessage('getTitle', undefined);
    logger.log('Title received', { title, titleLength: title?.length });
    
    logger.log('Requesting browser snapshot');
    const snapshot = await context.sendSocketMessage('browser_snapshot', {});
    logger.log('Snapshot received', { 
      snapshotType: typeof snapshot,
      snapshotLength: typeof snapshot === 'string' ? snapshot.length : undefined,
      hasSnapshot: !!snapshot
    });
    
    const result = {
      content: [
        {
          type: 'text',
          text: `${
            status
              ? `${status}
`
              : ''
          }
- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshot}
\`\`\`
`,
        },
      ],
    };
    
    logger.log('ARIA snapshot capture completed', {
      hasStatus: !!status,
      url,
      title,
      snapshotLength: typeof snapshot === 'string' ? snapshot.length : undefined,
      resultContentLength: result.content[0].text.length
    });
    
    return result;
  } catch (error) {
    logger.error('ARIA snapshot capture failed', {
      error: error.message,
      stack: error.stack,
      hasContext: !!context,
      hasWebSocket: context?.hasWs()
    });
    throw error;
  }
} 