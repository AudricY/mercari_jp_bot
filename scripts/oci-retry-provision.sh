#!/usr/bin/env bash
set -euo pipefail

# --- OCI Free-Tier ARM Provisioning Retry ---
# Runs on the VPS and retries until an ARM instance is launched.
#
# First-time setup:
#   ./oci-retry-provision.sh setup
#
# Run in foreground:
#   ./oci-retry-provision.sh
#
# Run in background (survives SSH disconnect):
#   ./oci-retry-provision.sh bg
#
# Check background logs:
#   tail -f /tmp/oci-provision.log
#
# Stop background process:
#   kill "$(cat /tmp/oci-provision.pid)"

TENANCY="ocid1.tenancy.oc1..aaaaaaaaydnaapw2lgyepc4u44stshwl3qg3sbohnbp6kw4trkzd7drdke7a"
SUBNET_ID="ocid1.subnet.oc1.ap-singapore-1.aaaaaaaayuhuctorqnpmcev3qdymoowtmx2j2oywtc73ns22o2bbrcytwkpa"
AD="iHXM:AP-SINGAPORE-1-AD-1"
SSH_KEY_FILE="$HOME/.ssh/id_ed25519.pub"

ARM_IMAGE="ocid1.image.oc1.ap-singapore-1.aaaaaaaauzmcaxvcyzfmbppgh3w3cyhovjnrezpjv6tveuxkd4ri7od7fouq"

RETRY_INTERVAL=300  # 5 minutes
LOG_FILE="/tmp/oci-provision.log"
PID_FILE="/tmp/oci-provision.pid"

# Telegram notifications — DM to @audricyap via mercari bot
MERCARI_ENV="$HOME/mercari_jp_bot/.env"
if [[ -f "$MERCARI_ENV" ]]; then
  TELEGRAM_BOT_TOKEN="$(grep -oP '(?<=TELEGRAM_BOT_TOKEN=).*' "$MERCARI_ENV")"
fi
TELEGRAM_CHAT_ID="813842569"  # @audricyap

notify_telegram() {
  local msg="$1"
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="$TELEGRAM_CHAT_ID" \
      -d text="$msg" \
      -d parse_mode="Markdown" >/dev/null 2>&1 || true
  fi
}

# ── Helpers ──────────────────────────────────────────────────

ensure_oci_cli() {
  if command -v oci &>/dev/null; then
    echo "OCI CLI found: $(oci --version 2>&1 | head -1)"
    return
  fi

  echo "OCI CLI not found. Installing..."
  sudo apt-get update -qq && sudo apt-get install -y -qq python3 python3-pip curl
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)" -- \
    --accept-all-defaults

  # Add to PATH for this session
  export PATH="$HOME/bin:$PATH"

  if ! command -v oci &>/dev/null; then
    echo "ERROR: OCI CLI installation failed."
    exit 1
  fi
  echo "OCI CLI installed: $(oci --version 2>&1 | head -1)"
}

ensure_oci_config() {
  if [[ -f "$HOME/.oci/config" ]]; then
    echo "OCI config found at ~/.oci/config"
    return
  fi

  echo "No OCI config found. Running interactive setup..."
  echo "You'll need your tenancy OCID, user OCID, region, and an API key."
  echo ""
  oci setup config
}

ensure_ssh_key() {
  if [[ -f "$SSH_KEY_FILE" ]]; then
    echo "SSH key found: $SSH_KEY_FILE"
    return
  fi

  echo "SSH public key not found at $SSH_KEY_FILE"
  echo "Generating a new ed25519 key pair..."
  ssh-keygen -t ed25519 -f "${SSH_KEY_FILE%.pub}" -N "" -q
  echo "Generated: $SSH_KEY_FILE"
}

do_setup() {
  echo "=== OCI Provisioning Setup ==="
  echo ""
  ensure_oci_cli
  echo ""
  ensure_oci_config
  echo ""
  ensure_ssh_key
  echo ""
  echo "Setup complete. Run this script without arguments to start provisioning."
}

# ── Preflight checks ────────────────────────────────────────

preflight() {
  local ok=true

  if ! command -v oci &>/dev/null; then
    # Try ~/bin in case it was installed but not in PATH
    if [[ -x "$HOME/bin/oci" ]]; then
      export PATH="$HOME/bin:$PATH"
    else
      echo "ERROR: OCI CLI not installed. Run: $0 setup"
      ok=false
    fi
  fi

  if [[ ! -f "$HOME/.oci/config" ]]; then
    echo "ERROR: OCI config missing. Run: $0 setup"
    ok=false
  fi

  if [[ ! -f "$SSH_KEY_FILE" ]]; then
    echo "ERROR: SSH key missing at $SSH_KEY_FILE. Run: $0 setup"
    ok=false
  fi

  if [[ "$ok" != true ]]; then
    exit 1
  fi
}

# ── Core logic ───────────────────────────────────────────────

try_arm() {
  echo "[$(date)] Trying ARM VM.Standard.A1.Flex (1 OCPU, 6 GB)..."
  if oci compute instance launch \
    --compartment-id "$TENANCY" \
    --availability-domain "$AD" \
    --shape "VM.Standard.A1.Flex" \
    --shape-config '{"ocpus":1,"memoryInGBs":6}' \
    --image-id "$ARM_IMAGE" \
    --subnet-id "$SUBNET_ID" \
    --display-name "mercari-proxy-arm" \
    --assign-public-ip true \
    --ssh-authorized-keys-file "$SSH_KEY_FILE" \
    --query 'data.{id:id, state:"lifecycle-state", ip:"metadata"}' \
    2>&1; then
    echo ""
    echo "=== ARM instance launched! ==="
    notify_telegram "🎉 *OCI ARM instance launched!* mercari-proxy-arm is provisioning."
    rm -f "$PID_FILE"
    exit 0
  else
    echo "[$(date)] ARM: Out of capacity, will retry..."
  fi
}

run_loop() {
  echo "Starting OCI free-tier ARM provisioning retry loop..."
  echo "Retrying every ${RETRY_INTERVAL}s ($(( RETRY_INTERVAL / 60 )) min) until success."
  echo ""

  while true; do
    try_arm
    echo ""
    echo "[$(date)] Sleeping ${RETRY_INTERVAL}s before next attempt..."
    sleep "$RETRY_INTERVAL"
  done
}

# ── Entrypoint ───────────────────────────────────────────────

case "${1:-run}" in
  setup)
    do_setup
    ;;
  bg)
    preflight
    echo "Starting in background. Logs: $LOG_FILE"
    nohup bash "$0" run >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "PID: $(cat "$PID_FILE")"
    echo "Stop with: kill \"\$(cat $PID_FILE)\""
    ;;
  run)
    preflight
    run_loop
    ;;
  *)
    echo "Usage: $0 [setup|run|bg]"
    echo "  setup  — Install OCI CLI, configure credentials, generate SSH key"
    echo "  run    — Start retry loop in foreground (default)"
    echo "  bg     — Start retry loop in background (survives SSH disconnect)"
    exit 1
    ;;
esac
