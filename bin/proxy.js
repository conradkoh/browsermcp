#!/usr/bin/env node

import { ProxyServer } from '../src/proxy.js';
import { allTools } from '../src/tools/index.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  try {
    const proxy = new ProxyServer({ tools: allTools, resources: [] });
    const result = await proxy.start();
    logger.log(`Proxy status: ${result.status}`);
  } catch (error) {
    console.error('Failed to start proxy:', error);
    process.exit(1);
  }
}

main(); 