#!/usr/bin/env bash
# =============================================================================
# TRUSTPAY — Safe Database Reset
# =============================================================================
# `prisma migrate reset --force` DROPS ALL DATA. This wrapper refuses to run
# unless DATABASE_URL clearly points at a local database (localhost/127.0.0.1),
# so it can never wipe a staging/production database by accident.
#
# Usage:
#   chmod +x BACKEND/scripts/safe-db-reset.sh
#   ./BACKEND/scripts/safe-db-reset.sh
#   (or via npm) npm run db:reset
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "${RED}❌ DATABASE_URL is not set — refusing to reset.${NC}"
  echo "   Set DATABASE_URL to a local database and try again."
  exit 1
fi

case "$DATABASE_URL" in
  *localhost*|*127.0.0.1*)
    ;;
  *)
    echo -e "${RED}❌ Refusing to reset a non-local database.${NC}"
    echo "   DATABASE_URL must contain 'localhost' or '127.0.0.1'."
    echo "   This guard exists to prevent wiping staging/production data."
    exit 1
    ;;
esac

echo -e "${YELLOW}⚠️  Resetting LOCAL database (all data will be dropped)...${NC}"
npx prisma migrate reset --force
echo -e "${GREEN}✓ Local database reset complete.${NC}"
