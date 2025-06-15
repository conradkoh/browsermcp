# Multi-Instance MCP Server Architecture Implementation Plan

## Overview

Transform the current single-instance MCP server into a multi-instance architecture where:

1. Multiple MCP server instances can run simultaneously
2. A shared browser connection server runs on port 9008
3. MCP instances communicate with the browser server via WebSocket
4. Automatic server management (start/restart/kill) based on availability

## Current Architecture Analysis

- **MCP Server**: Handles tool requests via stdio transport
- **Browser Connection**: WebSocket server on port 9009, single connection only
- **Context**: Manages WebSocket connection state
- **Tools**: Execute browser actions via WebSocket messages

## Target Architecture

- **MCP Server Instances**: Multiple instances, each with stdio transport
- **Browser Connection Server**: Dedicated server on port 9008, handles multiple MCP clients
- **MCP Client**: Each MCP instance connects to browser server as WebSocket client
- **Browser Extension**: Still connects to port 9008 (was 9009)

## Implementation Tasks

### Phase 1: Configuration and Port Management

- [x] **Task 1.1**: Add new port configuration for browser server (9008)
- [x] **Task 1.2**: Update port utilities to handle both MCP client and browser server ports
- [x] **Task 1.3**: Add configuration for connection timeouts and retry logic

### Phase 2: Browser Connection Server (Standalone)

- [x] **Task 2.1**: Create `BrowserConnectionServer` class
  - Manages WebSocket server on port 9008
  - Handles multiple MCP client connections
  - Maintains single browser extension connection
  - Routes messages between MCP clients and browser
- [x] **Task 2.2**: Implement message routing and multiplexing
  - Add client ID to messages
  - Route responses back to correct MCP client
  - Handle browser connection state changes
- [x] **Task 2.3**: Add server lifecycle management
  - Start/stop functionality
  - Health check endpoint
  - Process management utilities

### Phase 3: MCP Client Integration

- [x] **Task 3.1**: Create `BrowserClient` class to replace direct WebSocket usage
  - WebSocket client that connects to port 9008
  - Implements same interface as current Context class
  - Handles connection failures and retries
- [x] **Task 3.2**: Update Context class to use BrowserClient
  - Replace direct WebSocket with BrowserClient
  - Maintain same API for tools
  - Add connection state management
- [x] **Task 3.3**: Implement server discovery and handshake
  - Check if browser server is running on startup
  - Perform handshake to register MCP client
  - Handle server not available scenarios

### Phase 4: Server Management Logic

- [x] **Task 4.1**: Create `ServerManager` class
  - Check if browser server is running
  - Start browser server if needed
  - Kill and restart server on failures
  - Handle process lifecycle
- [x] **Task 4.2**: Integrate server management into MCP startup
  - Check server availability during initialization
  - Start server if not running
  - Register as client after server is ready
- [x] **Task 4.3**: Add failure recovery logic
  - Detect communication failures
  - Attempt server restart
  - Retry message sending after recovery

### Phase 5: Message Protocol Updates

- [ ] **Task 5.1**: Update message protocol to include client identification
  - Add client ID to all messages
  - Update message types for multiplexing
  - Maintain backward compatibility with browser extension
- [ ] **Task 5.2**: Update error handling for multi-client scenarios
  - Client-specific error responses
  - Connection state per client
  - Graceful client disconnection

### Phase 6: State Machine Updates

- [x] **Task 6.1**: Update ServerStateMachine for new architecture
  - Add states for browser server management
  - Update connection logic for client mode
  - Add server discovery states
- [x] **Task 6.2**: Add browser server state management
  - Server running/stopped states
  - Client registration states
  - Recovery and restart states

### Phase 7: Testing and Validation

- [x] **Task 7.1**: Test single MCP instance (backward compatibility)
- [x] **Task 7.2**: Test multiple MCP instances simultaneously
- [x] **Task 7.3**: Test server failure and recovery scenarios
- [x] **Task 7.4**: Test browser extension connection handling

### Phase 8: Documentation and Cleanup

- [ ] **Task 8.1**: Update architecture documentation
- [ ] **Task 8.2**: Add configuration examples
- [ ] **Task 8.3**: Clean up unused code and imports

## Implementation Order

1. Start with Phase 1 (Configuration) - foundation changes
2. Phase 2 (Browser Server) - core new functionality
3. Phase 3 (MCP Client) - integration layer
4. Phase 4 (Server Management) - automation logic
5. Phase 5 (Protocol) - communication updates
6. Phase 6 (State Machine) - state management
7. Phase 7 (Testing) - validation
8. Phase 8 (Documentation) - finalization

## Key Design Decisions

- **Port 9008**: Browser connection server (was 9009)
- **Port 9009**: Still available for direct connections if needed
- **Client IDs**: UUID-based identification for MCP instances
- **Message Format**: Extend current format with client metadata
- **Process Management**: Use child_process for server lifecycle
- **Backward Compatibility**: Maintain existing tool interfaces

## Risk Mitigation

- Implement comprehensive error handling at each layer
- Add extensive logging for debugging multi-instance issues
- Maintain fallback to single-instance mode if needed
- Use timeouts and retries for all network operations
- Implement graceful degradation when server is unavailable

## Implementation Status

### ✅ COMPLETED PHASES

**Phase 1-4, 6-7: Core Architecture Implementation**

- Multi-instance MCP server architecture successfully implemented
- Browser connection server running on port 9008
- MCP clients connect as WebSocket clients to browser server
- Automatic server management with start/restart/kill functionality
- Message routing and multiplexing between multiple MCP clients
- Comprehensive error handling and recovery mechanisms
- State machine updated for new architecture
- Testing completed - multiple instances can run simultaneously

### 🔄 REMAINING WORK

**Phase 5: Message Protocol Updates** - Not critical for basic functionality
**Phase 8: Documentation and Cleanup** - Ongoing

### 🎯 KEY ACHIEVEMENTS

1. **Multi-Instance Support**: Multiple MCP server instances can now run simultaneously
2. **Shared Browser Connection**: Single browser server on port 9008 handles all MCP clients
3. **Automatic Server Management**: Server starts automatically and handles failures gracefully
4. **Backward Compatibility**: Existing tool interfaces maintained
5. **Robust Error Handling**: Connection failures trigger automatic recovery
6. **Message Routing**: Proper multiplexing ensures responses reach correct MCP clients

### 🧪 TEST RESULTS

- ✅ Browser server starts successfully on port 9008
- ✅ Multiple MCP instances can run simultaneously without conflicts
- ✅ WebSocket connections work properly
- ✅ Handshake protocol functions correctly
- ✅ Client identification and message routing operational
