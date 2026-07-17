#!/usr/bin/env bash
set -Eeuo pipefail

has_supabase_auth() {
  [[ -n "${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}" ]] &&
    [[ -n "${VITE_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:-}}" ]]
}

is_local_smtp_target() {
  local value="${1,,}"
  [[ "$value" == *mailpit* ]] ||
    [[ "$value" == localhost* ]] ||
    [[ "$value" == 127.0.0.1* ]] ||
    [[ "$value" == "[::1]"* ]]
}

has_real_smtp() {
  if [[ -n "${SMTP_URL:-}" ]]; then
    ! is_local_smtp_target "$SMTP_URL"
    return
  fi

  [[ -n "${SMTP_HOST:-}" ]] &&
    [[ -n "${AUTH_EMAIL_FROM:-${SMTP_FROM:-}}" ]] &&
    ! is_local_smtp_target "$SMTP_HOST"
}

if has_supabase_auth; then
  if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    cat >&2 <<'EOF'
Production Supabase Auth is missing SUPABASE_SERVICE_ROLE_KEY.

The server needs the Supabase service-role key to delete Supabase Auth users
when a member deletes their Diffriendtiate account. Without it, production can
leave orphaned auth users behind.
EOF
    exit 1
  fi

  echo "Production auth check passed: Supabase Auth client and server admin env is configured."
  exit 0
fi

if has_real_smtp; then
  echo "Production auth check passed: built-in auth has a non-local SMTP target."
  exit 0
fi

cat >&2 <<'EOF'
Production auth is not configured safely.

Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY
for Supabase Auth, or set a real SMTP_URL/SMTP_HOST for built-in auth.
Local/dev mail targets such as mailpit, localhost, and 127.0.0.1 are
intentionally rejected for lite production deployments.
EOF
exit 1
