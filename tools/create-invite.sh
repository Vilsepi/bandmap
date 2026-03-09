#!/bin/bash
set -euo pipefail

# Use the value stored in localStorage under bandmap-session.sessionToken.
# This backend expects the Cognito ID token, not the access token or refresh token.
# If you were added to the admin group after logging in, sign in again first.

# export BANDMAP_SESSION_TOKEN="..."

curl -X POST "$VITE_API_BASE_URL/invites" -H "Content-Type: application/json" -H "Authorization: Bearer $BANDMAP_SESSION_TOKEN" -d '{"count": 1}'
