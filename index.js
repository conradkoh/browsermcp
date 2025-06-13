#!/usr/bin/env node

// src/index.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { program } from 'commander';

// ../../packages/config/src/app.config.ts
var appConfig = {
  name: 'Browser MCP',
  tagline: 'Automate your browser with AI',
  description:
    'Browser MCP connects AI applications to your browser so you can automate tasks using AI. Supported by Claude, Cursor, VS Code, Windsurf, and more.',
  email: {
    defaultFrom: 'support@mail.browsermcp.io',
  },
};

// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ../../packages-r2r/messaging/src/ws/sender.ts
import { WebSocket } from 'ws';

// ../../packages-r2r/messaging/src/ws/types.ts
var MESSAGE_RESPONSE_TYPE = 'messageResponse';

// Enhanced logging utility
function log(level, message, error = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;

  if (level === 'error') {
    console.error(logMessage, error || '');
  } else if (level === 'warn') {
    console.warn(logMessage);
  } else {
    console.log(logMessage);
  }
}

// Enhanced WebSocket state management
class WebSocketManager {
  constructor() {
    this.connectionState = 'disconnected';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.isShuttingDown = false;
  }

  setConnectionState(state) {
    if (this.connectionState !== state) {
      log(
        'info',
        `WebSocket connection state changed: ${this.connectionState} -> ${state}`
      );
      this.connectionState = state;
    }
  }

  startHeartbeat(ws) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch (error) {
          log('warn', 'Failed to send heartbeat ping', error);
        }
      }
    }, 30000); // 30 second heartbeat
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async exponentialBackoff() {
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );
    log(
      'info',
      `Waiting ${delay}ms before reconnection attempt ${
        this.reconnectAttempts + 1
      }`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
    this.reconnectAttempts++;
  }

  resetReconnectAttempts() {
    this.reconnectAttempts = 0;
  }

  shutdown() {
    this.isShuttingDown = true;
    this.stopHeartbeat();
  }
}

const wsManager = new WebSocketManager();

// ../../packages-r2r/messaging/src/ws/sender.ts
function createSocketMessageSender(ws) {
  async function sendSocketMessage(
    type2,
    payload,
    options = { timeoutMs: 3e4 }
  ) {
    const { timeoutMs } = options;
    const id = generateId();
    const message = { id, type: type2, payload };

    return new Promise((resolve, reject) => {
      // Validate WebSocket state before proceeding
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not open or available'));
        return;
      }

      const cleanup = () => {
        try {
          removeSocketMessageResponseListener();
          ws.removeEventListener('error', errorHandler);
          ws.removeEventListener('close', closeHandler);
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        } catch (error) {
          log('warn', 'Error during cleanup', error);
        }
      };

      let timeoutId;
      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error(`WebSocket response timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      const removeSocketMessageResponseListener =
        addSocketMessageResponseListener(ws, (responseMessage) => {
          try {
            const { payload: payload2 } = responseMessage;
            if (payload2.requestId !== id) {
              return;
            }
            const { result, error } = payload2;
            if (error) {
              reject(new Error(error));
            } else {
              resolve(result);
            }
            cleanup();
          } catch (error) {
            log('error', 'Error processing WebSocket response', error);
            cleanup();
            reject(new Error('Failed to process WebSocket response'));
          }
        });

      const errorHandler = (event) => {
        log(
          'error',
          'WebSocket error during message send',
          event?.error || 'Unknown error'
        );
        cleanup();
        reject(new Error('WebSocket error occurred'));
      };

      const closeHandler = () => {
        log('warn', 'WebSocket closed during message send');
        cleanup();
        reject(new Error('WebSocket connection closed'));
      };

      try {
        ws.addEventListener('error', errorHandler);
        ws.addEventListener('close', closeHandler);

        const messageStr = JSON.stringify(message);
        ws.send(messageStr);
      } catch (error) {
        log('error', 'Failed to send WebSocket message', error);
        cleanup();
        reject(new Error(`Failed to send message: ${error.message}`));
      }
    });
  }
  return { sendSocketMessage };
}

function addSocketMessageResponseListener(ws, typeListener) {
  const listener = async (event) => {
    try {
      // Validate event data
      if (!event.data) {
        log('warn', 'Received WebSocket message with no data');
        return;
      }

      let message;
      try {
        const dataStr = event.data.toString();
        message = JSON.parse(dataStr);
      } catch (parseError) {
        log('error', 'Failed to parse WebSocket message JSON', parseError);
        return;
      }

      // Validate message structure
      if (!message || typeof message !== 'object') {
        log('warn', 'Received invalid WebSocket message structure');
        return;
      }

      if (message.type !== MESSAGE_RESPONSE_TYPE) {
        return;
      }

      await typeListener(message);
    } catch (error) {
      log('error', 'Error in WebSocket message listener', error);
      // Don't re-throw to prevent crashing the listener
    }
  };

  ws.addEventListener('message', listener);
  return () => {
    try {
      ws.removeEventListener('message', listener);
    } catch (error) {
      log('warn', 'Error removing WebSocket message listener', error);
    }
  };
}

function generateId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (error) {
    log(
      'warn',
      'Failed to use crypto.randomUUID, falling back to timestamp method',
      error
    );
  }

  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomStr}`;
}

// ../../packages/config/src/mcp.config.ts
var mcpConfig = {
  defaultWsPort: 9009,
  errors: {
    noConnectedTab: 'No tab is connected',
  },
};

// src/context.ts
var noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Browser MCP extension icon in the browser toolbar and clicking the 'Connect' button.`;

var Context = class {
  constructor() {
    this._ws = null;
    this.connectionRetryCount = 0;
    this.maxRetries = 3;
  }

  get ws() {
    if (!this._ws) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }

  set ws(ws) {
    // Clean up previous connection
    if (this._ws && this._ws !== ws) {
      try {
        this._ws.close();
      } catch (error) {
        log('warn', 'Error closing previous WebSocket connection', error);
      }
    }

    this._ws = ws;
    this.connectionRetryCount = 0;

    if (ws) {
      this.setupWebSocketHandlers(ws);
      wsManager.setConnectionState('connected');
      wsManager.resetReconnectAttempts();
      wsManager.startHeartbeat(ws);
    }
  }

  setupWebSocketHandlers(ws) {
    ws.on('error', (error) => {
      log('error', 'WebSocket connection error', error);
      wsManager.setConnectionState('error');
    });

    ws.on('close', (code, reason) => {
      log('info', `WebSocket connection closed: ${code} ${reason}`);
      wsManager.setConnectionState('disconnected');
      wsManager.stopHeartbeat();

      // Don't attempt reconnection if shutting down
      if (!wsManager.isShuttingDown) {
        this.handleConnectionLoss();
      }
    });

    ws.on('pong', () => {
      // Heartbeat response received
      log('debug', 'Received heartbeat pong');
    });
  }

  async handleConnectionLoss() {
    if (this.connectionRetryCount >= this.maxRetries) {
      log('error', 'Max connection retry attempts reached');
      return;
    }

    this.connectionRetryCount++;
    log(
      'info',
      `Attempting to handle connection loss (attempt ${this.connectionRetryCount}/${this.maxRetries})`
    );

    // Wait before next operation
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  hasWs() {
    return !!this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  async sendSocketMessage(type2, payload, options = { timeoutMs: 3e4 }) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.hasWs()) {
          throw new Error(noConnectionMessage);
        }

        const { sendSocketMessage } = createSocketMessageSender(this.ws);
        const result = await sendSocketMessage(type2, payload, options);

        // Reset retry count on success
        this.connectionRetryCount = 0;
        return result;
      } catch (e) {
        lastError = e;
        log(
          'warn',
          `Socket message attempt ${attempt}/${maxRetries} failed`,
          e
        );

        if (
          e instanceof Error &&
          e.message === mcpConfig.errors.noConnectedTab
        ) {
          throw new Error(noConnectionMessage);
        }

        if (attempt < maxRetries) {
          // Wait before retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  async close() {
    wsManager.shutdown();

    if (!this._ws) {
      return;
    }

    try {
      if (this._ws.readyState === WebSocket.OPEN) {
        this._ws.close(1000, 'Server shutdown');
      }
    } catch (error) {
      log('error', 'Error closing WebSocket connection', error);
    } finally {
      this._ws = null;
    }
  }
};

// src/ws.ts
import { WebSocketServer } from 'ws';

// ../../packages/utils/src/index.ts
async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(undefined), ms);
  });
}

// src/utils/port.ts
import { execSync } from 'node:child_process';
import net from 'node:net';
async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port);
  });
}
function killProcessOnPort(port) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `FOR /F "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`
      );
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`);
    }
  } catch (error) {
    console.error(`Failed to kill process on port ${port}:`, error);
  }
}

// src/ws.ts
async function createWebSocketServer(port = mcpConfig.defaultWsPort) {
  try {
    killProcessOnPort(port);

    // Wait for port to be available with timeout
    const maxWaitTime = 10000; // 10 seconds
    const startTime = Date.now();

    while (await isPortInUse(port)) {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`Timeout waiting for port ${port} to become available`);
      }
      await wait(100);
    }

    const wss = new WebSocketServer({
      port,
      perMessageDeflate: false, // Disable compression to reduce CPU usage
      maxPayload: 10 * 1024 * 1024, // 10MB max payload
    });

    // Add server-level error handling
    wss.on('error', (error) => {
      log('error', 'WebSocket server error', error);
    });

    wss.on('listening', () => {
      log('info', `WebSocket server listening on port ${port}`);
    });

    return wss;
  } catch (error) {
    log('error', `Failed to create WebSocket server on port ${port}`, error);
    throw error;
  }
}

// Circuit breaker for failing operations
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime > this.timeout
      ) {
        this.state = 'HALF_OPEN';
        log('info', 'Circuit breaker transitioning to HALF_OPEN');
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      log('warn', `Circuit breaker opened after ${this.failureCount} failures`);
    }
  }
}

const circuitBreaker = new CircuitBreaker();

// src/server.ts
async function createServerWithTools(options) {
  const { name, version, tools, resources: resources2 } = options;
  const context = new Context();

  try {
    const server = new Server(
      { name, version },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    const wss = await createWebSocketServer();

    // Enhanced WebSocket connection handling
    wss.on('connection', (websocket) => {
      log('info', 'New WebSocket connection established');

      try {
        // Close existing connection if any
        if (context.hasWs()) {
          log('info', 'Closing existing WebSocket connection');
          context.ws.close();
        }

        // Set up new connection
        context.ws = websocket;

        // Add connection-specific error handling
        websocket.on('error', (error) => {
          log('error', 'WebSocket connection error', error);
        });

        websocket.on('close', (code, reason) => {
          log('info', `WebSocket connection closed: ${code} ${reason}`);
        });
      } catch (error) {
        log('error', 'Error setting up WebSocket connection', error);
        websocket.close(1011, 'Server error during connection setup');
      }
    });

    // Enhanced request handlers with error handling and logging
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        log('debug', 'Handling ListTools request');
        return { tools: tools.map((tool) => tool.schema) };
      } catch (error) {
        log('error', 'Error handling ListTools request', error);
        throw error;
      }
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        log('debug', 'Handling ListResources request');
        return { resources: resources2.map((resource) => resource.schema) };
      } catch (error) {
        log('error', 'Error handling ListResources request', error);
        throw error;
      }
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params?.name || 'unknown';
      log('info', `Handling CallTool request for: ${toolName}`);

      try {
        const tool = tools.find(
          (tool2) => tool2.schema.name === request.params.name
        );

        if (!tool) {
          log('warn', `Tool not found: ${toolName}`);
          return {
            content: [
              { type: 'text', text: `Tool "${request.params.name}" not found` },
            ],
            isError: true,
          };
        }

        // Use circuit breaker for tool execution
        const result = await circuitBreaker.execute(async () => {
          return await tool.handle(context, request.params.arguments);
        });

        log('info', `Tool ${toolName} executed successfully`);
        return result;
      } catch (error) {
        log('error', `Error executing tool ${toolName}`, error);

        // Return structured error response
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${toolName}: ${
                error.message || String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const resourceUri = request.params?.uri || 'unknown';
      log('info', `Handling ReadResource request for: ${resourceUri}`);

      try {
        const resource = resources2.find(
          (resource2) => resource2.schema.uri === request.params.uri
        );

        if (!resource) {
          log('warn', `Resource not found: ${resourceUri}`);
          return { contents: [] };
        }

        const contents = await resource.read(context, request.params.uri);
        log('info', `Resource ${resourceUri} read successfully`);
        return { contents };
      } catch (error) {
        log('error', `Error reading resource ${resourceUri}`, error);
        return { contents: [] };
      }
    });

    // Enhanced server close method
    const originalClose = server.close.bind(server);
    server.close = async () => {
      log('info', 'Shutting down server...');

      try {
        // Close WebSocket server first
        if (wss) {
          await new Promise((resolve, reject) => {
            wss.close((error) => {
              if (error) {
                log('error', 'Error closing WebSocket server', error);
                reject(error);
              } else {
                log('info', 'WebSocket server closed');
                resolve(undefined);
              }
            });
          });
        }

        // Close context
        await context.close();

        // Close MCP server
        await originalClose();

        log('info', 'Server shutdown complete');
      } catch (error) {
        log('error', 'Error during server shutdown', error);
        throw error;
      }
    };

    return server;
  } catch (error) {
    log('error', 'Failed to create server', error);
    throw error;
  }
}

// src/tools/common.ts
import { zodToJsonSchema } from 'zod-to-json-schema';

// ../../packages/types/src/mcp/tool.ts
import { z } from 'zod';
var ElementSchema = z.object({
  element: z
    .string()
    .describe(
      'Human-readable element description used to obtain permission to interact with the element'
    ),
  ref: z
    .string()
    .describe('Exact target element reference from the page snapshot'),
});
var NavigateTool = z.object({
  name: z.literal('browser_navigate'),
  description: z.literal('Navigate to a URL'),
  arguments: z.object({
    url: z.string().describe('The URL to navigate to'),
  }),
});
var GoBackTool = z.object({
  name: z.literal('browser_go_back'),
  description: z.literal('Go back to the previous page'),
  arguments: z.object({}),
});
var GoForwardTool = z.object({
  name: z.literal('browser_go_forward'),
  description: z.literal('Go forward to the next page'),
  arguments: z.object({}),
});
var WaitTool = z.object({
  name: z.literal('browser_wait'),
  description: z.literal('Wait for a specified time in seconds'),
  arguments: z.object({
    time: z.number().describe('The time to wait in seconds'),
  }),
});
var PressKeyTool = z.object({
  name: z.literal('browser_press_key'),
  description: z.literal('Press a key on the keyboard'),
  arguments: z.object({
    key: z
      .string()
      .describe(
        'Name of the key to press or a character to generate, such as `ArrowLeft` or `a`'
      ),
  }),
});
var SnapshotTool = z.object({
  name: z.literal('browser_snapshot'),
  description: z.literal(
    'Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.'
  ),
  arguments: z.object({}),
});
var ClickTool = z.object({
  name: z.literal('browser_click'),
  description: z.literal('Perform click on a web page'),
  arguments: ElementSchema,
});
var DragTool = z.object({
  name: z.literal('browser_drag'),
  description: z.literal('Perform drag and drop between two elements'),
  arguments: z.object({
    startElement: z
      .string()
      .describe(
        'Human-readable source element description used to obtain the permission to interact with the element'
      ),
    startRef: z
      .string()
      .describe('Exact source element reference from the page snapshot'),
    endElement: z
      .string()
      .describe(
        'Human-readable target element description used to obtain the permission to interact with the element'
      ),
    endRef: z
      .string()
      .describe('Exact target element reference from the page snapshot'),
  }),
});
var HoverTool = z.object({
  name: z.literal('browser_hover'),
  description: z.literal('Hover over element on page'),
  arguments: ElementSchema,
});
var TypeTool = z.object({
  name: z.literal('browser_type'),
  description: z.literal('Type text into editable element'),
  arguments: ElementSchema.extend({
    text: z.string().describe('Text to type into the element'),
    submit: z
      .boolean()
      .describe('Whether to submit entered text (press Enter after)'),
  }),
});
var SelectOptionTool = z.object({
  name: z.literal('browser_select_option'),
  description: z.literal('Select an option in a dropdown'),
  arguments: ElementSchema.extend({
    values: z
      .array(z.string())
      .describe(
        'Array of values to select in the dropdown. This can be a single value or multiple values.'
      ),
  }),
});
var ScreenshotTool = z.object({
  name: z.literal('browser_screenshot'),
  description: z.literal('Take a screenshot of the current page'),
  arguments: z.object({}),
});
var GetConsoleLogsTool = z.object({
  name: z.literal('browser_get_console_logs'),
  description: z.literal('Get the console logs from the browser'),
  arguments: z.object({}),
});
var MCPTool = z.discriminatedUnion('name', [
  // Common
  NavigateTool,
  GoBackTool,
  GoForwardTool,
  WaitTool,
  PressKeyTool,
  // Snapshot
  SnapshotTool,
  ClickTool,
  DragTool,
  HoverTool,
  TypeTool,
  SelectOptionTool,
  // Custom
  ScreenshotTool,
  GetConsoleLogsTool,
]);

// src/utils/aria-snapshot.ts
async function captureAriaSnapshot(context, status = '') {
  const url = await context.sendSocketMessage('getUrl', void 0);
  const title = await context.sendSocketMessage('getTitle', void 0);
  const snapshot2 = await context.sendSocketMessage('browser_snapshot', {});
  return {
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
${snapshot2}
\`\`\`
`,
      },
    ],
  };
}

// src/tools/common.ts
var navigate = (snapshot2) => ({
  schema: {
    name: NavigateTool.shape.name.value,
    description: NavigateTool.shape.description.value,
    inputSchema: zodToJsonSchema(NavigateTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { url } = NavigateTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_navigate', { url });
    if (snapshot2) {
      return captureAriaSnapshot(context);
    }
    return {
      content: [
        {
          type: 'text',
          text: `Navigated to ${url}`,
        },
      ],
    };
  },
});
var goBack = (snapshot2) => ({
  schema: {
    name: GoBackTool.shape.name.value,
    description: GoBackTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoBackTool.shape.arguments),
  },
  handle: async (context) => {
    await context.sendSocketMessage('browser_go_back', {});
    if (snapshot2) {
      return captureAriaSnapshot(context);
    }
    return {
      content: [
        {
          type: 'text',
          text: 'Navigated back',
        },
      ],
    };
  },
});
var goForward = (snapshot2) => ({
  schema: {
    name: GoForwardTool.shape.name.value,
    description: GoForwardTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoForwardTool.shape.arguments),
  },
  handle: async (context) => {
    await context.sendSocketMessage('browser_go_forward', {});
    if (snapshot2) {
      return captureAriaSnapshot(context);
    }
    return {
      content: [
        {
          type: 'text',
          text: 'Navigated forward',
        },
      ],
    };
  },
});
var wait2 = {
  schema: {
    name: WaitTool.shape.name.value,
    description: WaitTool.shape.description.value,
    inputSchema: zodToJsonSchema(WaitTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { time } = WaitTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_wait', { time });
    return {
      content: [
        {
          type: 'text',
          text: `Waited for ${time} seconds`,
        },
      ],
    };
  },
};
var pressKey = {
  schema: {
    name: PressKeyTool.shape.name.value,
    description: PressKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema(PressKeyTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { key } = PressKeyTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_press_key', { key });
    return {
      content: [
        {
          type: 'text',
          text: `Pressed key ${key}`,
        },
      ],
    };
  },
};

// src/tools/custom.ts
import { zodToJsonSchema as zodToJsonSchema2 } from 'zod-to-json-schema';
var getConsoleLogs = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(GetConsoleLogsTool.shape.arguments),
  },
  handle: async (context, _params) => {
    const consoleLogs = await context.sendSocketMessage(
      'browser_get_console_logs',
      {}
    );
    const text = consoleLogs.map((log) => JSON.stringify(log)).join('\n');
    return {
      content: [{ type: 'text', text }],
    };
  },
};
var screenshot = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema2(ScreenshotTool.shape.arguments),
  },
  handle: async (context, _params) => {
    const screenshot2 = await context.sendSocketMessage(
      'browser_screenshot',
      {}
    );
    return {
      content: [
        {
          type: 'image',
          data: screenshot2,
          mimeType: 'image/png',
        },
      ],
    };
  },
};

// src/tools/snapshot.ts
import zodToJsonSchema3 from 'zod-to-json-schema';
var snapshot = {
  schema: {
    name: SnapshotTool.shape.name.value,
    description: SnapshotTool.shape.description.value,
    inputSchema: zodToJsonSchema3(SnapshotTool.shape.arguments),
  },
  handle: async (context) => {
    return await captureAriaSnapshot(context);
  },
};
var click = {
  schema: {
    name: ClickTool.shape.name.value,
    description: ClickTool.shape.description.value,
    inputSchema: zodToJsonSchema3(ClickTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = ClickTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_click', validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: 'text',
          text: `Clicked "${validatedParams.element}"`,
        },
        ...snapshot2.content,
      ],
    };
  },
};
var drag = {
  schema: {
    name: DragTool.shape.name.value,
    description: DragTool.shape.description.value,
    inputSchema: zodToJsonSchema3(DragTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = DragTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_drag', validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: 'text',
          text: `Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`,
        },
        ...snapshot2.content,
      ],
    };
  },
};
var hover = {
  schema: {
    name: HoverTool.shape.name.value,
    description: HoverTool.shape.description.value,
    inputSchema: zodToJsonSchema3(HoverTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = HoverTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_hover', validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: 'text',
          text: `Hovered over "${validatedParams.element}"`,
        },
        ...snapshot2.content,
      ],
    };
  },
};
var type = {
  schema: {
    name: TypeTool.shape.name.value,
    description: TypeTool.shape.description.value,
    inputSchema: zodToJsonSchema3(TypeTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = TypeTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_type', validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: 'text',
          text: `Typed "${validatedParams.text}" into "${validatedParams.element}"`,
        },
        ...snapshot2.content,
      ],
    };
  },
};
var selectOption = {
  schema: {
    name: SelectOptionTool.shape.name.value,
    description: SelectOptionTool.shape.description.value,
    inputSchema: zodToJsonSchema3(SelectOptionTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = SelectOptionTool.shape.arguments.parse(params);
    await context.sendSocketMessage('browser_select_option', validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: 'text',
          text: `Selected option in "${validatedParams.element}"`,
        },
        ...snapshot2.content,
      ],
    };
  },
};

// package.json
var package_default = {
  name: '@browsermcp/mcp',
  version: '0.1.3',
  description: 'MCP server for browser automation using Browser MCP',
  author: 'Browser MCP',
  homepage: 'https://browsermcp.io',
  bugs: 'https://github.com/browsermcp/mcp/issues',
  type: 'module',
  bin: {
    'mcp-server-browsermcp': 'dist/index.js',
  },
  files: ['dist'],
  scripts: {
    typecheck: 'tsc --noEmit',
    build: 'tsup src/index.ts --format esm && shx chmod +x dist/*.js',
    prepare: 'npm run build',
    watch: 'tsup src/index.ts --format esm --watch ',
    inspector:
      'CLIENT_PORT=9001 SERVER_PORT=9002 pnpx @modelcontextprotocol/inspector node dist/index.js',
  },
  dependencies: {
    '@modelcontextprotocol/sdk': '^1.8.0',
    commander: '^13.1.0',
    ws: '^8.18.1',
    zod: '^3.24.2',
    'zod-to-json-schema': '^3.24.3',
  },
  devDependencies: {
    '@r2r/messaging': 'workspace:*',
    '@repo/config': 'workspace:*',
    '@repo/messaging': 'workspace:*',
    '@repo/types': 'workspace:*',
    '@repo/utils': 'workspace:*',
    '@types/ws': '^8.18.0',
    shx: '^0.3.4',
    tsup: '^8.4.0',
    typescript: '^5.6.2',
  },
};

// Global error handlers
process.on('uncaughtException', (error) => {
  log('error', `Uncaught exception: ${error.message || String(error)}`);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', `Unhandled promise rejection: ${String(reason)}`);
  console.error('Promise:', promise);
  process.exit(1);
});

// Enhanced exit watchdog with graceful shutdown
function setupExitWatchdog(server) {
  let isShuttingDown = false;

  const gracefulShutdown = async (signal) => {
    if (isShuttingDown) {
      log('warn', `Received ${signal} during shutdown, forcing exit`);
      process.exit(1);
      return;
    }

    isShuttingDown = true;
    log('info', `Received ${signal}, starting graceful shutdown...`);

    // Set a timeout for forced shutdown
    const forceShutdownTimeout = setTimeout(() => {
      log('error', 'Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, 15000); // 15 seconds timeout

    try {
      await server.close();
      clearTimeout(forceShutdownTimeout);
      log('info', 'Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      log('error', 'Error during graceful shutdown', error);
      clearTimeout(forceShutdownTimeout);
      process.exit(1);
    }
  };

  // Handle various exit signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

  // Handle stdin close (for MCP protocol)
  process.stdin.on('close', () => gracefulShutdown('STDIN_CLOSE'));

  // Handle process exit
  process.on('exit', (code) => {
    log('info', `Process exiting with code ${code}`);
  });
}
var commonTools = [pressKey, wait2];
var customTools = [getConsoleLogs, screenshot];
var snapshotTools = [
  navigate(true),
  goBack(true),
  goForward(true),
  snapshot,
  click,
  hover,
  type,
  selectOption,
  ...commonTools,
  ...customTools,
];
var resources = [];
async function createServer() {
  return createServerWithTools({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources,
  });
}
program
  .version('Version ' + package_default.version)
  .name(package_default.name)
  .action(async () => {
    try {
      log('info', `Starting ${appConfig.name} v${package_default.version}`);

      const server = await createServer();
      setupExitWatchdog(server);

      const transport = new StdioServerTransport();
      await server.connect(transport);

      log('info', 'Server started successfully and connected to transport');
    } catch (error) {
      log('error', `Failed to start server: ${error.message || String(error)}`);
      console.error('Stack trace:', error.stack);
      process.exit(1);
    }
  });

// Parse command line arguments with error handling
try {
  program.parse(process.argv);
} catch (error) {
  log(
    'error',
    `Failed to parse command line arguments: ${error.message || String(error)}`
  );
  process.exit(1);
}
