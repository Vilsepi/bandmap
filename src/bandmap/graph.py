"""Graph construction, export, and basic analytics."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import networkx as nx

from bandmap.models import BandGraph

logger = logging.getLogger(__name__)


def build_networkx_graph(bg: BandGraph) -> nx.Graph:
    """Convert a BandGraph into a NetworkX undirected graph."""
    G = nx.Graph()
    for band in bg.bands.values():
        G.add_node(
            band.band_id,
            name=band.name,
            country=band.country,
            genre=band.genre,
            genres=band.genre,
            url=band.url,
        )
    for edge in bg.edges:
        G.add_edge(edge.source_id, edge.target_id, score=edge.score)
    return G


# ── Export formats ──────────────────────────────────────────────────────


def export_gexf(G: nx.Graph, path: Path) -> None:
    """Export to GEXF (Gephi)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    nx.write_gexf(G, str(path))
    logger.info("Exported GEXF to %s", path)


def export_graphml(G: nx.Graph, path: Path) -> None:
    """Export to GraphML."""
    path.parent.mkdir(parents=True, exist_ok=True)
    nx.write_graphml(G, str(path))
    logger.info("Exported GraphML to %s", path)


def export_d3_json(G: nx.Graph, path: Path) -> None:
    """Export to D3-compatible JSON: { nodes: [...], links: [...] }."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = nx.node_link_data(G)
    # Normalise to the D3 convention
    out = {
        "nodes": [
            {
                "id": n["id"],
                "name": n.get("name", ""),
                "country": n.get("country", ""),
                "genre": n.get("genre", n.get("genres", "")),
                "genres": n.get("genres", n.get("genre", "")),
                "url": n.get("url", ""),
            }
            for n in data["nodes"]
        ],
        "links": [
            {
                "source": l["source"],
                "target": l["target"],
                "score": l.get("score"),
            }
            for l in data["edges"]
        ],
    }
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    logger.info("Exported D3 JSON to %s", path)


# ── Analytics ───────────────────────────────────────────────────────────


def print_stats(G: nx.Graph, top_n: int = 20) -> None:
    """Print basic graph statistics."""
    print(f"Nodes: {G.number_of_nodes()}")
    print(f"Edges: {G.number_of_edges()}")

    components = list(nx.connected_components(G))
    print(f"Connected components: {len(components)}")
    if components:
        largest = max(components, key=len)
        print(f"Largest component: {len(largest)} nodes")

    # Top-N by degree
    degrees = sorted(G.degree(), key=lambda x: x[1], reverse=True)[:top_n]
    print(f"\nTop {top_n} most-connected bands:")
    for node_id, deg in degrees:
        name = str(G.nodes[node_id].get("name", node_id))
        print(f"  {name:40s}  degree={deg}")


def export_all(bg: BandGraph, output_dir: Path = Path("data")) -> None:
    """Build graph and export to all supported formats."""
    G = build_networkx_graph(bg)

    export_gexf(G, output_dir / "bandgraph.gexf")
    export_graphml(G, output_dir / "bandgraph.graphml")
    export_d3_json(G, output_dir / "bandgraph_d3.json")

    print_stats(G)
