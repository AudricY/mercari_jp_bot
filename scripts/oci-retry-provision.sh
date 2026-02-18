#!/usr/bin/env bash
set -euo pipefail

TENANCY="ocid1.tenancy.oc1..aaaaaaaaydnaapw2lgyepc4u44stshwl3qg3sbohnbp6kw4trkzd7drdke7a"
SUBNET_ID="ocid1.subnet.oc1.ap-singapore-1.aaaaaaaayuhuctorqnpmcev3qdymoowtmx2j2oywtc73ns22o2bbrcytwkpa"
AD="iHXM:AP-SINGAPORE-1-AD-1"
SSH_KEY_FILE="$HOME/.ssh/id_ed25519.pub"

ARM_IMAGE="ocid1.image.oc1.ap-singapore-1.aaaaaaaauzmcaxvcyzfmbppgh3w3cyhovjnrezpjv6tveuxkd4ri7od7fouq"

RETRY_INTERVAL=300  # 5 minutes

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
    exit 0
  else
    echo "[$(date)] ARM: Out of capacity, will retry..."
  fi
}

echo "Starting OCI free-tier ARM provisioning retry loop..."
echo "Retrying every ${RETRY_INTERVAL}s ($(( RETRY_INTERVAL / 60 )) min) until success."
echo "Press Ctrl+C to stop."
echo ""

while true; do
  try_arm
  echo ""
  echo "[$(date)] Sleeping ${RETRY_INTERVAL}s before next attempt..."
  sleep "$RETRY_INTERVAL"
done
