#!/bin/sh
set -e

REQUIRED_VARS="CF_API_EMAIL CF_API_TOKEN DOMAIN"
MISSING=""

for var in $REQUIRED_VARS; do
  eval "value=\"\${$var}\""
  if [ -z "$value" ]; then
    MISSING="$MISSING $var"
  fi
done

if [ -n "$MISSING" ]; then
  echo "ERROR: Missing required environment variables:$MISSING"
  echo "Set these before starting Traefik:"
  echo "  export CF_API_EMAIL=your-email@example.com"
  echo "  export CF_API_TOKEN=your-cloudflare-api-token"
  echo "  export DOMAIN=yourdomain.com"
  exit 1
fi

echo "All required environment variables are set."
exec docker-entrypoint.sh "$@"