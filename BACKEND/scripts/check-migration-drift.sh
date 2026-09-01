#!/bin/sh
set -eu

npx prisma validate

: "${SHADOW_DATABASE_URL:?SHADOW_DATABASE_URL is required for migration drift checks}"

npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code
