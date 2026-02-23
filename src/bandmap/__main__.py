"""CLI entry-point for bandmap.

Usage:
    python -m bandmap crawl  --seed 12613 --depth 2 --max-bands 500
    python -m bandmap export --input data
    python -m bandmap stats  --input data
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from bandmap.crawler import run_crawl
from bandmap.graph import build_networkx_graph, export_all, print_stats
from bandmap.store import JsonStore, SqliteStore


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )


def cmd_crawl(args: argparse.Namespace) -> None:
    seeds = [int(s) for s in args.seed]
    save_every = args.save_every if args.save_every > 0 else float("inf")
    graph = run_crawl(
        seeds,
        max_depth=args.depth,
        max_bands=args.max_bands,
        rate_limit=args.rate_limit,
        save_path=Path(args.output),
        save_every=int(save_every),
    )

    # Also save to SQLite if requested
    if args.sqlite:
        SqliteStore(Path(args.sqlite)).save(graph)
        logging.getLogger(__name__).info("Saved SQLite to %s", args.sqlite)

    print(f"Done — {len(graph.bands)} bands, {len(graph.edges)} edges")


def cmd_export(args: argparse.Namespace) -> None:
    store = JsonStore(Path(args.input))
    graph = store.load()
    if graph is None:
        print(f"No data found at {args.input}", file=sys.stderr)
        sys.exit(1)
    export_all(graph, output_dir=Path(args.output_dir))


def cmd_stats(args: argparse.Namespace) -> None:
    store = JsonStore(Path(args.input))
    graph = store.load()
    if graph is None:
        print(f"No data found at {args.input}", file=sys.stderr)
        sys.exit(1)
    G = build_networkx_graph(graph)
    print_stats(G, top_n=args.top)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="bandmap",
        description="Metal Archives similar-band graph scraper",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    # -- crawl -----------------------------------------------------------
    p_crawl = sub.add_parser("crawl", help="Crawl band recommendations")
    p_crawl.add_argument(
        "--seed",
        nargs="+",
        required=True,
        help="One or more seed band IDs",
    )
    p_crawl.add_argument("--depth", type=int, default=2)
    p_crawl.add_argument("--max-bands", type=int, default=500)
    p_crawl.add_argument("--rate-limit", type=float, default=1.0)
    p_crawl.add_argument("--output", default="data")
    p_crawl.add_argument("--sqlite", default=None, help="Also save to SQLite")
    p_crawl.add_argument(
        "--save-every",
        type=int,
        default=10,
        help="Save to disk every N bands (default: 10). Use 0 to save only at end.",
    )

    # -- export ----------------------------------------------------------
    p_export = sub.add_parser("export", help="Export graph to GEXF/GraphML/D3")
    p_export.add_argument("--input", default="data")
    p_export.add_argument("--output-dir", default="data")

    # -- stats -----------------------------------------------------------
    p_stats = sub.add_parser("stats", help="Print graph statistics")
    p_stats.add_argument("--input", default="data")
    p_stats.add_argument("--top", type=int, default=20)

    args = parser.parse_args(argv)
    _configure_logging(args.verbose)

    commands = {
        "crawl": cmd_crawl,
        "export": cmd_export,
        "stats": cmd_stats,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
