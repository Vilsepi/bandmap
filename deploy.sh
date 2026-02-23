#!/bin/sh

export AWS_PROFILE=heap

aws s3 sync web s3://bands.heap.fi --exclude "*.gz"

aws s3 cp web/data/bands.json.gz s3://bands.heap.fi/data/bands.json.gz\
  --content-type "application/json" \
  --content-encoding "gzip"
