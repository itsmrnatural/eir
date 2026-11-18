#!/usr/bin/env bash
# DESTRUCTIVE: replaces the live databases with the contents of one backup.
#   ./db/backup/restore.sh ./backups/20261117T020000Z [--yes]
# Use restore-test.sh first to prove a backup is good without touching the live data.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

dir="${1:-}"; [[ -n "$dir" && -d "$dir" ]] || die "usage: restore.sh <backup-dir> [--yes]"
verify_checksums "$dir"
if [[ "${2:-}" != "--yes" ]]; then
  read -r -p "This REPLACES the live PostgreSQL and MongoDB data with $dir. Type 'restore' to continue: " answer
  [[ "$answer" == "restore" ]] || die "aborted"
fi

log "restoring postgres (drops and recreates the objects in the dump)"
if ! dc_exec "$PG_SERVICE" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$dir/postgres.dump"; then
  log "pg_restore reported problems (often harmless 'does not exist' notices); the row-count check below decides"
fi
log "restoring mongodb"
dc_exec "$MONGO_SERVICE" sh -c "mongorestore $(mongo_archive_args) --archive --gzip --drop" < "$dir/mongo.archive.gz"

log "verifying row counts against the manifest"
verify_counts "$dir" "" "$MONGO_DB" || die "restore finished but the counts do not match the backup"
log "restore complete"
