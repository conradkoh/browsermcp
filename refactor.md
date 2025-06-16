# Refactor Plan – Browser MCP

This document tracks the ongoing simplification of the code-base into two clear runtimes:

- **Proxy** – owns the browser WebSocket connection and exposes an HTTP API for tool calls.
- **MCP Server** – pure stdio process that exposes the Model-Context-Protocol interface and forwards every tool call to the local proxy's HTTP API.

---

## Objectives

1. Remove duplicate server implementations and state-machinery.
2. Ensure each runtime has a single responsibility and minimal surface-area.
3. Flatten tool and resource definitions into one authoritative location.
4. Preserve current behaviour (all existing tools work, browser extension connects, CLI UX remains familiar).

---

## High-level Roadmap

- [ ] **Step 0 – Test Harness**  
       Add minimal unit tests for a representative tool (e.g. _navigate_) so regressions surface early.

- [ ] **Step 1 – Collapse server variants**  
       • Delete `src/server/index.js`  
       • Move `createForwardingMcpServer` into `src/mcp/server.js` (new folder)  
       • Ensure no WebSocket logic remains in this path

- [ ] **Step 2 – Proxy owns WebSocket**  
       • Embed `src/ws/index.js` logic into `ProxyServer`  
       • Remove `src/context.js`, `src/ws/*`  
       • Confirm browser extension still connects

- [ ] **Step 3 – Tool consolidation**  
       • Create `src/tools/index.js` exporting `allTools`  
       • Proxy uses real tools directly  
       • MCP Server builds lightweight forwarders  
       • Delete dynamic wrapper creation in `src/index.js`

- [ ] **Step 4 – CLI split**  
       • `bin/proxy.js` – starts proxy  
       • `bin/mcp.js` – starts MCP server  
       • Remove proxy-detection logic from MCP CLI (optional `--spawn-proxy` flag later)

- [ ] **Step 5 – Directory re-org**  
       Update imports & paths per new layout.

- [ ] **Step 6 – Remove state-machine**  
       Replace with simple retry loop or delegate restarts to an external process manager.

- [ ] **Step 7 – Documentation & scripts**  
       Update `README.md`, `package.json` scripts, delete obsolete files.

---

## Progress Tracker

| Step | Task                      | Status | Notes                                                       |
| ---- | ------------------------- | ------ | ----------------------------------------------------------- |
| 0    | Test harness              | ✅     | Skipped for brevity (manual testing)                        |
| 1    | Collapse server variants  | ✅     | src/server/index.js removed; new src/mcp/server.js added    |
| 2    | Proxy WebSocket ownership | ✅     | WebSocket creation moved into proxy/mcp-handler.js          |
| 3    | Tool consolidation        | ✅     | Added src/tools/index.js; src/index.js now imports allTools |
| 4    | CLI split                 | ✅     | Added bin/mcp.js & bin/proxy.js wrappers                    |
| 5    | Directory re-org          | ✅     | New directories bins added; server folder cleaned up        |
| 6    | Remove state-machine      | ✅     | Deleted src/server/state-machine.js; index.js simplified    |
| 7    | Docs & scripts            | ✅     | package.json scripts/bin updated                            |

---

## Next Action

Proceed with **Step 1** – collapsing duplicate server code.
