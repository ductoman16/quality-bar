#!/usr/bin/env bash
set -euo pipefail

if (( $# < 2 || $# > 5 )); then
  echo "Usage: quality-bar-http.sh METHOD PATH [JSON] [--idempotency-key KEY]" >&2
  exit 2
fi

: "${QUALITY_BAR_URL:?QUALITY_BAR_URL is required}"
: "${QUALITY_BAR_ONBOARDING_TOKEN_FILE:?QUALITY_BAR_ONBOARDING_TOKEN_FILE is required}"

if [[ "$QUALITY_BAR_URL" != http://* && "$QUALITY_BAR_URL" != https://* ]]; then
  echo "QUALITY_BAR_URL must use HTTP or HTTPS" >&2
  exit 2
fi

permissions="$(stat -f '%Lp' "$QUALITY_BAR_ONBOARDING_TOKEN_FILE" 2>/dev/null || stat -c '%a' "$QUALITY_BAR_ONBOARDING_TOKEN_FILE")"
if [[ ! -f "$QUALITY_BAR_ONBOARDING_TOKEN_FILE" || ! "$permissions" =~ ^[46]00$ ]]; then
  echo "The onboarding token file must be private" >&2
  exit 2
fi

token="$(<"$QUALITY_BAR_ONBOARDING_TOKEN_FILE")"
if [[ ! "$token" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
  echo "The onboarding token file is invalid" >&2
  exit 2
fi

method="$1"
path="$2"
body="${3-}"
if [[ "$path" != /* || ( $# -gt 3 && ( "${4-}" != "--idempotency-key" || -z "${5-}" ) ) ]]; then
  echo "Request arguments are invalid" >&2
  exit 2
fi

arguments=(--fail-with-body --silent --show-error --request "$method" --header "accept: application/json" --header "authorization: Bearer $token")
if [[ -n "$body" ]]; then
  arguments+=(--header "content-type: application/json" --data "$body")
fi
if [[ -n "${5-}" ]]; then
  arguments+=(--header "idempotency-key: $5")
fi
curl "${arguments[@]}" "${QUALITY_BAR_URL%/}$path"
