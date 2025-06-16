import { navigate, goBack, goForward, pressKey, wait } from './common.js';
import {
  snapshot,
  click,
  hover,
  type,
  selectOption,
} from './snapshot.js';
import { getConsoleLogs, screenshot } from './custom.js';

// Assemble authoritative list of runtime tool objects.
// Navigation tools are wrapped with snapshot capture for rich context.
export const allTools = [
  // Navigation with snapshot capture
  navigate(true),
  goBack(true),
  goForward(true),

  // DOM interaction + snapshot capture
  snapshot,
  click,
  hover,
  type,
  selectOption,

  // Basic utilities
  pressKey,
  wait,

  // Advanced / custom
  getConsoleLogs,
  screenshot,
]; 