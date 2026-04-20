#!/bin/sh
# ============================================================
# docker-entrypoint.sh
# Prepares a single /app/data volume by linking all mutable paths
# the app writes to into it, so you only need one mount point.
# ============================================================
set -e

DATA_DIR="${DATA_DIR:-/app/data}"

mkdir -p \
  "${DATA_DIR}" \
  "${DATA_DIR}/ncar_documents" \
  "${DATA_DIR}/policy-uploads" \
  "${DATA_DIR}/collection-uploads"

# Create an empty SQLite file on first run so the symlink target exists;
# better-sqlite3 is happy to open an empty file and initialise schemas.
[ -e "${DATA_DIR}/sessions.db" ] || : > "${DATA_DIR}/sessions.db"

# Replace app-root paths with symlinks into the data volume. Using -f so
# this is idempotent across restarts.
ln -snf "${DATA_DIR}/sessions.db"         /app/sessions.db
ln -snf "${DATA_DIR}/ncar_documents"      /app/ncar_documents
ln -snf "${DATA_DIR}/policy-uploads"      /app/policy-uploads
ln -snf "${DATA_DIR}/collection-uploads"  /app/collection-uploads

exec "$@"
