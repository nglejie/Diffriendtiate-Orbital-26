#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/diffriendtiate}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"

if [[ "$APP_DIR" != /* ]]; then
  echo "APP_DIR must be an absolute path." >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "This bootstrap script expects sudo to be available." >&2
  exit 1
fi

if [[ -f /etc/apt/sources.list.d/caddy-stable.list && ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
  sudo rm -f /etc/apt/sources.list.d/caddy-stable.list
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg ufw

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  sudo install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt |
  sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
fi

sudo install -d -m 0755 -o "$USER" -g "$USER" "$APP_DIR"
install -d -m 0755 "$APP_DIR/releases" "$APP_DIR/shared" "$APP_DIR/backups"
install -d -m 0755 "$APP_DIR/shared/data" "$APP_DIR/shared/uploads"

if [[ "$SWAP_SIZE_GB" =~ ^[0-9]+$ && "$SWAP_SIZE_GB" -gt 0 && ! -f /swapfile ]]; then
  sudo fallocate -l "${SWAP_SIZE_GB}G" /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
fi

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

cat <<EOF
Lite VM bootstrap complete.

Next:
  1. Create $APP_DIR/shared/.env from deploy/lite/env.production.example.
  2. Add GitHub Actions secrets LITE_SSH_HOST, LITE_SSH_USER, and LITE_SSH_PRIVATE_KEY.
  3. Run the Deploy Lite Production workflow.
EOF
