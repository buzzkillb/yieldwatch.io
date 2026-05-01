---
name: oauth-discovery
description: Publish OAuth/OIDC discovery metadata for agent authentication.
---

# OAuth/OIDC Discovery

Publish OAuth or OpenID Connect discovery metadata so agents can authenticate.

## Requirements

- Serve JSON at `/.well-known/openid-configuration` (OIDC) or `/.well-known/oauth-authorization-server` (OAuth 2.0)
- Include `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`
- List `grant_types_supported` and `response_types_supported`

## Note

Required only if your APIs are protected. Public APIs can skip this skill.

## Validation

```
POST https://isitagentready.com/api/scan
Content-Type: application/json

{"url": "https://YOUR-SITE.com"}
```

Check that `checks.discovery.oauthDiscovery.status` is `"pass"`.