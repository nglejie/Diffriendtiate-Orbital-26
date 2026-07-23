#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/diffriendtiate}"
ENV_FILE="${ENV_FILE:-$APP_DIR/shared/.env}"
RELEASE_SHA="${1:-unknown}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SERVICE_NAME="${SERVICE_NAME:-diffriendtiate-lite}"
CHATBOT_SERVICE_NAME="${CHATBOT_SERVICE_NAME:-diffriendtiate-chatbot}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CURRENT_LINK="$APP_DIR/current"

if [[ "$APP_DIR" != /* ]]; then
  echo "APP_DIR must be an absolute path." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production env file: $ENV_FILE" >&2
  echo "Create it from deploy/lite/env.production.example and fill real values before deploying." >&2
  exit 1
fi

read_env_file_value() {
  local key="$1"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      sub(/^[[:space:]]*[^=]+=[[:space:]]*/, "", $0)
      sub(/\r$/, "", $0)
      if (($0 ~ /^".*"$/) || ($0 ~ /^\047.*\047$/)) {
        $0 = substr($0, 2, length($0) - 2)
      }
      value = $0
    }
    END {
      if (value != "") {
        print value
      }
    }
  ' "$ENV_FILE"
}

export VITE_SUPABASE_URL
export SUPABASE_URL
export VITE_SUPABASE_ANON_KEY
export SUPABASE_ANON_KEY
export SUPABASE_SERVICE_ROLE_KEY
export SMTP_URL
export SMTP_HOST
export AUTH_EMAIL_FROM
export SMTP_FROM

VITE_SUPABASE_URL="$(read_env_file_value VITE_SUPABASE_URL)"
SUPABASE_URL="$(read_env_file_value SUPABASE_URL)"
VITE_SUPABASE_ANON_KEY="$(read_env_file_value VITE_SUPABASE_ANON_KEY)"
SUPABASE_ANON_KEY="$(read_env_file_value SUPABASE_ANON_KEY)"
SUPABASE_SERVICE_ROLE_KEY="$(read_env_file_value SUPABASE_SERVICE_ROLE_KEY)"
SMTP_URL="$(read_env_file_value SMTP_URL)"
SMTP_HOST="$(read_env_file_value SMTP_HOST)"
AUTH_EMAIL_FROM="$(read_env_file_value AUTH_EMAIL_FROM)"
SMTP_FROM="$(read_env_file_value SMTP_FROM)"

bash "$SCRIPT_DIR/validate-production-env.sh"

if [[ "${DEPLOY_VALIDATE_ONLY:-}" == "1" ]]; then
  echo "Deployment env validation completed."
  exit 0
fi

client_supabase_url="$VITE_SUPABASE_URL"
if [[ -n "$client_supabase_url" ]]; then
  if ! grep -R --fixed-strings "$client_supabase_url" "$RELEASE_DIR/apps/client/dist/assets" >/dev/null; then
    echo "Client bundle was built without the configured VITE_SUPABASE_URL." >&2
    echo "Rebuild the client with the production VITE_SUPABASE_* environment." >&2
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Run deploy/lite/bootstrap-vm.sh first." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Run deploy/lite/bootstrap-vm.sh first." >&2
  exit 1
fi

mkdir -p "$APP_DIR"/{backups,releases,shared}
mkdir -p "$APP_DIR/shared/data" "$APP_DIR/shared/uploads" "$APP_DIR/shared/chroma" "$APP_DIR/shared/logs"

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
After=network-online.target ${CHATBOT_SERVICE_NAME}.service
Wants=network-online.target ${CHATBOT_SERVICE_NAME}.service

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

write_chatbot_service() {
  sudo tee "/etc/systemd/system/${CHATBOT_SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=Diffriendtiate Intelligrate Chatbot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${CURRENT_LINK}/services/server-chatbot
EnvironmentFile=${ENV_FILE}
Environment=GPU_ENABLED=false
Environment=INTELLIGRATE_GPU_ENABLED=false
Environment=PYTHONUNBUFFERED=1
ExecStart=${APP_DIR}/shared/chatbot-venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 5000
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
    public_base_url="$(read_env_file_value OAUTH_PUBLIC_BASE_URL)"
    if [[ -z "$public_base_url" ]]; then
      public_base_url="$(read_env_file_value PUBLIC_APP_URL)"
    fi
    if [[ -z "$public_base_url" ]]; then
      public_base_url="$(read_env_file_value APP_PUBLIC_URL)"
    fi
    if [[ -z "$public_base_url" ]]; then
      echo "Missing OAUTH_PUBLIC_BASE_URL/PUBLIC_APP_URL/APP_PUBLIC_URL for Caddy." >&2
      return 1
    fi

    public_host="$(
      python3 - "$public_base_url" <<'PY'
import sys
from urllib.parse import urlparse

value = sys.argv[1].strip()
if "://" not in value:
    value = "https://" + value
parsed = urlparse(value)
host = parsed.netloc or parsed.path
host = host.split("@")[-1].split("/")[0]
if not host:
    raise SystemExit(1)
print(host)
PY
    )"

    sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
${public_host} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:4000
}

http://${public_host} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:4000
}
EOF
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
    sudo systemctl restart "$CHATBOT_SERVICE_NAME" || true
    sudo systemctl restart "$SERVICE_NAME" || true
  else
    echo "No previous release is available for rollback." >&2
  fi
}

fail_deploy() {
  local message="$1"
  echo "$message" >&2
  sudo systemctl status "$CHATBOT_SERVICE_NAME" --no-pager || true
  sudo systemctl status "$SERVICE_NAME" --no-pager || true
  sudo journalctl -u "$CHATBOT_SERVICE_NAME" --no-pager -n 200 || true
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

echo "Installing chatbot dependencies..."
python3 -m venv "$APP_DIR/shared/chatbot-venv" || fail_deploy "Chatbot virtualenv setup failed."
"$APP_DIR/shared/chatbot-venv/bin/python" -m pip install --upgrade pip >/dev/null || fail_deploy "Chatbot pip upgrade failed."
"$APP_DIR/shared/chatbot-venv/bin/python" -m pip install --no-cache-dir -r "$RELEASE_DIR/services/server-chatbot/requirements.txt" || fail_deploy "Chatbot dependency install failed."

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

write_chatbot_service
write_service
write_caddyfile
sudo systemctl daemon-reload
sudo systemctl enable "$CHATBOT_SERVICE_NAME" >/dev/null
sudo systemctl enable "$SERVICE_NAME" >/dev/null
sudo systemctl restart "$CHATBOT_SERVICE_NAME" || fail_deploy "Chatbot service failed to start."
wait_for_url "http://127.0.0.1:5000/health" "Chatbot" 90 || fail_deploy "Chatbot health check failed."
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
