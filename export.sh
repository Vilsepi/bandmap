#!/bin/sh

PYTHONPATH=src .venv/bin/python -m bandmap export --input data --output-dir data/exports

gzip -f data/exports/bandgraph_d3.json
mkdir -p web/data
cp data/exports/bandgraph_d3.json.gz web/data/bands.json.gz
