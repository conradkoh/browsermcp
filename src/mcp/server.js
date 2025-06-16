/**
 * Pure MCP Server (Forwarding Variant)
 *
 * This server exposes the Model-Context-Protocol over stdio only.  Every
 * CallTool request is forwarded to a user-supplied handler – in our use-case
 * the local Proxy's HTTP endpoint.  No WebSocket or browser logic is
 * instantiated here – keeping the MCP layer completely decoupled from the
 * browser runtime.
 *
 * The implementation is a trimmed-down copy of the former
 * `createForwardingMcpServer` from `src/server/index.js`.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Create an MCP server that simply forwards tool calls.
 *
 * @param {Object} options
 * @param {string} options.name         – Server identification name.
 * @param {string} options.version      – Semver string for the server.
 * @param {Array<Object>} options.tools – Tool objects: { schema, handle }.
 * @param {Array<Object>} options.resources – Resource objects: { schema, read }.
 * @returns {Promise<Server>} Configured server ready to connect to a transport.
 */
export async function createMcpServer(options) {
  const { name, version, tools, resources } = options;

  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.schema),
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((r) => r.schema),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: 'text', text: `Tool "${request.params.name}" not found` },
        ],
        isError: true,
      };
    }

    try {
      return await tool.handle(null, request.params.arguments);
    } catch (error) {
      return {
        content: [{ type: 'text', text: String(error) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find((r) => r.schema.uri === request.params.uri);
    if (!resource) return { contents: [] };
    const contents = await resource.read(null, request.params.uri);
    return { contents };
  });

  return server;
} 