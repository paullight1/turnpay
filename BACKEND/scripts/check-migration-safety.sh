#!/usr/bin/env bash
# =============================================================================
# TRUSTPAY — Migration Safety Check
# =============================================================================
# Verifies no schema drift between migrations and database.
# Use in CI to block merges when migrations are out of sync.
#
# Exit codes:
#   0 — Schema is up to date (safe to proceed)
#   1 — Drift detected (pending migrations exist, or error)
#
# Usage:
#   chmod +x BACKEND/scripts/check-migration-safety.sh
#   DATABASE_URL="postgresql://..." ./BACKEND/scripts/check-migration-safety.sh
#   # Or in CI:
#   DATABASE_URL="${{ secrets.DATABASE_URL }}" ./BACKEND/scripts/check-migration-safety.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ─── Validate Environment ──────────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "${RED}❌ DATABASE_URL is not set${NC}"
  echo "Usage: DATABASE_URL=\"postgresql://...\" $0"
  exit 1
fi

# Check prisma CLI
if ! npx prisma --version &>/dev/null; then
  echo -e "${RED}❌ Prisma CLI not found. Run: npm install${NC}"
  exit 1
fi

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  TRUSTPAY — Migration Safety Check${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ─── Check Database Connectivity ───────────────────────────────────────────
echo -e "${YELLOW}Checking database connectivity...${NC}"

DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:/]*\).*/\1/p')
echo "  Host: $DB_HOST"

if npx prisma migrate status 2>&1 | tee /tmp/prisma_status.log; then
  echo -e "${GREEN}✓ Database is reachable${NC}"
else
  echo -e "${RED}❌ Cannot reach database${NC}"
  echo "  Check: DATABASE_URL, VPC/network, trusted sources"
  exit 1
fi

echo ""

# ─── Check Migration Status ────────────────────────────────────────────────
echo -e "${YELLOW}Checking migration status...${NC}"

STATUS_OUTPUT=$(npx prisma migrate status 2>&1) || true
PENDING_COUNT=$(echo "$STATUS_OUTPUT" | grep -c "pending" || true)
APPLIED_COUNT=$(echo "$STATUS_OUTPUT" | grep -c "applied" || true)

echo "$STATUS_OUTPUT"
echo ""

# ─── Evaluate Results ──────────────────────────────────────────────────────
if echo "$STATUS_OUTPUT" | grep -q "Database schema is up to date"; then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ Schema is up to date — safe to proceed${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
elif echo "$STATUS_OUTPUT" | grep -qi "pending"; then
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}  ❌ DRIFT DETECTED — Pending migrations exist${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "Pending migrations:"
  echo "$STATUS_OUTPUT" | grep -i "pending"
  echo ""
  echo "Action required:"
  echo "  1. Review pending migrations in prisma/migrations/"
  echo "  2. Run: npx prisma migrate deploy"
  echo "  3. Run this check again"
  exit 1
else
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}  ❌ Unknown migration status${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "Raw output:"
  echo "$STATUS_OUTPUT"
  exit 1
fi
