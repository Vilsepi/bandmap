#!/bin/bash

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <username> <password>"
  exit 1
fi

# Export environment variables from the .env file
set -a
source ../.env
set +a

USER_NAME="$1"
USER_PASSWORD="$2"
USER_ID=$(uuidgen)

CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

aws dynamodb put-item \
  --table-name bandmap-users \
  --item "{\"id\": {\"S\": \"$USER_ID\"}, \"apiKey\": {\"S\": \"$USER_PASSWORD\"}, \"name\": {\"S\": \"$USER_NAME\"}, \"createdAt\": {\"S\": \"$CREATED_AT\"}}"

