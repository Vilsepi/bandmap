#!/bin/bash

set -a
source .env
set +a

node packages/crawler/dist/index.js crawl \
  --seed-file ./seeds.txt \
  --max-depth 10 --max-artists 100000

