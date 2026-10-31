#!/usr/bin/env bash
# =============================================================================
# TRUSTPAY — Doppler Secret Manager Setup
# =============================================================================
# Sets up Doppler project with staging + production configs.
# Run once per machine. Requires Doppler CLI installed.
#
# Usage:
#   chmod +x scripts/setup-secrets.sh
#   ./scripts/setup-secrets.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  TRUSTPAY — Doppler Secret Manager Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ─── Check/Install Doppler CLI ──────────────────────────────────────────────
if ! command -v doppler &> /dev/null; then
  echo -e "${YELLOW}Doppler CLI not found. Installing...${NC}"
  if command -v brew &> /dev/null; then
    brew install dopplerhq/cli/doppler
  else
    echo -e "${RED}Please install Doppler CLI manually:${NC}"
    echo "  macOS: brew install dopplerhq/cli/doppler"
    echo "  Linux: curl -sL https://cli.doppler.com/install.sh | sh"
    exit 1
  fi
fi

echo -e "${GREEN}✓ Doppler CLI $(doppler --version | head -1)${NC}"
echo ""

# ─── Authenticate ──────────────────────────────────────────────────────────
echo -e "${YELLOW}Authenticating with Doppler...${NC}"
echo "A browser window will open. Log in or create an account."
doppler login
echo -e "${GREEN}✓ Authenticated${NC}"
echo ""

# ─── Create Project ────────────────────────────────────────────────────────
PROJECT="trustpay"
echo -e "${YELLOW}Creating Doppler project: ${PROJECT}${NC}"
doppler projects create "$PROJECT" 2>/dev/null || echo "Project already exists (continuing...)"
echo -e "${GREEN}✓ Project ready${NC}"
echo ""

# ─── Create Environments ───────────────────────────────────────────────────
for ENV in staging production; do
  echo -e "${YELLOW}Creating environment: ${ENV}${NC}"
  doppler environments create "$ENV" --project "$PROJECT" 2>/dev/null || echo "  Already exists (continuing...)"
done
echo -e "${GREEN}✓ Environments ready${NC}"
echo ""

# ─── Generate Application Keys ─────────────────────────────────────────────
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Generating cryptographic keys...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}Unique values will be generated for each environment and written directly to Doppler.${NC}"
echo ""

# ─── Set Critical Secrets ─────────────────────────────────────────────────
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Setting secrets in Doppler...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

set_secret() {
  local key="$1"
  local value="$2"
  local config="$3"
  echo -e "  Setting ${key} in ${config}..."
  doppler secrets set "$key=$value" --project "$PROJECT" --config "$config" --silent 2>/dev/null || \
    echo -e "  ${YELLOW}Warning: Could not set $key (may need manual configuration)${NC}"
}

for CONFIG in staging production; do
  echo -e "${YELLOW}Configuring ${CONFIG} environment...${NC}"

  # Generate independent values for every environment. Values are never
  # printed; Doppler is the system of record.
  JWT_SECRET=$(openssl rand -base64 48)
  JWT_REFRESH_SECRET=$(openssl rand -base64 48)
  PII_KEY=$(openssl rand -hex 32)
  BANK_KEY=$(openssl rand -hex 32)

  # Application
  set_secret "NODE_ENV" "$CONFIG" "$CONFIG"
  set_secret "PORT" "3000" "$CONFIG"

  # JWT
  set_secret "JWT_SECRET" "$JWT_SECRET" "$CONFIG"
  set_secret "JWT_REFRESH_SECRET" "$JWT_REFRESH_SECRET" "$CONFIG"

  # Encryption
  set_secret "PII_ENCRYPTION_KEY" "$PII_KEY" "$CONFIG"
  set_secret "BANK_ACCOUNT_ENCRYPTION_KEY" "$BANK_KEY" "$CONFIG"

  # Feature flags
  set_secret "TRANSACTION_PIN_REQUIRED" "true" "$CONFIG"
  set_secret "ENABLE_SWAGGER" "false" "$CONFIG"
  set_secret "BANKING_SANDBOX_MODE" "$([ "$CONFIG" = "production" ] && echo "false" || echo "true")" "$CONFIG"
  set_secret "BANKING_ENABLED" "true" "$CONFIG"
  set_secret "VIRTUAL_ACCOUNTS_ENABLED" "true" "$CONFIG"

  echo ""
done

# ─── Verify ────────────────────────────────────────────────────────────────
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Verifying setup...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}Staging secrets:${NC}"
doppler secrets list --project "$PROJECT" --config staging || echo "  (run after setting all secrets)"

echo ""
echo -e "${YELLOW}Production secrets:${NC}"
doppler secrets list --project "$PROJECT" --config production || echo "  (run after setting all secrets)"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "  1. Add deployment and provider secrets in the Doppler dashboard:"
echo "     https://dashboard.doppler.com/projects/${PROJECT}"
echo ""
echo "  2. Supply real, environment-specific values for:"
echo "     - PAYSTACK_SECRET_KEY (primary payments and KYC)"
echo "     - VTPASS_API_KEY / VTPASS_PUBLIC_KEY / VTPASS_SECRET_KEY / VTPASS_WEBHOOK_SECRET"
echo "     - Paystack dashboard webhook: /api/webhooks/paystack"
echo "     - SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY"
echo "     - DATABASE_URL / REDIS_URL"
echo "     - WEB_URL / ADMIN_URL / provider webhook URLs"
echo ""
echo "  3. Generate a Doppler Service Token for CI/CD:"
echo "     doppler configs tokens create --project ${PROJECT} --config staging"
echo "     doppler configs tokens create --project ${PROJECT} --config production"
echo ""
echo "  4. Add DOPPLER_TOKEN to GitHub Actions secrets"
echo ""
echo "  5. Run the backend with Doppler:"
echo "     doppler run --config staging -- npm run start:dev"
echo ""
echo -e "${RED}⚠️  IMPORTANT: Do not enable financial features until production config validation passes.${NC}"
