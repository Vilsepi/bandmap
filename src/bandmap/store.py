"""Persistence layer — JSON and SQLite backends."""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path

from bandmap.models import Band, BandGraph, CrawlState, SimilarEdge

logger = logging.getLogger(__name__)


# ── JSON Store ──────────────────────────────────────────────────────────


class JsonStore:
    """Read/write a BandGraph as split JSON files.

    The store writes two files in the target directory:
    - bands.json: mapping of band_id -> Band
    - edges.json: list of SimilarEdge
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.root_dir = self._resolve_root_dir(path)
        self.bands_path = self.root_dir / "bands.json"
        self.edges_path = self.root_dir / "edges.json"
        self.state_path = self.root_dir / "crawl_state.json"

    @staticmethod
    def _resolve_root_dir(path: Path) -> Path:
        if path.suffix == ".json":
            return path.parent
        return path

    def save(self, graph: BandGraph) -> None:
        self.root_dir.mkdir(parents=True, exist_ok=True)

        bands_data = {
            str(band_id): band.model_dump(mode="json")
            for band_id, band in graph.bands.items()
        }
        edges_data = [edge.model_dump(mode="json") for edge in graph.edges]

        self.bands_path.write_text(
            json.dumps(bands_data, indent=2),
            encoding="utf-8",
        )
        self.edges_path.write_text(
            json.dumps(edges_data, indent=2),
            encoding="utf-8",
        )
        logger.debug(
            "Saved %d bands and %d edges to %s",
            len(graph.bands),
            len(graph.edges),
            self.root_dir,
        )

    def load(self) -> BandGraph | None:
        if self.bands_path.exists() and self.edges_path.exists():
            bands_raw = json.loads(self.bands_path.read_text(encoding="utf-8"))
            edges_raw = json.loads(self.edges_path.read_text(encoding="utf-8"))

            bands = {
                int(band_id): Band.model_validate(band_data)
                for band_id, band_data in bands_raw.items()
            }
            edges = [SimilarEdge.model_validate(edge_data) for edge_data in edges_raw]
            return BandGraph(bands=bands, edges=edges)

        return None

    def save_crawl_state(self, state: CrawlState) -> None:
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(
            state.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def load_crawl_state(self) -> CrawlState | None:
        if not self.state_path.exists():
            return None
        data = json.loads(self.state_path.read_text(encoding="utf-8"))
        return CrawlState.model_validate(data)


# ── SQLite Store ────────────────────────────────────────────────────────


class SqliteStore:
    """Read/write a BandGraph to a SQLite database with upsert semantics."""

    SCHEMA = """\
    CREATE TABLE IF NOT EXISTS bands (
        band_id   INTEGER PRIMARY KEY,
        name      TEXT NOT NULL,
        country   TEXT NOT NULL,
        genre     TEXT NOT NULL,
        url       TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
        source_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        score     INTEGER,
        PRIMARY KEY (source_id, target_id)
    );
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.executescript(self.SCHEMA)

            cols = {
                row[1] for row in conn.execute("PRAGMA table_info(bands)").fetchall()
            }
            if "genre" not in cols:
                conn.execute(
                    "ALTER TABLE bands ADD COLUMN genre TEXT NOT NULL DEFAULT ''"
                )
                if "genres" in cols:
                    rows = conn.execute("SELECT band_id, genres FROM bands").fetchall()
                    for band_id, legacy_genres in rows:
                        conn.execute(
                            "UPDATE bands SET genre = ? WHERE band_id = ?",
                            (
                                self._normalize_legacy_genre(legacy_genres),
                                band_id,
                            ),
                        )
            if "url" not in cols:
                conn.execute("ALTER TABLE bands ADD COLUMN url TEXT")

    @staticmethod
    def _normalize_legacy_genre(legacy_value: str | None) -> str:
        if not legacy_value:
            return ""
        try:
            decoded = json.loads(legacy_value)
        except json.JSONDecodeError:
            return legacy_value

        if isinstance(decoded, list):
            return ", ".join(
                genre.strip()
                for genre in decoded
                if isinstance(genre, str) and genre.strip()
            )
        if isinstance(decoded, str):
            return decoded
        return ""

    def save(self, graph: BandGraph) -> None:
        with sqlite3.connect(self.path) as conn:
            for band in graph.bands.values():
                conn.execute(
                    "INSERT OR REPLACE INTO bands (band_id, name, country, genre, url) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        band.band_id,
                        band.name,
                        band.country,
                        band.genre,
                        band.url,
                    ),
                )
            for edge in graph.edges:
                conn.execute(
                    "INSERT OR IGNORE INTO edges (source_id, target_id, score) "
                    "VALUES (?, ?, ?)",
                    (edge.source_id, edge.target_id, edge.score),
                )
        logger.debug("Saved %d bands to %s", len(graph.bands), self.path)

    def load(self) -> BandGraph:
        graph = BandGraph()
        with sqlite3.connect(self.path) as conn:
            conn.row_factory = sqlite3.Row
            for row in conn.execute("SELECT * FROM bands"):
                row_keys = row.keys()
                graph.add_band(
                    Band(
                        band_id=row["band_id"],
                        name=row["name"],
                        country=row["country"],
                        genre=(
                            row["genre"]
                            if "genre" in row_keys
                            else self._normalize_legacy_genre(row["genres"])
                        ),
                        url=row["url"],
                    )
                )
            for row in conn.execute("SELECT * FROM edges"):
                graph.add_edge(
                    SimilarEdge(
                        source_id=row["source_id"],
                        target_id=row["target_id"],
                        score=row["score"],
                    )
                )
        return graph
