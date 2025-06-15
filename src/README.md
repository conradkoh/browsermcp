# Browser MCP Source Code Documentation

This directory contains the source code for the Browser MCP server, organized into a modular architecture that promotes maintainability, testability, and clear separation of concerns.

## 🏗️ Architecture Overview

The Browser MCP server is built using a layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Client (Claude, Cursor, etc.)        │
└─────────────────────┬───────────────────────────────────────┘
                      │ MCP Protocol (stdio)
┌─────────────────────▼───────────────────────────────────────┐
│                    MCP Server Layer                         │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐│
│  │     Tools       │ │   Resources     │ │  State Machine  ││
│  └─────────────────┘ └─────────────────┘ └─────────────────┘│
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket
┌─────────────────────▼───────────────────────────────────────┐
│                Browser Extension                            │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐│
│  │   DOM Access    │ │   Screenshots   │ │  Console Logs   ││
│  └─────────────────┘ └─────────────────┘ └─────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 📁 Directory Structure

### `/config/` - Configuration Management

Contains application and protocol configuration files.

- **`app.config.js`** - Application metadata, branding, and general settings
- **`mcp.config.js`** - MCP protocol specific configuration and error messages

### `/context.js` - Connection Management

The Context class manages WebSocket connections to browser extensions and provides a unified interface for communication.

**Key Features:**

- WebSocket lifecycle management
- Error translation and user-friendly messaging
- Connection state validation
- Safe message sending with timeout handling

### `/server/` - MCP Server Implementation

Core server functionality and lifecycle management.

- **`index.js`** - MCP server creation, tool/resource registration, and request handling
- **`state-machine.js`** - Robust server lifecycle management with state transitions, error recovery, and graceful shutdown

### `/tools/` - Browser Automation Tools

MCP tools that provide browser automation capabilities.

- **`common.js`** - Basic browser operations (navigation, keyboard input, waiting)
- **`custom.js`** - Browser MCP specific tools (screenshots, console log access)
- **`snapshot.js`** - DOM interaction tools with accessibility tree capture

### `/types/` - Type Definitions

Zod schemas for type validation and MCP tool definitions.

- **`mcp-tool.js`** - Complete type definitions for all browser automation tools

### `/utils/` - Utility Functions

Shared utilities used across the application.

- **`index.js`** - General purpose utilities (wait function)
- **`logger.js`** - Comprehensive logging system with file output
- **`port.js`** - Port management and process cleanup utilities
- **`aria-snapshot.js`** - Accessibility tree capture and formatting

### `/ws/` - WebSocket Communication

WebSocket server and communication utilities.

- **`index.js`** - WebSocket server creation with port management
- **`sender.js`** - Message sending with timeout, correlation, and error handling
- **`types.js`** - WebSocket message type constants

### `/index.js` - Application Entry Point

Main application entry point that orchestrates all components.

## 🔄 Data Flow

### 1. Server Startup

```
index.js → ServerStateMachine → createServer() → createServerWithTools()
                                      ↓
                              createWebSocketServer() → Port cleanup → Server ready
```

### 2. Tool Execution

```
MCP Client → Server → Tool Handler → Context → WebSocket → Browser Extension
                                                    ↓
                              Response ← ← ← ← ← ← ← ←
```

### 3. Error Handling

```
Error → Logger → State Machine → Recovery/Retry → Continue/Shutdown
```

## 🛠️ Key Components

### State Machine (`server/state-machine.js`)

Manages server lifecycle with explicit states:

- **INITIALIZING** → **CREATING_SERVER** → **CONNECTING** → **CONNECTED**
- Handles retries, reconnection, and graceful shutdown
- Comprehensive error recovery and logging

### Context (`context.js`)

Central communication hub:

- Manages WebSocket connections
- Provides safe message sending interface
- Translates errors to user-friendly messages

### Tools (`tools/`)

Browser automation capabilities:

- **Navigation**: URL navigation, back/forward
- **Interaction**: Click, type, hover, drag & drop
- **Information**: Screenshots, console logs, page snapshots
- **Input**: Keyboard input, form submission

### Logger (`utils/logger.js`)

Comprehensive logging system:

- File-based logging (avoids console.log conflicts with MCP)
- Structured logging with context
- Crash reporting with stack traces
- Log file location reporting

## 🔧 Configuration

### Environment Variables

- No environment variables required (uses sensible defaults)

### Default Settings

- **WebSocket Port**: 9009 (configurable in `mcp.config.js`)
- **Message Timeout**: 30 seconds
- **Retry Attempts**: 3 (for server creation and connection)
- **Log Location**: System temp directory

## 🚀 Usage Patterns

### Adding New Tools

1. Define Zod schema in `types/mcp-tool.js`
2. Implement tool handler in appropriate `tools/` file
3. Register tool in `index.js`

### Error Handling

```javascript
try {
  const result = await context.sendSocketMessage("action", data);
} catch (error) {
  logger.error("Operation failed", { error: error.message });
  // Handle error appropriately
}
```

### Logging

```javascript
import { logger } from "./utils/logger.js";

logger.log("Operation started", { userId: 123 });
logger.error("Operation failed", { error: errorDetails });
logger.crash("Critical failure", error);
```

## 🧪 Testing Considerations

### Unit Testing

- Each module exports pure functions where possible
- Context can be mocked for tool testing
- Logger can be configured for test environments

### Integration Testing

- State machine provides hooks for testing state transitions
- WebSocket communication can be tested with mock servers
- Tools can be tested with mock browser responses

## 🔍 Debugging

### Log Files

- Check `logger.getLogFilePath()` for detailed logs
- Logs include timestamps, context, and stack traces
- Separate log files per server instance

### State Machine

- Use `stateMachine.getStateInfo()` for current state
- State history available for debugging transitions
- Comprehensive error context in logs

### WebSocket Communication

- All messages logged with correlation IDs
- Timeout and error details captured
- Connection state changes logged

## 📈 Performance Considerations

### Memory Management

- Event listeners properly cleaned up
- State history limited to prevent memory leaks
- WebSocket connections properly closed

### Error Recovery

- Exponential backoff for retries
- Graceful degradation on connection loss
- Resource cleanup on shutdown

### Logging Performance

- Asynchronous file writing
- Structured logging to minimize overhead
- Log rotation considerations for long-running instances

## 🔒 Security Considerations

### WebSocket Security

- Local connections only (localhost)
- No authentication required (local development tool)
- Process isolation between server instances

### Error Information

- Sensitive information filtered from logs
- User-friendly error messages (no internal details exposed)
- Stack traces only in log files, not user-facing

## 🚦 Common Issues and Solutions

### Port Conflicts

- Automatic process cleanup on startup
- Graceful handling of port unavailability
- Clear error messages with resolution steps

### Connection Issues

- Automatic retry with exponential backoff
- User-friendly connection guidance
- State machine handles connection recovery

### Browser Extension Issues

- Clear error messages when extension not connected
- Timeout handling for unresponsive extensions
- Graceful degradation when browser closes

---

This modular architecture ensures the Browser MCP server is maintainable, reliable, and easy to extend while providing comprehensive browser automation capabilities through the MCP protocol.
