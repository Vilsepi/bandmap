#!/bin/bash
set -euo pipefail

# Export environment variables from the .env file
set -a
source .env
set +a

npm run build:frontend
aws s3 sync packages/web/dist s3://bandmap-frontend-assets/ --delete

# aws cloudfront create-invalidation --distribution-id <your-distribution-id> --paths "/*"
