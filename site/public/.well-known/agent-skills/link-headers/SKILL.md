---
name: link-headers
description: Add RFC 8288 Link headers to homepage for agent discovery.
---

# Link Headers (RFC 8288)

Add Link response headers to your homepage for agent discovery per RFC 8288 and RFC 9727 Section 3.

## Requirements

- Return `Link` headers on your homepage response pointing to machine-readable resources
- Use registered relation types: `api-catalog`, `service-desc`, `service-doc`, `describedby`
- Example: `Link: </.well-known/api-catalog>; rel="api-catalog"`
- Multiple Link headers or comma-separated values are both valid

## Implementation

Add Link headers to your homepage response:

```
Link: </.well-known/api-catalog>; rel="api-catalog", </api-docs>; rel="service-desc"
```

## Validation

```
POST https://isitagentready.com/api/scan
Content-Type: application/json

{"url": "https://YOUR-SITE.com"}
```

Check that `checks.discoverability.linkHeaders.status` is `"pass"`.