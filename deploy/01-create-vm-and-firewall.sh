#!/usr/bin/env bash
#
# Step 1 & 2: Create GCP VM + firewall rules.
# Run this from YOUR LOCAL machine (where gcloud CLI is installed).
#
# Usage:
#   chmod +x deploy/01-create-vm-and-firewall.sh
#   ./deploy/01-create-vm-and-firewall.sh <YOUR_GCP_PROJECT_ID> [REGION] [ZONE]
#
set -euo pipefail

PROJECT_ID="${1:?Usage: $0 <GCP_PROJECT_ID> [REGION] [ZONE]}"
REGION="${2:-us-central1}"
ZONE="${3:-${REGION}-a}"
VM_NAME="tdai-server"
IP_NAME="tdai-ip"
TAG="tdai-web"

echo "==> Setting GCP project to: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

echo "==> Reserving static IP '${IP_NAME}' in ${REGION}..."
if gcloud compute addresses describe "${IP_NAME}" --region="${REGION}" &>/dev/null; then
  echo "    Static IP '${IP_NAME}' already exists."
else
  gcloud compute addresses create "${IP_NAME}" --region="${REGION}"
fi

STATIC_IP=$(gcloud compute addresses describe "${IP_NAME}" \
  --region="${REGION}" --format='get(address)')
echo "==> Static IP: ${STATIC_IP}"

echo "==> Creating VM '${VM_NAME}' in ${ZONE}..."
if gcloud compute instances describe "${VM_NAME}" --zone="${ZONE}" &>/dev/null; then
  echo "    VM '${VM_NAME}' already exists. Skipping creation."
else
  gcloud compute instances create "${VM_NAME}" \
    --zone="${ZONE}" \
    --machine-type=e2-standard-4 \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=100GB \
    --boot-disk-type=pd-balanced \
    --address="${IP_NAME}" \
    --tags="${TAG}"
fi

echo "==> Creating firewall rule for HTTP/HTTPS (ports 80, 443)..."
if gcloud compute firewall-rules describe allow-tdai-web &>/dev/null; then
  echo "    Rule 'allow-tdai-web' already exists."
else
  gcloud compute firewall-rules create allow-tdai-web \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:80,tcp:443 \
    --source-ranges=0.0.0.0/0 \
    --target-tags="${TAG}"
fi

echo "==> Creating firewall rule for app service ports..."
if gcloud compute firewall-rules describe allow-tdai-services &>/dev/null; then
  echo "    Rule 'allow-tdai-services' already exists."
else
  gcloud compute firewall-rules create allow-tdai-services \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:3000,tcp:5173,tcp:8080,tcp:8081,tcp:5000,tcp:5001 \
    --source-ranges=0.0.0.0/0 \
    --target-tags="${TAG}"
fi

echo ""
echo "============================================"
echo " VM created successfully!"
echo " Static IP : ${STATIC_IP}"
echo " Zone      : ${ZONE}"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. SSH into the VM:"
echo "     gcloud compute ssh ${VM_NAME} --zone=${ZONE}"
echo ""
echo "  2. Upload this project to the VM:"
echo "     gcloud compute scp --recurse . ${VM_NAME}:~/tdai --zone=${ZONE}"
echo ""
echo "  3. On the VM, run: bash ~/tdai/deploy/02-install-docker.sh"
echo "  4. Then run:       bash ~/tdai/deploy/03-configure-env.sh ${STATIC_IP}"
echo "  5. Then run:       bash ~/tdai/deploy/04-start-services.sh"
