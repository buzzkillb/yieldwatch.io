---
name: markdown-negotiation
description: Support Accept: text/markdown for markdown-formatted responses to agents.
---

# Markdown Content Negotiation

Support `Accept: text/markdown` content negotiation so agents can request markdown versions of your pages.

## Requirements

- When a request includes `Accept: text/markdown`, return a markdown representation of the page
- Set `Content-Type: text/markdown` on the response
- HTML remains the default for requests without the markdown accept header
- Include an `x-markdown-tokens` header with the token count if available

## Implementation

Check for `Accept: text/markdown` header and convert HTML to markdown:

```javascript
const accept = headers['accept'] || '';
if (accept.includes('text/markdown')) {
  const markdown = htmlToMarkdown(html);
  set.headers['x-markdown-tokens'] = String(markdown.split(/\s+/).length);
  return new Response(markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
  });
}
```

## Validation

```
POST https://isitagentready.com/api/scan
Content-Type: application/json

{"url": "https://YOUR-SITE.com"}
```

Check that `checks.contentAccessibility.markdownNegotiation.status` is `"pass"`.