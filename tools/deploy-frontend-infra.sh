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

cd packages/infra
npx cdk deploy BandmapFrontendStack --require-approval never
cd ../..
