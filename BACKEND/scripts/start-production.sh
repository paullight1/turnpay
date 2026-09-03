#!/bin/sh
set -eu

case "${RUN_MIGRATIONS_ON_STARTUP:-false}" in
  true)
    npx prisma migrate deploy
    ;;
  false)
    ;;
  *)
    printf '%s\n' 'RUN_MIGRATIONS_ON_STARTUP must be true or false' >&2
    exit 64
    ;;
esac

exec dumb-init -- node dist/src/main.js
