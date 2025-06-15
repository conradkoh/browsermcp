# Browser MCP

This is a fork of [@browsermcp/mcp](https://www.npmjs.com/package/@browsermcp/mcp) that fixes some reliability issues.

## Installation

Add this to the mcp.json file

```json
{
  "mcpServers": {
    "browsermcp": {
      "command": "npx",
      "args": ["@conradkoh/browsermcp@latest"]
    }
  }
}
```

## Finding Logs

The Browser MCP server logs its activity to a temporary file. When the server exits or crashes, the full path to this log file will be printed to `stderr`.

To find and view the logs:

1.  Look for a message on `stderr` (your terminal output) like:
    `Exiting. Full logs available at: /var/folders/.../browsermcp-YYYY-MM-DDTHH-MM-SS-PID.log`
    or
    `FATAL ERROR: ... Full logs available at: /var/folders/.../browsermcp-YYYY-MM-DDTHH-MM-SS-PID.log`

2.  To view the most recent logs in real-time, you can use the following command (this might take a few seconds):

    ```bash
    tail -f $(find /var/folders /tmp -name "browsermcp-*.log" 2>/dev/null -print0 | xargs -0 ls -t | head -n 1)
    ```

    (The `2>/dev/null` directly on the `find` command will suppress "Permission denied" and other errors from `find` itself.)

3.  To view the entire content of the most recent log file:
    ```bash
    cat $(find /var/folders /tmp -name "browsermcp-*.log" 2>/dev/null -print0 | xargs -0 ls -t | head -n 1)
    ```

## Improvements

1.  **Improved logging:** Logs are now more reliably written to a temporary directory.
2.  **Enhanced exit code handling:** Implemented a finite state machine for better management of exit codes.
3.  **(WIP) Browser Gateway for multi-instance stability:** A browser gateway has been added to resolve conflicts when multiple MCP servers connect to the browser, preventing crashes that previously required server restarts.
