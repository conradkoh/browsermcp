#!/usr/bin/env node

// Lightweight CLI wrapper that simply executes the existing MCP startup logic
// implemented in src/index.js.  Keeping the behaviour identical while
// decoupling the binary entry-point from the source tree.

import '../src/index.js'; 