#!/bin/bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ -z "${CI:-}" ]; then
  npm run clean
  npm run build --workspace=packages/shared
fi

API_URL=$(aws cloudformation describe-stacks \
  --stack-name BandmapBackendStack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue | [0]" \
  --output text)

if [ -z "${API_URL}" ] || [ "${API_URL}" = "None" ]; then
  echo "Failed to resolve ApiUrl output from BandmapBackendStack" >&2
  exit 1
fi

export VITE_API_BASE_URL="${API_URL%/}"

echo "Using backend API URL: ${VITE_API_BASE_URL}"

echo "Building frontend..."
npm run build:frontend

echo "Syncing frontend assets to S3..."
aws s3 sync packages/web/dist s3://bandmap-frontend-assets/ --delete

ORIGIN_DOMAIN_NAME="bandmap-frontend-assets.s3.eu-north-1.amazonaws.com"

DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[?DomainName=='${ORIGIN_DOMAIN_NAME}']].Id | [0]" \
  --output text)

if [ -z "${DISTRIBUTION_ID}" ] || [ "${DISTRIBUTION_ID}" = "None" ]; then
  echo "No CloudFront distribution found with origin domain: ${ORIGIN_DOMAIN_NAME}" >&2
  exit 1
fi

echo "Invalidating CloudFront distribution..."
aws cloudfront create-invalidation --distribution-id "${DISTRIBUTION_ID}" --paths "/*"
