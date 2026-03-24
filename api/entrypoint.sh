#!/bin/sh
set -e

echo "Initializing database schema..."
bun run db:push

if [ "$1" = "api" ]; then
    echo "Starting API server..."
    exec bun run dist/index.js
elif [ "$1" = "scheduler" ]; then
    echo "Starting scheduler..."
    exec bun run src/services/scheduler.ts
else
    exec "$@"
fi
