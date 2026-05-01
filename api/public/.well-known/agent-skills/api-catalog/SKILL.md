---
name: api-catalog
description: Publish RFC 9727 API catalog at /.well-known/api-catalog with application/linkset+json.
---

# API Catalog (RFC 9727)

Publish an API catalog for automated discovery per RFC 9727.

## Requirements

- Serve `/.well-known/api-catalog` with `Content-Type: application/linkset+json` and HTTP 200
- Include a `linkset` array with entries for each API
- Each entry needs an `anchor` URL and link relations: `service-desc`, `service-doc`, and optionally `status`

## Implementation

Return a JSON response with the `linkset` array format:

```json
{
  "linkset": [
    {
      "anchor": "https://YOUR-SITE.com/api/rates",
      "link": [
        { "rel": "service-desc", "href": "https://YOUR-SITE.com/api-docs" },
        { "rel": "service-doc", "href": "https://YOUR-SITE.com/faq" },
        { "rel": "status", "href": "https://YOUR-SITE.com/health" }
      ]
    }
  ]
}
```

## Validation

```
POST https://isitagentready.com/api/scan
Content-Type: application/json

{"url": "https://YOUR-SITE.com"}
```

Check that `checks.discovery.apiCatalog.status` is `"pass"`.