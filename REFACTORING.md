# Code Refactoring Documentation

This document explains the refactoring of the monolithic `index.js` file into a more maintainable modular structure.

## New Directory Structure

```
src/
├── config/
│   ├── app.config.js      # Application configuration
│   └── mcp.config.js      # MCP-specific configuration
├── context.js             # Context class for WebSocket management
├── server/
│   ├── index.js           # Server creation and MCP setup
│   └── state-machine.js   # Server state machine for lifecycle management
├── tools/
│   ├── common.js          # Common browser tools (navigate, wait, etc.)
│   ├── custom.js          # Custom tools (screenshot, console logs)
│   └── snapshot.js        # DOM interaction tools (click, type, etc.)
├── types/
│   └── mcp-tool.js        # Zod schemas for MCP tools
├── utils/
│   ├── index.js           # General utilities (wait function)
│   ├── logger.js          # Logging utilities
│   ├── port.js            # Port management utilities
│   └── aria-snapshot.js   # ARIA snapshot capture utilities
├── ws/
│   ├── index.js           # WebSocket server creation
│   ├── sender.js          # WebSocket message sending
│   └── types.js           # WebSocket message types
└── index.js               # Main entry point
```

## Key Benefits

1. **Separation of Concerns**: Each module has a single, well-defined responsibility
2. **Maintainability**: Easier to locate and modify specific functionality
3. **Testability**: Individual modules can be tested in isolation
4. **Reusability**: Modules can be imported and used independently
5. **Readability**: Smaller, focused files are easier to understand

## Module Responsibilities

### Configuration (`src/config/`)

- `app.config.js`: Application metadata and settings
- `mcp.config.js`: MCP protocol specific configuration

### Context (`src/context.js`)

- Manages WebSocket connections to browser extension
- Provides unified interface for sending messages

### Server (`src/server/`)

- `index.js`: Creates and configures the MCP server
- `state-machine.js`: Manages server lifecycle with robust error handling

### Tools (`src/tools/`)

- `common.js`: Basic browser navigation and input tools
- `custom.js`: Browser MCP specific tools (screenshots, console logs)
- `snapshot.js`: DOM interaction tools that capture page state

### Types (`src/types/`)

- `mcp-tool.js`: Zod schemas for type validation and MCP tool definitions

### Utils (`src/utils/`)

- `index.js`: General purpose utilities
- `logger.js`: Comprehensive logging with file output
- `port.js`: Port management and process cleanup
- `aria-snapshot.js`: Accessibility tree capture utilities

### WebSocket (`src/ws/`)

- `index.js`: WebSocket server creation and port management
- `sender.js`: Message sending with timeout and error handling
- `types.js`: WebSocket message type constants

## Migration Notes

- The original monolithic file was 1413 lines
- Now split into 16 focused modules
- All functionality preserved with improved error handling
- Entry point changed from `index.js` to `src/index.js`
- Package.json updated to reflect new structure

## Usage

The refactored code maintains the same external API:

```bash
# Run the server
node src/index.js

# Or use the npm script
npm start
```

The command-line interface and MCP protocol remain unchanged.
