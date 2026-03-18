#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

run_user() {
  local email="$1"
  echo ""
  echo "==> Running hosted phase smoke for ${email}"
  VITE_DEV_AUTO_SIGNIN_EMAIL="$email" \
  VITE_DEV_AUTO_SIGNIN_OTP="424242" \
  ONESHOT_E2E_RESET_USER_DATA=1 \
  npm run test:e2e:electron -- tests/electron/openclaw-hosted-phase.smoke.spec.ts
}

run_user "test+clerk_test@test.com"
run_user "narya+clerk_test@test.com"

echo ""
echo "Hosted phase smoke completed for both Clerk test users."
