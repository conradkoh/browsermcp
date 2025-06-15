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
      const cleanup = () => {
        removeSocketMessageResponseListener();
        ws.removeEventListener('error', errorHandler);
        ws.removeEventListener('close', cleanup);
        clearTimeout(timeoutId);
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
        });
      const errorHandler = (_event) => {
        cleanup();
        reject(new Error('WebSocket error occurred'));
      };
      ws.addEventListener('error', errorHandler);
      ws.addEventListener('close', cleanup);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        cleanup();
        reject(new Error('WebSocket is not open'));
      }
    });
  }
  return { sendSocketMessage };
}
function addSocketMessageResponseListener(ws, typeListener) {
  const listener = async (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.type !== MESSAGE_RESPONSE_TYPE) {
      return;
    }
    await typeListener(message);
  };
  ws.addEventListener('message', listener);
  return () => ws.removeEventListener('message', listener);
}
function generateId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
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
  _ws;
  get ws() {
    if (!this._ws) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }
  set ws(ws) {
    this._ws = ws;
  }
  hasWs() {
    return !!this._ws;
  }
  async sendSocketMessage(type2, payload, options = { timeoutMs: 3e4 }) {
    const { sendSocketMessage } = createSocketMessageSender(this.ws);
    try {
      return await sendSocketMessage(type2, payload, options);
    } catch (e) {
      if (e instanceof Error && e.message === mcpConfig.errors.noConnectedTab) {
        throw new Error(noConnectionMessage);
      }
      throw e;
    }
  }
  async close() {
    if (!this._ws) {
      return;
    }
    await this._ws.close();
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

// Logging utilities
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

class Logger {
  constructor() {
    // Create temp file for logging
    const tempDir = os.tmpdir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(
      tempDir,
      `browsermcp-${timestamp}-${process.pid}.log`
    );

    // Initialize log file
    try {
      fs.writeFileSync(
        this.logFile,
        `Browser MCP Server Log - Started at ${new Date().toISOString()}\n`
      );
      fs.writeFileSync(this.logFile, `Process ID: ${process.pid}\n`, {
        flag: 'a',
      });
      fs.writeFileSync(this.logFile, `Log file: ${this.logFile}\n\n`, {
        flag: 'a',
      });
    } catch (error) {
      console.error('Failed to initialize log file:', error.message);
    }
  }

  // Log to temp file only
  log(message, context = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}${
      context && Object.keys(context).length > 0
        ? ' ' + JSON.stringify(context, null, 2)
        : ''
    }\n`;

    try {
      fs.writeFileSync(this.logFile, logEntry, { flag: 'a' });
    } catch (error) {
      // If we can't write to log file, fall back to stderr
      console.error('Failed to write to log file:', error.message);
      console.error('Original message:', message);
    }
  }

  // Log to both temp file and stderr (for real errors)
  error(message, context = {}) {
    // Log to temp file
    this.log(`ERROR: ${message}`, context);

    // Also log to stderr
    console.error(message);
    if (context && Object.keys(context).length > 0) {
      console.error('Error context:', context);
    }
  }

  // Get the log file path
  getLogFilePath() {
    return this.logFile;
  }

  // Log crash info and output log file path to stderr
  crash(message, error) {
    const crashInfo = {
      message,
      error: error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : undefined,
      timestamp: new Date().toISOString(),
      processId: process.pid,
    };

    // Log crash details to temp file
    this.log(`CRASH: ${message}`, crashInfo);

    // Output to stderr
    console.error(`FATAL ERROR: ${message}`);
    if (error) {
      console.error('Error details:', error.message);
    }
    console.error(`Full logs available at: ${this.logFile}`);
  }
}

// Global logger instance
const logger = new Logger();

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
    logger.log(`Checking for existing processes on port ${port}...`);
    if (process.platform === 'win32') {
      // Windows: Find and kill processes using the port
      const result = execSync(
        `FOR /F "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      if (result.trim()) {
        logger.log(`Killed existing process on port ${port}`);
      }
    } else {
      // Unix/Linux/macOS: Find PIDs using the port and kill them
      const pids = execSync(`lsof -ti:${port}`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      if (pids) {
        const pidList = pids.split('\n').filter((pid) => pid.trim());
        const currentPid = process.pid.toString();

        // Filter out our own process to avoid killing ourselves
        const otherPids = pidList.filter((pid) => pid !== currentPid);

        if (otherPids.length > 0) {
          // First try graceful termination
          try {
            execSync(`kill -TERM ${otherPids.join(' ')}`, { stdio: 'pipe' });
            logger.log(
              `Sent TERM signal to process(es) on port ${port}: ${otherPids.join(
                ', '
              )}`
            );

            // Wait a bit for graceful shutdown
            execSync('sleep 1', { stdio: 'pipe' });

            // Check if any are still running and force kill if needed
            const stillRunning = execSync(`lsof -ti:${port}`, {
              encoding: 'utf8',
              stdio: 'pipe',
            }).trim();

            if (stillRunning) {
              const stillRunningPids = stillRunning
                .split('\n')
                .filter((pid) => pid.trim() && pid !== currentPid);
              if (stillRunningPids.length > 0) {
                execSync(`kill -9 ${stillRunningPids.join(' ')}`, {
                  stdio: 'pipe',
                });
                logger.log(
                  `Force killed remaining process(es) on port ${port}: ${stillRunningPids.join(
                    ', '
                  )}`
                );
              }
            }
          } catch (killError) {
            // If graceful kill fails, try force kill
            execSync(`kill -9 ${otherPids.join(' ')}`, { stdio: 'pipe' });
            logger.log(
              `Force killed process(es) on port ${port}: ${otherPids.join(
                ', '
              )}`
            );
          }
        } else {
          logger.log(
            `Process on port ${port} is current process (PID: ${currentPid}), skipping kill`
          );
        }
      } else {
        logger.log(`No existing processes found on port ${port}`);
      }
    }
  } catch (error) {
    // This is expected if no process is using the port
    if (error.status === 1) {
      logger.log(`No existing processes found on port ${port}`);
    } else {
      logger.error(`Failed to kill process on port ${port}:`, {
        error: error.message,
      });
    }
  }
}

// src/ws.ts
async function createWebSocketServer(port = mcpConfig.defaultWsPort) {
  logger.log(`Initializing WebSocket server on port ${port}...`);
  killProcessOnPort(port);

  // Give a moment for processes to fully terminate
  await wait(500);

  let attempts = 0;
  const maxAttempts = 50; // 5 seconds total wait time

  while (await isPortInUse(port)) {
    attempts++;
    if (attempts > maxAttempts) {
      throw new Error(
        `Port ${port} is still in use after ${
          maxAttempts * 100
        }ms. Unable to start server.`
      );
    }
    logger.log(
      `Port ${port} still in use, waiting... (attempt ${attempts}/${maxAttempts})`
    );
    await wait(100);
  }

  logger.log(`Port ${port} is now available. Starting WebSocket server...`);
  const wss = new WebSocketServer({ port });
  logger.log(`WebSocket server successfully started on port ${port}`);
  return wss;
}

// src/server.ts
async function createServerWithTools(options) {
  const { name, version, tools, resources: resources2 } = options;
  const context = new Context();
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
  wss.on('connection', (websocket) => {
    if (context.hasWs()) {
      context.ws.close();
    }
    context.ws = websocket;
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources2.map((resource) => resource.schema) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find(
      (tool2) => tool2.schema.name === request.params.name
    );
    if (!tool) {
      return {
        content: [
          { type: 'text', text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }
    try {
      const result = await tool.handle(context, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: 'text', text: String(error) }],
        isError: true,
      };
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources2.find(
      (resource2) => resource2.schema.uri === request.params.uri
    );
    if (!resource) {
      return { contents: [] };
    }
    const contents = await resource.read(context, request.params.uri);
    return { contents };
  });
  const originalClose = server.close.bind(server);
  server.close = async () => {
    await originalClose();
    await wss.close();
    await context.close();
  };
  return server;
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

// Finite State Machine for Server Management
/**
 * ServerStateMachine manages the lifecycle of the MCP server with explicit state transitions.
 *
 * States:
 * - INITIALIZING: Initial state, transitions to CREATING_SERVER
 * - CREATING_SERVER: Attempting to create server instance
 * - RETRYING_SERVER_CREATION: Waiting before retrying server creation
 * - CONNECTING: Attempting to connect server to transport
 * - RETRYING_CONNECTION: Waiting before retrying connection
 * - CONNECTED: Successfully connected and running
 * - RECONNECTING: Connection lost, attempting to reconnect
 * - RESTARTING: Max connection retries exceeded, full restart
 * - SHUTTING_DOWN: Graceful shutdown in progress
 * - SHUTDOWN: Shutdown complete
 * - FAILED: Permanent failure, will exit
 *
 * State Transitions:
 * INITIALIZING -> CREATING_SERVER
 * CREATING_SERVER -> CONNECTING (success) | RETRYING_SERVER_CREATION (failure)
 * RETRYING_SERVER_CREATION -> CREATING_SERVER (after delay)
 * CONNECTING -> CONNECTED (success) | RETRYING_CONNECTION (failure)
 * RETRYING_CONNECTION -> CONNECTING (after delay) | RESTARTING (max retries)
 * CONNECTED -> RECONNECTING (connection lost) | SHUTTING_DOWN (exit signal)
 * RECONNECTING -> CREATING_SERVER
 * RESTARTING -> CREATING_SERVER
 * SHUTTING_DOWN -> SHUTDOWN
 * Any state -> FAILED (permanent error)
 *
 * Benefits of this FSM approach:
 * 1. Clear separation of concerns - each state has a single responsibility
 * 2. Predictable error handling - errors are handled based on current state
 * 3. Proper resource cleanup - resources are cleaned up at appropriate state transitions
 * 4. Debuggability - state history and current state are tracked
 * 5. Maintainability - adding new states or transitions is straightforward
 * 6. Reliability - prevents race conditions and ensures proper shutdown
 */
class ServerStateMachine {
  constructor(config = {}) {
    this.state = 'INITIALIZING';
    this.server = null;
    this.transport = null;
    this.retryCount = 0;
    // Make configuration configurable
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 5000;
    this.maxStateHistory = config.maxStateHistory || 100;
    this.isShuttingDown = false;
    this.stateHistory = [];

    // Define valid state transitions for validation
    this.validTransitions = {
      'INITIALIZING': ['CREATING_SERVER'],
      'CREATING_SERVER': ['CONNECTING', 'RETRYING_SERVER_CREATION', 'FAILED'],
      'RETRYING_SERVER_CREATION': ['CREATING_SERVER'],
      'CONNECTING': ['CONNECTED', 'RETRYING_CONNECTION', 'FAILED'],
      'RETRYING_CONNECTION': ['CONNECTING', 'RESTARTING'],
      'CONNECTED': ['RECONNECTING', 'SHUTTING_DOWN'],
      'RECONNECTING': ['CREATING_SERVER'],
      'RESTARTING': ['CREATING_SERVER'],
      'SHUTTING_DOWN': ['SHUTDOWN'],
      'SHUTDOWN': [],
      'FAILED': [],
    };

    // Bind methods to preserve 'this' context
    this.transition = this.transition.bind(this);
    this.handleError = this.handleError.bind(this);
    this.cleanup = this.cleanup.bind(this);
  }

  // State transition with logging, history, and validation
  transition(newState, context = {}) {
    const previousState = this.state;

    // Validate transition
    if (!this.validTransitions[previousState]?.includes(newState)) {
      logger.error(`Invalid state transition: ${previousState} -> ${newState}`);
      // Allow it but log the warning
    }

    // Limit state history size to prevent memory leaks
    if (this.stateHistory.length >= this.maxStateHistory) {
      this.stateHistory.shift();
    }

    this.stateHistory.push({
      from: previousState,
      to: newState,
      timestamp: new Date().toISOString(),
      context,
      retryCount: this.retryCount,
    });

    this.state = newState;
    logger.log(`State transition: ${previousState} -> ${newState}`, context);

    // Reset retry count on successful transitions
    if (newState === 'CONNECTED') {
      this.retryCount = 0;
    }
  }

  // Centralized error handling with state-aware logic
  async handleError(error, currentOperation) {
    const errorContext = {
      message: error.message,
      stack: error.stack,
      operation: currentOperation,
      timestamp: new Date().toISOString(),
      currentRetryCount: this.retryCount,
    };

    logger.error(`Error in ${currentOperation}:`, errorContext);

    if (this.isShuttingDown) {
      this.transition('SHUTDOWN', {
        reason: 'Error during shutdown',
        errorContext,
      });
      return;
    }

    switch (this.state) {
      case 'CREATING_SERVER':
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          this.transition('RETRYING_SERVER_CREATION', {
            attempt: this.retryCount,
            maxRetries: this.maxRetries,
            errorContext,
          });
        } else {
          this.transition('FAILED', {
            reason: 'Max server creation retries exceeded',
            errorContext,
          });
        }
        break;

      case 'CONNECTING':
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          this.transition('RETRYING_CONNECTION', {
            attempt: this.retryCount,
            maxRetries: this.maxRetries,
            errorContext,
          });
        } else {
          this.transition('RESTARTING', {
            reason: 'Max connection retries exceeded',
            errorContext,
          });
        }
        break;

      case 'CONNECTED':
        // Reset retry count when transitioning from CONNECTED to handle new connection issues
        this.retryCount = 0;
        this.transition('RECONNECTING', {
          reason: 'Connection lost',
          errorContext,
        });
        break;

      default:
        this.transition('FAILED', {
          reason: `Unexpected error in state ${this.state}`,
          errorContext,
        });
    }
  }

  // Cleanup resources based on current state
  async cleanup() {
    logger.log(`Cleaning up resources in state: ${this.state}`);

    try {
      if (this.server) {
        await this.server.close();
        this.server = null;
      }
    } catch (error) {
      logger.error('Error closing server:', { error: error.message });
    }

    this.transport = null;
  }

  // Setup exit handlers with state machine integration
  setupExitWatchdog() {
    const gracefulShutdown = async (signal) => {
      if (this.isShuttingDown) {
        logger.log(`Already shutting down, ignoring ${signal}`);
        return;
      }

      this.isShuttingDown = true;
      this.transition('SHUTTING_DOWN', { signal });

      try {
        await this.cleanup();
        this.transition('SHUTDOWN', { signal });
        logger.log('Server closed successfully');
        console.error(
          `Exiting. Full logs available at: ${logger.getLogFilePath()}`
        );
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', {
          error: error.message,
          stack: error.stack,
        });
        console.error(
          `Exiting with error. Full logs available at: ${logger.getLogFilePath()}`
        );
        process.exit(1);
      }
    };

    // Handle various exit signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

    process.stdin.on('close', async () => {
      if (!this.isShuttingDown) {
        logger.log('stdin closed, shutting down...');
        setTimeout(() => {
          logger.log('Forced exit after timeout');
          console.error(
            `Forced exit after timeout. Full logs available at: ${logger.getLogFilePath()}`
          );
          process.exit(0);
        }, 15000);
        await gracefulShutdown('stdin close');
      }
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.crash('Uncaught exception', error);
      if (!this.isShuttingDown) {
        gracefulShutdown('uncaughtException');
      }
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.crash(
        'Unhandled rejection',
        new Error(`Unhandled rejection at: ${promise}, reason: ${reason}`)
      );
      if (!this.isShuttingDown) {
        gracefulShutdown('unhandledRejection');
      }
    });
  }

  // Main state machine execution loop
  async run() {
    this.setupExitWatchdog();

    while (!this.isShuttingDown) {
      try {
        switch (this.state) {
          case 'INITIALIZING':
            this.transition('CREATING_SERVER');
            break;

          case 'CREATING_SERVER':
            try {
              this.server = await createServer();
              this.transition('CONNECTING');
            } catch (error) {
              await this.handleError(error, 'server creation');
            }
            break;

          case 'RETRYING_SERVER_CREATION':
            logger.log(
              `Retrying server creation in ${this.retryDelay}ms (attempt ${this.retryCount}/${this.maxRetries})`
            );
            await wait(this.retryDelay);
            this.transition('CREATING_SERVER');
            break;

          case 'CONNECTING':
            try {
              if (!this.server) {
                throw new Error('Server not initialized');
              }
              this.transport = new StdioServerTransport();
              await this.server.connect(this.transport);
              this.transition('CONNECTED');
            } catch (error) {
              await this.handleError(error, 'connection');
            }
            break;

          case 'RETRYING_CONNECTION':
            logger.log(
              `Retrying connection in ${this.retryDelay}ms (attempt ${this.retryCount}/${this.maxRetries})`
            );
            await wait(this.retryDelay);
            this.transition('CONNECTING');
            break;

          case 'CONNECTED':
            logger.log('Server connected successfully. Running...');
            // In connected state, we wait for external events (handled by exit watchdog)
            // Use a more efficient event-driven approach instead of polling
            await new Promise((resolve) => {
              const stateChangeHandler = () => {
                if (this.isShuttingDown || this.state !== 'CONNECTED') {
                  resolve(undefined);
                }
              };

              // Check every 5 seconds instead of every second to reduce CPU usage
              const intervalId = setInterval(stateChangeHandler, 5000);

              // Initial check
              stateChangeHandler();

              // Cleanup interval when promise resolves
              const originalResolve = resolve;
              resolve = (value) => {
                clearInterval(intervalId);
                originalResolve(value);
              };
            });
            break;

          case 'RECONNECTING':
            logger.log('Attempting to reconnect...');
            await this.cleanup();
            this.retryCount = 0;
            this.transition('CREATING_SERVER');
            break;

          case 'RESTARTING':
            logger.log('Max connection retries reached. Restarting server...');
            await this.cleanup();
            this.retryCount = 0;
            this.transition('CREATING_SERVER');
            break;

          case 'FAILED':
            logger.crash('Server failed permanently. Exiting...');
            await this.cleanup();
            process.exit(1);
            break;

          case 'SHUTTING_DOWN':
          case 'SHUTDOWN':
            // These states are handled by the exit watchdog
            return;

          default:
            logger.error(`Unknown state: ${this.state}`);
            this.transition('FAILED', { reason: 'Unknown state' });
        }
      } catch (error) {
        logger.error('Unexpected error in state machine:', {
          error: error.message,
          stack: error.stack,
        });
        await this.handleError(error, `state ${this.state}`);
      }
    }
  }

  // Debug method to get current state info
  getStateInfo() {
    return {
      currentState: this.state,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      isShuttingDown: this.isShuttingDown,
      hasServer: !!this.server,
      hasTransport: !!this.transport,
      stateHistory: this.stateHistory.slice(-10), // Last 10 transitions
    };
  }
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

/**
 * Server State Machine Diagram
 * ============================
 *
 * This diagram shows the state transitions in the ServerStateMachine:
 *
 *     ┌─────────────────┐
 *     │   INITIALIZING  │
 *     └─────────┬───────┘
 *               │
 *               ▼
 *     ┌─────────────────┐    ┌───────────────────────────┐
 *     │ CREATING_SERVER │◄───┤ RETRYING_SERVER_CREATION  │
 *     └─────┬───────────┘    └─────────▲─────────────────┘
 *           │                          │
 *           ▼                          │ (retry if < maxRetries)
 *     ┌─────────────────┐              │
 *     │   CONNECTING    │              │
 *     └─────┬───────────┘              │
 *           │                          │
 *           ▼                          │
 *     ┌─────────────────┐    ┌────────────────────────┐  │
 *     │   CONNECTED     │    │ RETRYING_CONNECTION    │  │
 *     └─────┬───────────┘    └──────▲─────────────────┘  │
 *           │                       │                    │
 *           │ (connection lost)     │ (retry if < max)   │
 *           ▼                       │                    │
 *     ┌─────────────────┐           │                    │
 *     │  RECONNECTING   │───────────┘                    │
 *     └─────┬───────────┘                                │
 *           │                                            │
 *           └─────────────┐                              │
 *                         ▼                              │
 *     ┌─────────────────┐           ┌─────────────────┐  │
 *     │   RESTARTING    │──────────►│     FAILED      │──┘
 *     └─────┬───────────┘           └─────────────────┘
 *           │                             ▲
 *           └─────────────────────────────┘
 *                         │
 *                         │ (max retries exceeded)
 *
 *     Exit Signals (SIGTERM, SIGINT, etc.)
 *                │
 *                ▼
 *     ┌─────────────────┐
 *     │ SHUTTING_DOWN   │
 *     └─────┬───────────┘
 *           │
 *           ▼
 *     ┌─────────────────┐
 *     │    SHUTDOWN     │
 *     └─────────────────┘
 *
 * State Descriptions:
 * - INITIALIZING: Initial state at startup
 * - CREATING_SERVER: Attempting to create MCP server instance
 * - RETRYING_SERVER_CREATION: Waiting before retrying server creation
 * - CONNECTING: Attempting to connect server to transport (stdio)
 * - RETRYING_CONNECTION: Waiting before retrying connection
 * - CONNECTED: Successfully running and handling requests
 * - RECONNECTING: Connection lost, attempting to reconnect
 * - RESTARTING: Max connection retries exceeded, performing full restart
 * - SHUTTING_DOWN: Graceful shutdown initiated
 * - SHUTDOWN: Shutdown complete
 * - FAILED: Permanent failure, process will exit
 */
program
  .version('Version ' + package_default.version)
  .name(package_default.name)
  .action(async () => {
    const stateMachine = new ServerStateMachine();
    await stateMachine.run();
  });
program.parse(process.argv);
