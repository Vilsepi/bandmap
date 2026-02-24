#!/bin/bash

# Seed bands that serve as a starting point for the crawl.
SEEDS=(
  3540418193  # Marianas Rest
  3540373021  # Kaunis Kuolematon
  3540297625  # DDJ
  3540382449  # Gatecreeper
  3540483079  # Kanonenfieber
  3540349766  # Wayfarer
  3540354631  # White Ward
  10087       # Mokoma
  33052       # Stam1na
  3540395162  # Mist of Misery
  19701       # Alcest
  18351       # Gojira
  189         # Fear Factory
  3540372881  # So Hideous
  3540424136  # Violet Cold
  3540377669  # Shylmagoghnar
  3540431255  # Hallatar
  3540512085  # Russian Circles
  3230        # Shade Empire
)

PYTHONPATH=src .venv/bin/python -m bandmap crawl --seed "${SEEDS[@]}" --depth 10 --max-bands 100000
