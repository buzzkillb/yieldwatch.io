---
name: mcp-server-card
description: Publish MCP Server Card (SEP-1649) at /.well-known/mcp/server-card.json.
---

# MCP Server Card (SEP-1649)

Publish an MCP Server Card for agent discovery.

## Requirements

- Serve JSON at `/.well-known/mcp/server-card.json` with HTTP 200
- Include `serverInfo` with `name` and `version`
- Include a transport `endpoint` URL
- List `capabilities` (tools, resources, prompts) the server supports

## Implementation

Return a JSON response with serverInfo and capabilities:

```json
{
  "serverInfo": {
    "name": "example/api",
    "version": "1.0.0",
    "description": "API for data"
  },
  "endpoint": "https://YOUR-SITE.com/api",
  "capabilities": {
    "tools": [{ "name": "tool_name", "description": "Tool description" }],
    "resources": [{ "name": "resource_name", "description": "Resource description" }]
  }
}
```

## Validation

```
POST https://isitagentready.com/api/scan
Content-Type: application/json

{"url": "https://YOUR-SITE.com"}
```

Check that `checks.discovery.mcpServerCard.status` is `"pass"`.