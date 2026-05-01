---
name: webmcp
description: Expose site tools to AI agents via browser using WebMCP API (navigator.modelContext.registerTool).
---

# WebMCP (Web Machine Learning Context Protocol)

Expose site tools to AI agents via the browser using the WebMCP API.

## Requirements

- Call navigator.modelContext.registerTool() for each tool
- Each tool needs name, description, inputSchema (JSON Schema), and execute callback
- Use AbortController signal to unregister tools when no longer needed

## Example

```javascript
if (navigator.modelContext && navigator.modelContext.registerTool) {
  const controller = new AbortController();

  navigator.modelContext.registerTool({
    name: 'my_tool',
    description: 'Description of what the tool does',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ result: 'data' }),
  }, { signal: controller.signal });

  window.addEventListener('unload', () => controller.abort());
}
```

## Validation

Check for navigator.modelContext availability in browser console.