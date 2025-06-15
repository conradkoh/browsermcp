/**
 * MCP Tool Type Definitions
 * 
 * This file contains Zod schema definitions for all browser automation tools
 * available in the Browser MCP server. These schemas provide:
 * - Type validation for tool arguments
 * - Documentation for MCP clients
 * - Runtime type checking and error reporting
 * - IDE autocompletion and type hints
 * 
 * Each tool schema defines:
 * - Tool name (unique identifier)
 * - Human-readable description
 * - Argument schema with validation and documentation
 * 
 * @fileoverview Zod schemas for MCP browser automation tools
 */

import { z } from 'zod';

/**
 * Base schema for DOM element references used in browser interactions.
 * This schema is reused across multiple tools that need to target specific
 * elements on a web page.
 * 
 * @type {z.ZodObject}
 * @property {string} element - Human-readable description for user permission
 * @property {string} ref - Technical element reference from accessibility snapshot
 * 
 * @example
 * {
 *   element: "Login button",
 *   ref: "button[data-testid='login-btn']"
 * }
 */
export const ElementSchema = z.object({
  /**
   * Human-readable element description used to obtain permission to interact
   * with the element. This should be descriptive enough for users to understand
   * what element will be interacted with.
   */
  element: z
    .string()
    .describe(
      'Human-readable element description used to obtain permission to interact with the element'
    ),
  /**
   * Exact target element reference from the page snapshot. This is typically
   * a CSS selector, XPath, or other technical identifier that precisely
   * locates the element in the DOM.
   */
  ref: z
    .string()
    .describe('Exact target element reference from the page snapshot'),
});

// ============================================================================
// NAVIGATION TOOLS
// Tools for page navigation and browser history management
// ============================================================================

/**
 * Schema for the browser navigation tool.
 * Allows navigation to any URL with validation.
 * 
 * @type {z.ZodObject}
 */
export const NavigateTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_navigate'),
  /** Human-readable tool description */
  description: z.literal('Navigate to a URL'),
  /** Tool arguments schema */
  arguments: z.object({
    /** Target URL to navigate to (must be valid URL format) */
    url: z.string().describe('The URL to navigate to'),
  }),
});

/**
 * Schema for the browser back navigation tool.
 * Navigates to the previous page in browser history.
 * 
 * @type {z.ZodObject}
 */
export const GoBackTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_go_back'),
  /** Human-readable tool description */
  description: z.literal('Go back to the previous page'),
  /** No arguments required for this tool */
  arguments: z.object({}),
});

/**
 * Schema for the browser forward navigation tool.
 * Navigates to the next page in browser history.
 * 
 * @type {z.ZodObject}
 */
export const GoForwardTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_go_forward'),
  /** Human-readable tool description */
  description: z.literal('Go forward to the next page'),
  /** No arguments required for this tool */
  arguments: z.object({}),
});

// ============================================================================
// TIMING AND INPUT TOOLS
// Tools for controlling timing and keyboard input
// ============================================================================

/**
 * Schema for the wait tool.
 * Introduces delays in automation sequences.
 * 
 * @type {z.ZodObject}
 */
export const WaitTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_wait'),
  /** Human-readable tool description */
  description: z.literal('Wait for a specified time in seconds'),
  /** Tool arguments schema */
  arguments: z.object({
    /** Duration to wait in seconds (positive number) */
    time: z.number().describe('The time to wait in seconds'),
  }),
});

/**
 * Schema for the keyboard input tool.
 * Sends keyboard events to the browser.
 * 
 * @type {z.ZodObject}
 */
export const PressKeyTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_press_key'),
  /** Human-readable tool description */
  description: z.literal('Press a key on the keyboard'),
  /** Tool arguments schema */
  arguments: z.object({
    /** 
     * Key to press - can be special keys (ArrowLeft, Enter, Escape) 
     * or regular characters (a, b, c, 1, 2, 3)
     */
    key: z
      .string()
      .describe(
        'Name of the key to press or a character to generate, such as `ArrowLeft` or `a`'
      ),
  }),
});

// ============================================================================
// PAGE ANALYSIS TOOLS
// Tools for capturing and analyzing page content
// ============================================================================

/**
 * Schema for the accessibility snapshot tool.
 * Captures the current page's accessibility tree for element identification.
 * 
 * @type {z.ZodObject}
 */
export const SnapshotTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_snapshot'),
  /** Human-readable tool description */
  description: z.literal(
    'Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.'
  ),
  /** No arguments required for this tool */
  arguments: z.object({}),
});

/**
 * Schema for the screenshot tool.
 * Captures a visual screenshot of the current page.
 * 
 * @type {z.ZodObject}
 */
export const ScreenshotTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_screenshot'),
  /** Human-readable tool description */
  description: z.literal('Take a screenshot of the current page'),
  /** No arguments required for this tool */
  arguments: z.object({}),
});

/**
 * Schema for the console logs tool.
 * Retrieves browser console logs for debugging.
 * 
 * @type {z.ZodObject}
 */
export const GetConsoleLogsTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_get_console_logs'),
  /** Human-readable tool description */
  description: z.literal('Get the console logs from the browser'),
  /** No arguments required for this tool */
  arguments: z.object({}),
});

// ============================================================================
// DOM INTERACTION TOOLS
// Tools for interacting with page elements
// ============================================================================

/**
 * Schema for the click tool.
 * Performs mouse clicks on page elements.
 * 
 * @type {z.ZodObject}
 */
export const ClickTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_click'),
  /** Human-readable tool description */
  description: z.literal('Perform click on a web page'),
  /** Uses the base ElementSchema for element targeting */
  arguments: ElementSchema,
});

/**
 * Schema for the hover tool.
 * Moves mouse cursor over page elements to trigger hover effects.
 * 
 * @type {z.ZodObject}
 */
export const HoverTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_hover'),
  /** Human-readable tool description */
  description: z.literal('Hover over element on page'),
  /** Uses the base ElementSchema for element targeting */
  arguments: ElementSchema,
});

/**
 * Schema for the drag and drop tool.
 * Performs drag and drop operations between two elements.
 * 
 * @type {z.ZodObject}
 */
export const DragTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_drag'),
  /** Human-readable tool description */
  description: z.literal('Perform drag and drop between two elements'),
  /** Tool arguments schema with source and target elements */
  arguments: z.object({
    /** Human-readable description of the source element */
    startElement: z
      .string()
      .describe(
        'Human-readable source element description used to obtain the permission to interact with the element'
      ),
    /** Technical reference to the source element */
    startRef: z
      .string()
      .describe('Exact source element reference from the page snapshot'),
    /** Human-readable description of the target element */
    endElement: z
      .string()
      .describe(
        'Human-readable target element description used to obtain the permission to interact with the element'
      ),
    /** Technical reference to the target element */
    endRef: z
      .string()
      .describe('Exact target element reference from the page snapshot'),
  }),
});

/**
 * Schema for the text input tool.
 * Types text into form fields and editable elements.
 * 
 * @type {z.ZodObject}
 */
export const TypeTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_type'),
  /** Human-readable tool description */
  description: z.literal('Type text into editable element'),
  /** Extends ElementSchema with text input specific arguments */
  arguments: ElementSchema.extend({
    /** Text content to type into the element */
    text: z.string().describe('Text to type into the element'),
    /** Whether to press Enter after typing (for form submission) */
    submit: z
      .boolean()
      .describe('Whether to submit entered text (press Enter after)'),
  }),
});

/**
 * Schema for the dropdown selection tool.
 * Selects options from dropdown menus and select elements.
 * 
 * @type {z.ZodObject}
 */
export const SelectOptionTool = z.object({
  /** Tool identifier for the MCP protocol */
  name: z.literal('browser_select_option'),
  /** Human-readable tool description */
  description: z.literal('Select an option in a dropdown'),
  /** Extends ElementSchema with selection specific arguments */
  arguments: ElementSchema.extend({
    /** 
     * Array of option values to select. Supports both single and 
     * multiple selection depending on the dropdown type.
     */
    values: z
      .array(z.string())
      .describe(
        'Array of values to select in the dropdown. This can be a single value or multiple values.'
      ),
  }),
});

// ============================================================================
// TOOL UNION TYPE
// Discriminated union of all available tools for type safety
// ============================================================================

/**
 * Discriminated union of all available MCP tools.
 * This type ensures type safety when working with tools and provides
 * compile-time checking for tool names and arguments.
 * 
 * Tools are organized into categories:
 * - **Common**: Basic browser operations (navigation, timing, input)
 * - **Snapshot**: Page analysis and element identification
 * - **Custom**: Browser MCP specific features (screenshots, console logs)
 * 
 * @type {z.ZodDiscriminatedUnion}
 */
export const MCPTool = z.discriminatedUnion('name', [
  // Common browser operations
  NavigateTool,
  GoBackTool,
  GoForwardTool,
  WaitTool,
  PressKeyTool,
  
  // Page analysis and DOM interaction
  SnapshotTool,
  ClickTool,
  DragTool,
  HoverTool,
  TypeTool,
  SelectOptionTool,
  
  // Browser MCP specific features
  ScreenshotTool,
  GetConsoleLogsTool,
]); 