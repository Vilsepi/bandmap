#!/bin/bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

npm run clean
npm run build --workspace=packages/shared

cd packages/infra
npx cdk deploy BandmapFrontendStack --require-approval never
cd ../..
