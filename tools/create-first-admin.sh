#!/bin/bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash tools/create-first-admin.sh --username USERNAME --password PASSWORD [options]

Options:
  --username USERNAME     Username for the first admin user
  --password PASSWORD     Permanent password for the first admin user
  --region REGION         AWS region override; defaults to AWS_REGION or AWS CLI config
  --stack-name NAME       CloudFormation stack name; defaults to BandmapBackendStack
  --user-pool-id ID       Cognito user pool id override; if omitted, resolved from stack outputs
  --users-table NAME      DynamoDB users table name; defaults to bandmap-users
  --group-name NAME       Cognito admin group name; defaults to admin
  --help                  Show this help text

Environment variables accepted as defaults:
  AWS_REGION, STACK_NAME, USER_POOL_ID, USERS_TABLE, GROUP_NAME
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

resolve_region() {
  if [[ -n "${AWS_REGION:-}" ]]; then
    printf '%s\n' "$AWS_REGION"
    return
  fi

  local configured_region
  configured_region="$(aws configure get region 2>/dev/null || true)"
  if [[ -n "$configured_region" ]]; then
    printf '%s\n' "$configured_region"
    return
  fi

  echo "AWS region is required. Set AWS_REGION or pass --region." >&2
  exit 1
}

generate_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen
    return
  fi

  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
    return
  fi

  echo "Unable to generate UUID. Install uuidgen or provide /proc/sys/kernel/random/uuid." >&2
  exit 1
}

resolve_user_pool_id() {
  local user_pool_id
  user_pool_id="$(aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue | [0]" \
    --output text)"

  if [[ -z "$user_pool_id" || "$user_pool_id" == "None" ]]; then
    echo "Unable to resolve Cognito user pool id from stack $STACK_NAME." >&2
    echo "Pass --user-pool-id explicitly or deploy the backend stack first." >&2
    exit 1
  fi

  printf '%s\n' "$user_pool_id"
}

ensure_group_exists() {
  if aws cognito-idp get-group \
    --region "$REGION" \
    --user-pool-id "$USER_POOL_ID" \
    --group-name "$GROUP_NAME" >/dev/null 2>&1; then
    return
  fi

  echo "Creating Cognito group $GROUP_NAME..."
  aws cognito-idp create-group \
    --region "$REGION" \
    --user-pool-id "$USER_POOL_ID" \
    --group-name "$GROUP_NAME" \
    --description "Bandmap administrators allowed to create invite links" >/dev/null
}

ensure_user_does_not_exist() {
  if aws cognito-idp admin-get-user \
    --region "$REGION" \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME" >/dev/null 2>&1; then
    echo "Cognito user $USERNAME already exists in user pool $USER_POOL_ID." >&2
    exit 1
  fi

  local existing_user_id
  existing_user_id="$(aws dynamodb scan \
    --region "$REGION" \
    --table-name "$USERS_TABLE" \
    --filter-expression "username = :username" \
    --expression-attribute-values '{":username":{"S":"'"$USERNAME"'"}}' \
    --projection-expression "id" \
    --query 'Items[0].id.S' \
    --output text)"

  if [[ -n "$existing_user_id" && "$existing_user_id" != "None" ]]; then
    echo "Users table $USERS_TABLE already contains username $USERNAME (id $existing_user_id)." >&2
    exit 1
  fi
}

USERNAME=""
PASSWORD=""
REGION=""
STACK_NAME="${STACK_NAME:-BandmapBackendStack}"
USER_POOL_ID="${USER_POOL_ID:-}"
USERS_TABLE="${USERS_TABLE:-bandmap-users}"
GROUP_NAME="${GROUP_NAME:-admin}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --username)
      USERNAME="${2:-}"
      shift 2
      ;;
    --password)
      PASSWORD="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --stack-name)
      STACK_NAME="${2:-}"
      shift 2
      ;;
    --user-pool-id)
      USER_POOL_ID="${2:-}"
      shift 2
      ;;
    --users-table)
      USERS_TABLE="${2:-}"
      shift 2
      ;;
    --group-name)
      GROUP_NAME="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
  echo "Both --username and --password are required." >&2
  usage >&2
  exit 1
fi

require_command aws

if [[ -z "$REGION" ]]; then
  REGION="$(resolve_region)"
fi

if [[ -z "$USER_POOL_ID" ]]; then
  USER_POOL_ID="$(resolve_user_pool_id)"
fi

ensure_user_does_not_exist
ensure_group_exists

APP_USER_ID="$(generate_uuid)"
CREATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

echo "Creating Cognito user $USERNAME in $USER_POOL_ID..."
aws cognito-idp admin-create-user \
  --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --temporary-password "$PASSWORD" \
  --message-action SUPPRESS \
  --user-attributes Name=custom:app_user_id,Value="$APP_USER_ID" >/dev/null

echo "Setting permanent password..."
aws cognito-idp admin-set-user-password \
  --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --password "$PASSWORD" \
  --permanent >/dev/null

echo "Adding $USERNAME to Cognito group $GROUP_NAME..."
aws cognito-idp admin-add-user-to-group \
  --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --group-name "$GROUP_NAME"

COGNITO_SUB="$(aws cognito-idp admin-get-user \
  --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --query "UserAttributes[?Name=='sub'].Value | [0]" \
  --output text)"

if [[ -z "$COGNITO_SUB" || "$COGNITO_SUB" == "None" ]]; then
  echo "Unable to read Cognito sub for $USERNAME." >&2
  exit 1
fi

echo "Writing application user record to DynamoDB table $USERS_TABLE..."
aws dynamodb put-item \
  --region "$REGION" \
  --table-name "$USERS_TABLE" \
  --condition-expression "attribute_not_exists(id)" \
  --item '{
    "id": {"S": "'"$APP_USER_ID"'"},
    "username": {"S": "'"$USERNAME"'"},
    "cognitoSub": {"S": "'"$COGNITO_SUB"'"},
    "createdAt": {"S": "'"$CREATED_AT"'"}
  }' >/dev/null

echo "First admin user created successfully."
echo "  Username: $USERNAME"
echo "  App user id: $APP_USER_ID"
echo "  Cognito sub: $COGNITO_SUB"
echo "  Region: $REGION"
echo "  User pool id: $USER_POOL_ID"
echo "  Users table: $USERS_TABLE"
echo "  Group: $GROUP_NAME"
