"""
Corpus ingestion script.

Reads .md files from CORPUS_PATH, strips markdown, chunks text,
embeds chunks, and stores them in ChromaDB.

Supports incremental mode (default): only processes new/modified/deleted files.
Use --full to force a complete rebuild.

Supports filename formats:
  - M-D-YYYY.md              (e.g., 1-1-2025.md)
  - MM-DD-YYYY HH-MM Title.md (e.g., 08-18-2025 10-15 Expression @ Hix.md)
  - Freeform titles (date extracted from file content if possible)
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import logging
from pathlib import Path
from datetime import datetime

from tqdm import tqdm

# Add parent directory so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.embeddings import embed_texts
from app.vectorstore import get_or_create_collection, delete_collection
from app.corpus_utils import (
    chunk_text,
    compute_file_hash,
    dedupe_files_by_filename,
    discover_files,
    parse_date_from_birthtime,
    parse_date_from_content,
    parse_date_from_filename,
    strip_markdown,
    IngestManifest,
    compute_changeset,
)

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# --- Helpers ---

def _process_file(file_path: Path, batch_size: int, collection,
                   pending_ids: list, pending_documents: list,
                   pending_metadatas: list, flush_fn) -> int:
    """Process a single file: read, chunk, queue for embedding. Returns chunk count."""
    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        logger.warning(f"Skipping {file_path.name}: {e}")
        return -1  # signal skip

    if not text.strip():
        logger.debug(f"Skipping empty file: {file_path.name}")
        return -1

    date_str = parse_date_from_filename(file_path.name)
    if date_str is None:
        date_str = parse_date_from_content(text)
    if date_str is None:
        date_str = parse_date_from_birthtime(file_path)
    if date_str is None:
        date_str = "unknown"

    year = 0
    month = 0
    if date_str != "unknown":
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            year = dt.year
            month = dt.month
        except ValueError:
            pass

    plain_text = strip_markdown(text)
    if not plain_text.strip():
        return -1

    chunks = chunk_text(plain_text)
    total_word_count = len(plain_text.split())

    for i, chunk in enumerate(chunks):
        chunk_id = f"{file_path.stem}__chunk_{i}"
        chunk_word_count = len(chunk.split())

        pending_ids.append(chunk_id)
        pending_documents.append(chunk)
        pending_metadatas.append({
            "date": date_str,
            "word_count": chunk_word_count,
            "total_entry_words": total_word_count,
            "chunk_index": i,
            "total_chunks": len(chunks),
            "source_file": file_path.name,
            "year": year,
            "month": month,
        })
        if len(pending_documents) >= batch_size:
            flush_fn()

    return len(chunks)


def _delete_chunks_for_file(collection, filename: str, chunk_count: int) -> None:
    """Delete all chunks for a file from ChromaDB."""
    stem = Path(filename).stem
    ids = [f"{stem}__chunk_{i}" for i in range(chunk_count)]
    if ids:
        collection.delete(ids=ids)


# --- Full ingestion ---

def ingest_corpus_full(corpus_path: str, manifest_db_path: str | None = None,
                       batch_size: int = 64) -> dict:
    """
    Full ingestion pipeline (wipe and rebuild):
    1. Discover and deduplicate files
    2. Reset ChromaDB collection
    3. Process all files
    4. Update manifest (if path provided)
    """
    logger.info(f"[FULL] Starting full ingestion from: {corpus_path}")

    discovered = discover_files(corpus_path)
    files, duplicates_skipped = dedupe_files_by_filename(discovered)
    logger.info(f"Found {len(discovered)} .md files")
    if duplicates_skipped > 0:
        logger.info(
            f"Detected mirrored/duplicate basenames. Processing {len(files)} unique files "
            f"(skipping {duplicates_skipped} duplicates)."
        )

    if not files:
        logger.error("No .md files found. Check CORPUS_PATH.")
        return {"files_found": 0, "files_processed": 0, "files_skipped": 0, "chunks_indexed": 0}

    # Detect format
    sample_names = [f.name for f in files[:10]]
    dated_count = sum(1 for n in sample_names if parse_date_from_filename(n) is not None)
    if dated_count > len(sample_names) // 2:
        logger.info("Detected format: date-based filenames (M-D-YYYY or MM-DD-YYYY HH-MM Title)")
    else:
        logger.info("Detected format: mixed — will extract dates from filenames and content headers")

    # Reset collection for clean re-index
    logger.info("Resetting ChromaDB collection for clean ingestion...")
    delete_collection()
    collection = get_or_create_collection()

    pending_ids: list[str] = []
    pending_documents: list[str] = []
    pending_metadatas: list[dict] = []

    def flush_pending_batch() -> None:
        if not pending_documents:
            return
        batch_embeddings = embed_texts(pending_documents)
        collection.add(
            ids=list(pending_ids),
            documents=list(pending_documents),
            embeddings=batch_embeddings,
            metadatas=list(pending_metadatas),
        )
        pending_ids.clear()
        pending_documents.clear()
        pending_metadatas.clear()

    # Open manifest for tracking (clear it for full rebuild)
    manifest = None
    if manifest_db_path:
        manifest = IngestManifest(manifest_db_path)
        manifest.clear()

    files_processed = 0
    files_skipped = 0
    total_chunks = 0

    for file_path in tqdm(files, desc="Processing files", unit="file"):
        n_chunks = _process_file(
            file_path, batch_size, collection,
            pending_ids, pending_documents, pending_metadatas,
            flush_pending_batch,
        )
        if n_chunks < 0:
            files_skipped += 1
            continue

        files_processed += 1
        total_chunks += n_chunks

        if manifest:
            manifest.upsert(
                filename=file_path.name,
                file_path=str(file_path),
                content_hash=compute_file_hash(file_path),
                chunk_count=n_chunks,
            )

    flush_pending_batch()
    logger.info(f"Files processed: {files_processed}, skipped: {files_skipped}, total chunks: {total_chunks}")

    if manifest:
        manifest.set_meta("last_full_ingest", datetime.utcnow().isoformat())
        manifest.close()

    logger.info(f"[FULL] Ingestion complete. {total_chunks} chunks indexed in ChromaDB.")
    return {
        "files_found": len(discovered),
        "files_processed": files_processed,
        "files_skipped": files_skipped,
        "chunks_indexed": total_chunks,
    }


# --- Incremental ingestion ---

def ingest_corpus_incremental(corpus_path: str, manifest_db_path: str,
                              batch_size: int = 64, dry_run: bool = False) -> dict:
    """
    Incremental ingestion pipeline:
    1. Discover and deduplicate files
    2. Compute changeset against manifest
    3. Delete chunks for deleted/modified files
    4. Add chunks for new/modified files
    5. Update manifest
    """
    logger.info(f"[INCREMENTAL] Starting incremental ingestion from: {corpus_path}")

    discovered = discover_files(corpus_path)
    files, duplicates_skipped = dedupe_files_by_filename(discovered)
    logger.info(f"Found {len(discovered)} .md files ({len(files)} unique)")
    if duplicates_skipped > 0:
        logger.info(f"Skipping {duplicates_skipped} duplicate basenames.")

    if not files:
        logger.error("No .md files found. Check CORPUS_PATH.")
        return {"files_found": 0, "new": 0, "modified": 0, "deleted": 0, "unchanged": 0, "chunks_indexed": 0}

    manifest = IngestManifest(manifest_db_path)
    changeset = compute_changeset(files, manifest)

    logger.info(f"Changeset: {changeset.summary()}")

    if not changeset.has_changes:
        logger.info("No changes detected. Nothing to do.")
        manifest.close()
        return {
            "files_found": len(discovered),
            "new": 0,
            "modified": 0,
            "deleted": 0,
            "unchanged": len(changeset.unchanged),
            "chunks_indexed": 0,
        }

    if dry_run:
        logger.info("[DRY RUN] Would process the following changes:")
        for f in changeset.new:
            logger.info(f"  NEW: {f.name}")
        for f in changeset.modified:
            logger.info(f"  MODIFIED: {f.name}")
        for fn in changeset.deleted:
            logger.info(f"  DELETED: {fn}")
        manifest.close()
        return {
            "files_found": len(discovered),
            "new": len(changeset.new),
            "modified": len(changeset.modified),
            "deleted": len(changeset.deleted),
            "unchanged": len(changeset.unchanged),
            "chunks_indexed": 0,
            "dry_run": True,
        }

    collection = get_or_create_collection()

    # PHASE 1 — Delete old chunks for deleted and modified files
    for filename in changeset.deleted:
        record = manifest.get(filename)
        if record:
            _delete_chunks_for_file(collection, filename, record["chunk_count"])
            manifest.remove(filename)
            logger.info(f"  Deleted: {filename} ({record['chunk_count']} chunks)")

    for file_path in changeset.modified:
        record = manifest.get(file_path.name)
        if record:
            _delete_chunks_for_file(collection, file_path.name, record["chunk_count"])
            logger.info(f"  Removed old chunks: {file_path.name} ({record['chunk_count']} chunks)")

    # PHASE 2 — Add new/modified files
    pending_ids: list[str] = []
    pending_documents: list[str] = []
    pending_metadatas: list[dict] = []

    def flush_pending_batch() -> None:
        if not pending_documents:
            return
        batch_embeddings = embed_texts(pending_documents)
        collection.add(
            ids=list(pending_ids),
            documents=list(pending_documents),
            embeddings=batch_embeddings,
            metadatas=list(pending_metadatas),
        )
        pending_ids.clear()
        pending_documents.clear()
        pending_metadatas.clear()

    files_to_add = changeset.new + changeset.modified
    files_processed = 0
    files_skipped = 0
    total_chunks = 0

    for file_path in tqdm(files_to_add, desc="Processing new/modified", unit="file"):
        n_chunks = _process_file(
            file_path, batch_size, collection,
            pending_ids, pending_documents, pending_metadatas,
            flush_pending_batch,
        )
        if n_chunks < 0:
            files_skipped += 1
            continue

        files_processed += 1
        total_chunks += n_chunks

        manifest.upsert(
            filename=file_path.name,
            file_path=str(file_path),
            content_hash=compute_file_hash(file_path),
            chunk_count=n_chunks,
        )

    flush_pending_batch()

    logger.info(
        f"[INCREMENTAL] Done. {files_processed} files processed, "
        f"{len(changeset.deleted)} deleted, {total_chunks} chunks indexed."
    )

    manifest.close()
    return {
        "files_found": len(discovered),
        "new": len(changeset.new),
        "modified": len(changeset.modified),
        "deleted": len(changeset.deleted),
        "unchanged": len(changeset.unchanged),
        "chunks_indexed": total_chunks,
    }


# --- Legacy alias for backwards compatibility ---

def ingest_corpus(corpus_path: str, batch_size: int = 64) -> dict:
    """Legacy entry point — delegates to full ingest."""
    return ingest_corpus_full(corpus_path, batch_size=batch_size)


# --- CLI ---

def main():
    parser = argparse.ArgumentParser(description="Ingest corpus into ChromaDB")
    parser.add_argument("--full", action="store_true", help="Force full rebuild (wipe and re-index)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without modifying anything")
    parser.add_argument("--batch-size", type=int, default=64, help="Embedding batch size")
    args = parser.parse_args()

    corpus_path = os.environ.get("CORPUS_PATH", "/corpus")
    manifest_db_path = os.environ.get("MANIFEST_DB_PATH", "/data/chroma/ingest_manifest.sqlite")

    if args.full:
        result = ingest_corpus_full(corpus_path, manifest_db_path, batch_size=args.batch_size)
    else:
        result = ingest_corpus_incremental(
            corpus_path, manifest_db_path,
            batch_size=args.batch_size, dry_run=args.dry_run,
        )

    print("\n=== Ingestion Summary ===")
    for key, value in result.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
