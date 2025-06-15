/**
 * DOM Interaction Tools with Snapshot Capture
 * 
 * This file contains tools for interacting with DOM elements on web pages.
 * All tools in this file automatically capture accessibility snapshots after
 * performing their actions, providing AI agents with updated page context.
 * 
 * Key features:
 * - Element targeting using accessibility references
 * - Automatic post-action snapshot capture
 * - Comprehensive DOM interaction capabilities
 * - User-friendly action confirmation messages
 * 
 * These tools form the core of browser automation, enabling AI agents to:
 * - Click buttons and links
 * - Fill out forms
 * - Interact with dropdowns
 * - Perform drag and drop operations
 * - Hover over elements for tooltips/menus
 * 
 * @fileoverview DOM interaction tools with automatic snapshot capture
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  SnapshotTool,
  ClickTool,
  DragTool,
  HoverTool,
  TypeTool,
  SelectOptionTool,
} from '../types/mcp-tool.js';
import { captureAriaSnapshot } from '../utils/aria-snapshot.js';

/**
 * Accessibility snapshot capture tool.
 * Captures the current page's accessibility tree without performing any actions.
 * This tool is essential for AI agents to understand page structure and identify
 * elements for interaction.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Capture current page state
 * const pageState = await snapshot.handle(context);
 * // pageState.content[0].text contains YAML-formatted accessibility tree
 * 
 * @example
 * // Use before planning interactions
 * const snapshot = await snapshot.handle(context);
 * // Analyze snapshot to find clickable elements
 * // Then use click tool with identified element references
 */
export const snapshot = {
  schema: {
    name: SnapshotTool.shape.name.value,
    description: SnapshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(SnapshotTool.shape.arguments),
  },
  /**
   * Handles accessibility snapshot capture requests.
   * Captures the current page's accessibility tree and returns it formatted
   * with page metadata for AI agent context.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @returns {Promise<Object>} MCP response with accessibility snapshot
   */
  handle: async (context) => {
    return await captureAriaSnapshot(context);
  },
};

/**
 * Element click tool with automatic snapshot capture.
 * Performs mouse clicks on specified page elements and captures the resulting
 * page state for AI agent context. Supports clicking any interactive element
 * including buttons, links, form controls, and custom clickable elements.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Click a button and get updated page state
 * const result = await click.handle(context, {
 *   element: "Submit button",
 *   ref: "button[type='submit']"
 * });
 * 
 * @example
 * // Click a link for navigation
 * await click.handle(context, {
 *   element: "About Us link",
 *   ref: "a[href='/about']"
 * });
 */
export const click = {
  schema: {
    name: ClickTool.shape.name.value,
    description: ClickTool.shape.description.value,
    inputSchema: zodToJsonSchema(ClickTool.shape.arguments),
  },
  /**
   * Handles element click requests.
   * Validates element parameters, performs the click action, and captures
   * the resulting page state for AI agent context.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} params - Tool parameters
   * @param {string} params.element - Human-readable element description
   * @param {string} params.ref - Technical element reference (CSS selector, etc.)
   * @returns {Promise<Object>} MCP response with action confirmation and page snapshot
   */
  handle: async (context, params) => {
    const validatedParams = ClickTool.shape.arguments.parse(params);
    
    // Perform the click action
    await context.sendSocketMessage('browser_click', validatedParams);
    
    // Capture updated page state
    const snapshotResult = await captureAriaSnapshot(context);
    
    return {
      content: [
        {
          type: 'text',
          text: `Clicked "${validatedParams.element}"`,
        },
        ...snapshotResult.content,
      ],
    };
  },
};

/**
 * Drag and drop tool with automatic snapshot capture.
 * Performs drag and drop operations between two elements and captures the
 * resulting page state. Useful for reordering lists, moving items between
 * containers, or interacting with drag-enabled interfaces.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Drag an item from one list to another
 * const result = await drag.handle(context, {
 *   startElement: "Task item",
 *   startRef: ".task-item[data-id='123']",
 *   endElement: "Completed tasks list",
 *   endRef: ".completed-tasks"
 * });
 * 
 * @example
 * // Reorder items in a sortable list
 * await drag.handle(context, {
 *   startElement: "First item",
 *   startRef: ".sortable-item:first-child",
 *   endElement: "Third position",
 *   endRef: ".sortable-item:nth-child(3)"
 * });
 */
export const drag = {
  schema: {
    name: DragTool.shape.name.value,
    description: DragTool.shape.description.value,
    inputSchema: zodToJsonSchema(DragTool.shape.arguments),
  },
  /**
   * Handles drag and drop requests.
   * Validates source and target element parameters, performs the drag operation,
   * and captures the resulting page state.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} params - Tool parameters
   * @param {string} params.startElement - Human-readable source element description
   * @param {string} params.startRef - Technical source element reference
   * @param {string} params.endElement - Human-readable target element description
   * @param {string} params.endRef - Technical target element reference
   * @returns {Promise<Object>} MCP response with action confirmation and page snapshot
   */
  handle: async (context, params) => {
    const validatedParams = DragTool.shape.arguments.parse(params);
    
    // Perform the drag and drop action
    await context.sendSocketMessage('browser_drag', validatedParams);
    
    // Capture updated page state
    const snapshotResult = await captureAriaSnapshot(context);
    
    return {
      content: [
        {
          type: 'text',
          text: `Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`,
        },
        ...snapshotResult.content,
      ],
    };
  },
};

/**
 * Element hover tool with automatic snapshot capture.
 * Moves the mouse cursor over specified elements to trigger hover effects
 * like tooltips, dropdown menus, or visual state changes. Captures the
 * resulting page state including any newly visible elements.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Hover over a menu item to reveal submenu
 * const result = await hover.handle(context, {
 *   element: "Products menu",
 *   ref: ".nav-menu .products"
 * });
 * 
 * @example
 * // Hover to show tooltip information
 * await hover.handle(context, {
 *   element: "Help icon",
 *   ref: ".help-icon"
 * });
 */
export const hover = {
  schema: {
    name: HoverTool.shape.name.value,
    description: HoverTool.shape.description.value,
    inputSchema: zodToJsonSchema(HoverTool.shape.arguments),
  },
  /**
   * Handles element hover requests.
   * Validates element parameters, performs the hover action, and captures
   * the resulting page state including any hover-triggered changes.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} params - Tool parameters
   * @param {string} params.element - Human-readable element description
   * @param {string} params.ref - Technical element reference
   * @returns {Promise<Object>} MCP response with action confirmation and page snapshot
   */
  handle: async (context, params) => {
    const validatedParams = HoverTool.shape.arguments.parse(params);
    
    // Perform the hover action
    await context.sendSocketMessage('browser_hover', validatedParams);
    
    // Capture updated page state
    const snapshotResult = await captureAriaSnapshot(context);
    
    return {
      content: [
        {
          type: 'text',
          text: `Hovered over "${validatedParams.element}"`,
        },
        ...snapshotResult.content,
      ],
    };
  },
};

/**
 * Text input tool with automatic snapshot capture.
 * Types text into form fields, text areas, and other editable elements.
 * Supports optional form submission after text entry. Captures the resulting
 * page state to show form validation messages or navigation results.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Fill a search field and submit
 * const result = await type.handle(context, {
 *   element: "Search box",
 *   ref: "input[name='search']",
 *   text: "browser automation",
 *   submit: true
 * });
 * 
 * @example
 * // Fill form field without submitting
 * await type.handle(context, {
 *   element: "Email field",
 *   ref: "input[type='email']",
 *   text: "user@example.com",
 *   submit: false
 * });
 */
export const type = {
  schema: {
    name: TypeTool.shape.name.value,
    description: TypeTool.shape.description.value,
    inputSchema: zodToJsonSchema(TypeTool.shape.arguments),
  },
  /**
   * Handles text input requests.
   * Validates input parameters, performs text entry with optional submission,
   * and captures the resulting page state.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} params - Tool parameters
   * @param {string} params.element - Human-readable element description
   * @param {string} params.ref - Technical element reference
   * @param {string} params.text - Text to type into the element
   * @param {boolean} params.submit - Whether to press Enter after typing
   * @returns {Promise<Object>} MCP response with action confirmation and page snapshot
   */
  handle: async (context, params) => {
    const validatedParams = TypeTool.shape.arguments.parse(params);
    
    // Perform the text input action
    await context.sendSocketMessage('browser_type', validatedParams);
    
    // Capture updated page state
    const snapshotResult = await captureAriaSnapshot(context);
    
    return {
      content: [
        {
          type: 'text',
          text: `Typed "${validatedParams.text}" into "${validatedParams.element}"`,
        },
        ...snapshotResult.content,
      ],
    };
  },
};

/**
 * Dropdown selection tool with automatic snapshot capture.
 * Selects options from dropdown menus, select elements, and multi-select lists.
 * Supports both single and multiple option selection. Captures the resulting
 * page state to show selection changes and any triggered form updates.
 * 
 * @type {Object}
 * @property {Object} schema - MCP tool schema definition
 * @property {Function} handle - Tool execution handler
 * 
 * @example
 * // Select single option from dropdown
 * const result = await selectOption.handle(context, {
 *   element: "Country dropdown",
 *   ref: "select[name='country']",
 *   values: ["United States"]
 * });
 * 
 * @example
 * // Select multiple options from multi-select
 * await selectOption.handle(context, {
 *   element: "Skills multi-select",
 *   ref: "select[name='skills'][multiple]",
 *   values: ["JavaScript", "Python", "React"]
 * });
 */
export const selectOption = {
  schema: {
    name: SelectOptionTool.shape.name.value,
    description: SelectOptionTool.shape.description.value,
    inputSchema: zodToJsonSchema(SelectOptionTool.shape.arguments),
  },
  /**
   * Handles dropdown selection requests.
   * Validates selection parameters, performs option selection, and captures
   * the resulting page state including any selection-triggered changes.
   * 
   * @async
   * @param {Object} context - Application context with WebSocket connection
   * @param {Object} params - Tool parameters
   * @param {string} params.element - Human-readable element description
   * @param {string} params.ref - Technical element reference
   * @param {string[]} params.values - Array of option values to select
   * @returns {Promise<Object>} MCP response with action confirmation and page snapshot
   */
  handle: async (context, params) => {
    const validatedParams = SelectOptionTool.shape.arguments.parse(params);
    
    // Perform the option selection action
    await context.sendSocketMessage('browser_select_option', validatedParams);
    
    // Capture updated page state
    const snapshotResult = await captureAriaSnapshot(context);
    
    return {
      content: [
        {
          type: 'text',
          text: `Selected option in "${validatedParams.element}"`,
        },
        ...snapshotResult.content,
      ],
    };
  },
}; 