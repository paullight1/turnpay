#!/usr/bin/env bash
# =============================================================================
# TRUSTPAY — Database Backup Script
# =============================================================================
# Creates compressed, timestamped pg_dump backups.
# Designed to run as a cron job for additional backup coverage beyond
# the managed database's automated daily backups.
#
# Usage:
#   chmod +x BACKEND/scripts/backup-db.sh
#   DATABASE_URL="postgresql://..." ./BACKEND/scripts/backup-db.sh
#
# Cron (runs every 6 hours):
#   0 */6 * * * /path/to/TRUSTPAY/BACKEND/scripts/backup-db.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ─── Configuration ─────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/tmp/trustpay-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
BACKUP_FILE="${BACKUP_DIR}/trustpay_db_${TIMESTAMP}.sql.gz"

# ─── Validate ──────────────────────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "${RED}❌ DATABASE_URL is not set${NC}"
  echo "Usage: DATABASE_URL=\"postgresql://...\" $0"
  exit 1
fi

# ─── Parse DATABASE_URL ───────────────────────────────────────────────────
# Extract components from: postgresql://USER:PASS@HOST:PORT/DB?params
DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-trustpay_db}"

# ─── Create Backup Directory ───────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

# ─── Run Backup ────────────────────────────────────────────────────────────
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  TRUSTPAY — Database Backup${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Timestamp: $TIMESTAMP"
echo "  Host:      $DB_HOST:$DB_PORT"
echo "  Database:  $DB_NAME"
echo "  Output:    $BACKUP_FILE"
echo ""

# Export password for pg_dump
export PGPASSWORD="$DB_PASS"

echo -e "${YELLOW}Running pg_dump...${NC}"

if pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-owner \
  --no-acl \
  --format=custom \
  --compress=9 \
  --file="$BACKUP_FILE" \
  2>&1; then

  # ─── Verify Backup ──────────────────────────────────────────────────────
  BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
  echo ""
  echo -e "${GREEN}✓ Backup completed successfully${NC}"
  echo "  File: $BACKUP_FILE"
  echo "  Size: $BACKUP_SIZE"

  # Verify the backup is valid by listing its contents
  if pg_restore --list "$BACKUP_FILE" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backup verified (pg_restore list succeeded)${NC}"
  else
    echo -e "${RED}❌ Backup verification failed — file may be corrupt${NC}"
    exit 1
  fi

else
  echo -e "${RED}❌ Backup failed${NC}"
  exit 1
fi

# ─── Cleanup Old Backups ───────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Cleaning up backups older than ${RETENTION_DAYS} days...${NC}"

DELETED_COUNT=$(find "$BACKUP_DIR" -name "trustpay_db_*.sql.gz" -mtime "+$RETENTION_DAYS" -delete -print | wc -l)
echo "  Deleted: $DELETED_COUNT old backup(s)"

# ─── Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Backup rotation summary${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "trustpay_db_*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | awk '{print $1}')

echo "  Location:     $BACKUP_DIR"
echo "  Total backups: $TOTAL_BACKUPS"
echo "  Total size:    $TOTAL_SIZE"
echo "  Retention:     $RETENTION_DAYS days"
echo ""

# ─── Restore Instructions ──────────────────────────────────────────────────
echo -e "${YELLOW}To restore from this backup:${NC}"
echo ""
echo "  # 1. Drop and recreate the database (if needed):"
echo "  dropdb --host=HOST --port=PORT --username=USER DB_NAME"
echo "  createdb --host=HOST --port=PORT --username=USER DB_NAME"
echo ""
echo "  # 2. Restore:"
echo "  pg_restore \\"
echo "    --host=HOST \\"
echo "    --port=PORT \\"
echo "    --username=USER \\"
echo "    --dbname=DB_NAME \\"
echo "    --no-owner \\"
echo "    --no-acl \\"
echo "    $BACKUP_FILE"
echo ""
echo "  # 3. Run migrations (idempotent, ensures schema is current):"
echo "  DATABASE_URL=\"...\" npx prisma migrate deploy"
echo ""

# ─── Cleanup ───────────────────────────────────────────────────────────────
unset PGPASSWORD
