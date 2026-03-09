#!/bin/bash
set -euo pipefail

# Export environment variables from the .env file
set -a
source .env
set +a

cd packages/infra
npx cdk deploy BandmapFrontendStack
cd ../..
