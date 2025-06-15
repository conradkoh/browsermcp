/**
 * Application Configuration
 * 
 * This file contains the core application metadata and branding information
 * used throughout the Browser MCP server. These values are used for:
 * - Server identification in MCP protocol
 * - User-facing messages and documentation
 * - Email configuration for notifications
 * 
 * @fileoverview Core application configuration constants
 */

/**
 * Main application configuration object containing metadata and settings
 * that define the Browser MCP application's identity and behavior.
 * 
 * @type {Object}
 * @property {string} name - The display name of the application
 * @property {string} tagline - Short marketing tagline describing the app's purpose
 * @property {string} description - Detailed description of functionality and compatibility
 * @property {Object} email - Email-related configuration
 * @property {string} email.defaultFrom - Default sender email address for notifications
 */
export const appConfig = {
  /** Human-readable application name displayed in MCP clients */
  name: 'Browser MCP',
  
  /** Brief tagline describing the application's core value proposition */
  tagline: 'Automate your browser with AI',
  
  /** 
   * Comprehensive description explaining functionality and supported platforms.
   * Used in documentation, package.json, and help text.
   */
  description:
    'Browser MCP connects AI applications to your browser so you can automate tasks using AI. Supported by Claude, Cursor, VS Code, Windsurf, and more.',
  
  /** Email configuration for system notifications and support */
  email: {
    /** 
     * Default sender email address used for system-generated emails.
     * Should be a valid, monitored email address for support purposes.
     */
    defaultFrom: 'support@mail.browsermcp.io',
  },
}; 