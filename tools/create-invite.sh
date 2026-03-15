#!/bin/bash
set -euo pipefail

# Creates a new invite code.

# Log in as an admin, open browser developer tools, inspect the stored cookies
# for music.heap.fi, and copy the sessionToken field from the cookie.

if [[ -z "${BANDMAP_SESSION_TOKEN:-}" ]]; then
	read -rsp "BANDMAP_SESSION_TOKEN: " BANDMAP_SESSION_TOKEN
	printf '\n'
fi

if [[ -z "$BANDMAP_SESSION_TOKEN" ]]; then
	echo "BANDMAP_SESSION_TOKEN is required" >&2
	exit 1
fi

VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.music.heap.fi}"

curl -X POST "$VITE_API_BASE_URL/invites" -H "Content-Type: application/json" -H "Authorization: Bearer $BANDMAP_SESSION_TOKEN" -d '{"count": 1}'
