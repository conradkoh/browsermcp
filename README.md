# Browser MCP

This is a fork of [@browsermcp/mcp](https://www.npmjs.com/package/@browsermcp/mcp) that fixes some reliability issues.

## Installation

Add this to the mcp.json file

```json
{
  "mcpServers": {
    "browsermcp": {
      "command": "npx",
      "args": ["@conradkoh/browsermcp2@latest"]
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
