#!/usr/bin/env bash
#
# Step 8 (Optional): Set up Nginx reverse proxy so everything is
# accessible on port 80 with clean paths.
# Run this ON THE VM.
#
# Usage:
#   sudo bash deploy/05-setup-nginx.sh [DOMAIN_OR_IP]
#
set -euo pipefail

DOMAIN="${1:-_}"

# Auto-detect public IP if no domain provided
if [ "${DOMAIN}" = "_" ]; then
  VM_IP=$(curl -sf http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google" 2>/dev/null || echo "_")
  DOMAIN="${VM_IP}"
fi

echo "==> Installing Nginx..."
apt-get update
apt-get install -y nginx

echo "==> Writing Nginx config for: ${DOMAIN}"
cat > /etc/nginx/sites-available/tdai << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 500M;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    # Reporting Frontend (default)
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8081/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # OHIF Viewer
    location /ohif/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Dicoogle PACS
    location /dicoogle/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINXEOF

echo "==> Enabling site..."
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/tdai /etc/nginx/sites-enabled/tdai

echo "==> Testing Nginx config..."
nginx -t

echo "==> Restarting Nginx..."
systemctl enable nginx
systemctl restart nginx

echo ""
echo "============================================"
echo " Nginx reverse proxy configured!"
echo "============================================"
echo ""
echo "Access points:"
echo "  http://${DOMAIN}/         -> Frontend"
echo "  http://${DOMAIN}/api/     -> Backend API"
echo "  http://${DOMAIN}/ohif/    -> OHIF Viewer"
echo "  http://${DOMAIN}/dicoogle/-> Dicoogle PACS"
echo ""
echo "For HTTPS with a domain, run:"
echo "  sudo apt install -y certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d yourdomain.com"
