#!/bin/sh

PYTHONPATH=src .venv/bin/python -m bandmap export --input data --output-dir data/exports
