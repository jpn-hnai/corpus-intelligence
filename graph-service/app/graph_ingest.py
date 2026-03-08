"""Build the knowledge graph from the writing corpus.

Supports incremental mode (default): only processes new/modified/deleted files.
Use --full to force a complete rebuild.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import logging
from pathlib import Path

from .corpus_utils import (
    compute_file_hash,
    dedupe_files_by_filename,
    discover_files,
    parse_date_from_birthtime,
    parse_date_from_content,
    parse_date_from_filename,
    IngestManifest,
    compute_changeset,
)
from .extractor import extract_entities
from .graph import (
    close_driver,
    create_indexes,
    clear_graph,
    delete_entry_data,
    ingest_entry,
    get_graph_stats,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

CORPUS_PATH = os.environ.get("CORPUS_PATH", "/corpus")


def get_title_from_filename(filename: str) -> str:
    """Extract a human-readable title from the filename."""
    stem = Path(filename).stem
    m = re.match(r"^\d{1,2}-\d{1,2}-\d{4}\s+\d{1,2}-\d{1,2}\s+(.*)", stem)
    if m:
        return m.group(1)
    return stem


def _process_entry(filepath: Path) -> bool:
    """Read a file, extract entities, and ingest into graph. Returns True on success."""
    text = filepath.read_text(encoding="utf-8", errors="replace")
    filename = filepath.name

    date = (
        parse_date_from_filename(filename)
        or parse_date_from_content(text)
        or parse_date_from_birthtime(filepath)
        or "unknown"
    )
    title = get_title_from_filename(filename)
    word_count = len(text.split())

    extraction = extract_entities(text)
    ingest_entry(
        date=date,
        filename=filename,
        word_count=word_count,
        title=title,
        people=extraction["people"],
        places=extraction["places"],
        concepts=extraction["concepts"],
        emotions=extraction["emotions"],
        decisions=extraction["decisions"],
        archetypes=extraction["archetypes"],
        transitions=extraction.get("transitions", []),
    )
    return True


# --- Full ingest ---

def run_ingest_full(manifest_db_path: str | None = None):
    """Full graph rebuild: clear graph, re-ingest everything, update manifest."""
    corpus_dir = Path(CORPUS_PATH)
    if not corpus_dir.exists():
        logger.error(f"Corpus path does not exist: {CORPUS_PATH}")
        sys.exit(1)

    discovered = sorted(corpus_dir.rglob("*.md"))
    md_files, duplicates_skipped = dedupe_files_by_filename(discovered)
    total = len(md_files)
    logger.info(f"[FULL] Found {len(discovered)} .md files in {CORPUS_PATH}")
    if duplicates_skipped > 0:
        logger.info(
            f"Detected mirrored/duplicate basenames. Processing {total} unique files "
            f"(skipping {duplicates_skipped} duplicates)."
        )

    if total == 0:
        logger.error("No .md files found")
        sys.exit(1)

    logger.info("Clearing existing graph...")
    clear_graph()
    create_indexes()

    manifest = None
    if manifest_db_path:
        manifest = IngestManifest(manifest_db_path)
        manifest.clear()

    processed = 0
    errors = 0

    for i, filepath in enumerate(md_files):
        try:
            _process_entry(filepath)
            processed += 1

            if manifest:
                manifest.upsert(
                    filename=filepath.name,
                    file_path=str(filepath),
                    content_hash=compute_file_hash(filepath),
                    chunk_count=0,
                )

            if (i + 1) % 50 == 0 or i == total - 1:
                logger.info(f"Progress: {i + 1}/{total} files processed")

        except Exception as e:
            logger.error(f"Error processing {filepath.name}: {e}")
            errors += 1

    logger.info(f"[FULL] Ingestion complete: {processed} entries processed, {errors} errors")

    if manifest:
        from datetime import datetime
        manifest.set_meta("last_full_ingest", datetime.utcnow().isoformat())
        manifest.close()

    _log_stats()
    close_driver()


# --- Incremental ingest ---

def run_ingest_incremental(manifest_db_path: str, dry_run: bool = False):
    """Incremental graph ingest: only process new/modified/deleted files."""
    corpus_dir = Path(CORPUS_PATH)
    if not corpus_dir.exists():
        logger.error(f"Corpus path does not exist: {CORPUS_PATH}")
        sys.exit(1)

    discovered = sorted(corpus_dir.rglob("*.md"))
    md_files, duplicates_skipped = dedupe_files_by_filename(discovered)
    logger.info(f"[INCREMENTAL] Found {len(discovered)} .md files ({len(md_files)} unique)")
    if duplicates_skipped > 0:
        logger.info(f"Skipping {duplicates_skipped} duplicate basenames.")

    if not md_files:
        logger.error("No .md files found")
        sys.exit(1)

    manifest = IngestManifest(manifest_db_path)
    changeset = compute_changeset(md_files, manifest)

    logger.info(f"Changeset: {changeset.summary()}")

    if not changeset.has_changes:
        logger.info("No changes detected. Nothing to do.")
        manifest.close()
        close_driver()
        return

    if dry_run:
        logger.info("[DRY RUN] Would process the following changes:")
        for f in changeset.new:
            logger.info(f"  NEW: {f.name}")
        for f in changeset.modified:
            logger.info(f"  MODIFIED: {f.name}")
        for fn in changeset.deleted:
            logger.info(f"  DELETED: {fn}")
        manifest.close()
        close_driver()
        return

    create_indexes()

    # PHASE 1 — Delete entry data for deleted and modified files
    for filename in changeset.deleted:
        delete_entry_data(filename)
        manifest.remove(filename)
        logger.info(f"  Deleted: {filename}")

    for file_path in changeset.modified:
        delete_entry_data(file_path.name)
        logger.info(f"  Removed old data: {file_path.name}")

    # PHASE 2 — Add new/modified files
    files_to_add = changeset.new + changeset.modified
    processed = 0
    errors = 0

    for filepath in files_to_add:
        try:
            _process_entry(filepath)
            processed += 1

            manifest.upsert(
                filename=filepath.name,
                file_path=str(filepath),
                content_hash=compute_file_hash(filepath),
                chunk_count=0,
            )

        except Exception as e:
            logger.error(f"Error processing {filepath.name}: {e}")
            errors += 1

    logger.info(
        f"[INCREMENTAL] Done. {processed} files processed, "
        f"{len(changeset.deleted)} deleted, {errors} errors."
    )

    manifest.close()
    _log_stats()
    close_driver()


def _log_stats():
    stats = get_graph_stats()
    for item in stats.get("nodes", []):
        logger.info(f"  {item['label']}: {item['count']} nodes")
    for item in stats.get("relationships", []):
        logger.info(f"  {item['type']}: {item['count']} relationships")


# --- Legacy alias ---

def run_ingest():
    """Legacy entry point — delegates to full ingest."""
    run_ingest_full()


# --- CLI ---

def main():
    parser = argparse.ArgumentParser(description="Ingest corpus into Neo4j knowledge graph")
    parser.add_argument("--full", action="store_true", help="Force full rebuild (clear graph and re-ingest)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without modifying anything")
    args = parser.parse_args()

    manifest_db_path = os.environ.get("MANIFEST_DB_PATH", "/service/data/ingest_manifest.sqlite")

    if args.full:
        run_ingest_full(manifest_db_path)
    else:
        run_ingest_incremental(manifest_db_path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
