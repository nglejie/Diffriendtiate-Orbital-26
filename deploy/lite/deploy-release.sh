#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/diffriendtiate}"
ENV_FILE="${ENV_FILE:-$APP_DIR/shared/.env}"
RELEASE_SHA="${1:-unknown}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SERVICE_NAME="${SERVICE_NAME:-diffriendtiate-lite}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CURRENT_LINK="$APP_DIR/current"

if [[ "$APP_DIR" != /* ]]; then
  echo "APP_DIR must be an absolute path." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Run deploy/lite/bootstrap-vm.sh first." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production env file: $ENV_FILE" >&2
  echo "Create it from deploy/lite/env.production.example and fill real values before deploying." >&2
  exit 1
fi

mkdir -p "$APP_DIR"/{backups,releases,shared}
mkdir -p "$APP_DIR/shared/data" "$APP_DIR/shared/uploads"

rm -rf "$RELEASE_DIR/apps/server/uploads"
ln -s "$APP_DIR/shared/uploads" "$RELEASE_DIR/apps/server/uploads"

previous_release=""
if [[ -L "$CURRENT_LINK" ]]; then
  previous_release="$(readlink -f "$CURRENT_LINK" || true)"
fi

write_service() {
  sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=Diffriendtiate Lite Production
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${CURRENT_LINK}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=PORT=4000
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
}

write_caddyfile() {
  if command -v caddy >/dev/null 2>&1; then
    sudo cp "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile
    sudo systemctl enable caddy >/dev/null
    sudo systemctl reload caddy || sudo systemctl restart caddy
  else
    echo "Caddy is not installed; skipping reverse proxy reload." >&2
  fi
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts="${3:-60}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl --fail --silent --show-error "$url" >/dev/null; then
      echo "$label is healthy."
      return 0
    fi
    sleep 2
  done

  echo "$label did not become healthy at $url." >&2
  return 1
}

rollback() {
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    echo "Rolling back to $previous_release"
    ln -sfn "$previous_release" "$CURRENT_LINK"
    sudo systemctl restart "$SERVICE_NAME" || true
  else
    echo "No previous release is available for rollback." >&2
  fi
}

fail_deploy() {
  local message="$1"
  echo "$message" >&2
  sudo systemctl status "$SERVICE_NAME" --no-pager || true
  sudo journalctl -u "$SERVICE_NAME" --no-pager -n 200 || true
  rollback
  exit 1
}

echo "Deploying Diffriendtiate lite release $RELEASE_SHA from $RELEASE_DIR"

echo "Installing production server dependencies..."
(cd "$RELEASE_DIR" && npm ci \
  --omit=dev \
  --workspace @diffriendtiate/server \
  --include-workspace-root=false \
  --ignore-scripts) || fail_deploy "Production dependency install failed."

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

write_service
write_caddyfile
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" >/dev/null
sudo systemctl restart "$SERVICE_NAME" || fail_deploy "Service failed to start."

wait_for_url "http://127.0.0.1:4000/api/health" "API" 60 || fail_deploy "API health check failed."
wait_for_url "http://127.0.0.1:4000/" "Client" 60 || fail_deploy "Client health check failed."
if command -v caddy >/dev/null 2>&1; then
  wait_for_url "http://127.0.0.1/api/health" "Caddy reverse proxy" 30 || fail_deploy "Caddy health check failed."
fi

echo "Lite release $RELEASE_SHA is healthy."

if [[ "$KEEP_RELEASES" =~ ^[0-9]+$ && "$KEEP_RELEASES" -gt 0 ]]; then
  current_realpath="$(readlink -f "$CURRENT_LINK")"
  mapfile -t old_releases < <(
    find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
      sort -rn |
      awk -v keep="$KEEP_RELEASES" 'NR > keep { $1=""; sub(/^ /, ""); print }'
  )
  for old_release in "${old_releases[@]}"; do
    old_realpath="$(readlink -f "$old_release")"
    if [[ "$old_realpath" == "$current_realpath" ]]; then
      continue
    fi
    rm -rf -- "$old_release"
  done
fi
