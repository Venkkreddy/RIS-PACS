# TDAI GCP VM Deployment Guide

## Quick Overview

| Step | Script | Where to Run | Time |
|------|--------|-------------|------|
| 1-2  | `01-create-vm-and-firewall.sh` | Your local machine | 2 min |
| 3    | `02-install-docker.sh` | On the VM (via SSH) | 3 min |
| 4    | Upload project files | Your local machine | 5-10 min |
| 5    | `03-configure-env.sh` | On the VM | 1 min |
| 6    | `04-start-services.sh` | On the VM | 10-20 min |
| 7    | Verify in browser | Your browser | 1 min |
| 8    | `05-setup-nginx.sh` (optional) | On the VM | 2 min |
| 9    | `06-auto-restart.sh` | On the VM | 1 min |

## Recommended VM: e2-standard-4

- 4 vCPU, 16 GB RAM, 100 GB SSD
- Ubuntu 22.04 LTS
- Estimated cost: ~$107-120/month

## Step-by-Step

### 1. Create VM + Firewall (from your local machine)

```bash
# Install gcloud CLI if not installed: https://cloud.google.com/sdk/docs/install
bash deploy/01-create-vm-and-firewall.sh YOUR_GCP_PROJECT_ID
```

### 2. Upload project to VM

```bash
gcloud compute scp --recurse . tdai-server:~/tdai --zone=us-central1-a
```

### 3. SSH into VM and install Docker

```bash
gcloud compute ssh tdai-server --zone=us-central1-a

# On the VM:
sudo bash ~/tdai/deploy/02-install-docker.sh
# Log out and back in for docker group to take effect
exit
gcloud compute ssh tdai-server --zone=us-central1-a
```

### 4. Configure environment

```bash
cd ~/tdai
bash deploy/03-configure-env.sh YOUR_STATIC_IP

# Edit .env to add your real API keys:
nano .env
```

### 5. Start all services

```bash
bash deploy/04-start-services.sh
```

### 6. Verify in browser

- Frontend: `http://YOUR_IP:5173`
- Backend: `http://YOUR_IP:8081`
- OHIF: `http://YOUR_IP:3000`
- Dicoogle: `http://YOUR_IP:8080`

### 7. (Optional) Nginx reverse proxy

```bash
sudo bash deploy/05-setup-nginx.sh YOUR_IP_OR_DOMAIN
```

### 8. Auto-restart on reboot

```bash
bash deploy/06-auto-restart.sh
```

## HIPAA Compliance Checklist (Production)

Before deploying with PHI, verify:

- [ ] `NODE_ENV=production` is set
- [ ] `ENABLE_AUTH=true` is set
- [ ] `CORS_ALLOW_ALL=false` (enforced in production regardless)
- [ ] `SESSION_SECRET` is a strong, unique 32+ character value
- [ ] `JWT_SECRET` is a strong, unique 32+ character value
- [ ] `HIPAA_AUDIT_ENABLED=true` is set
- [ ] `HIPAA_REQUIRE_HTTPS=true` is set
- [ ] TLS/HTTPS enabled on all endpoints (load balancer + application)
- [ ] All default passwords and secrets are changed
- [ ] Master admin emails configured in `MASTER_ADMIN_EMAILS`
- [ ] BAA signed with Google Cloud/Firebase
- [ ] BAA signed with SendGrid (if sending PHI via email)

### HIPAA Environment Variables

Add to your `.env`:

```env
HIPAA_AUDIT_ENABLED=true
HIPAA_SESSION_TIMEOUT_MINUTES=15
HIPAA_MAX_FAILED_LOGINS=5
HIPAA_LOCKOUT_DURATION_MINUTES=30
HIPAA_REQUIRE_HTTPS=true
HIPAA_MIN_PASSWORD_LENGTH=12
```

See [`HIPAA_COMPLIANCE.md`](../HIPAA_COMPLIANCE.md) for full deployment checklist and compliance documentation.

## Troubleshooting

```bash
docker compose ps              # check container status
docker compose logs -f         # watch all logs
docker compose logs <service>  # watch one service
docker compose restart <svc>   # restart a service
docker system prune -a         # free disk space
```
