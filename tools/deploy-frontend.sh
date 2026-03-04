#!/bin/bash
set -euo pipefail

# Export environment variables from the .env file
set -a
source .env
set +a

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
