#!/usr/bin/env bash
# Timestamped backup of PostgreSQL (pg_dump, custom format) + MongoDB (mongodump archive, gzip).
#   ./db/backup/backup.sh                 -> ./backups/20261117T020000Z/{postgres.dump,mongo.archive.gz,MANIFEST.txt,SHA256SUMS}
# Environment (all optional): BACKUP_DIR KEEP(14) COMPOSE PG_SERVICE MONGO_SERVICE MONGO_DB MONGO_URI
# A backup directory appears only when complete (written as .incomplete-* first), and only then is old data pruned.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/$stamp"
tmp="$BACKUP_DIR/.incomplete-$stamp"
mkdir -p "$BACKUP_DIR"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp"

log "counting rows before the dump"
collect_counts before_ > "$tmp/counts-before"

log "dumping postgres"
dc_exec "$PG_SERVICE" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$tmp/postgres.dump"
log "dumping mongodb"
dc_exec "$MONGO_SERVICE" sh -c "mongodump $(mongo_dump_args) --archive --gzip" > "$tmp/mongo.archive.gz"

log "counting rows after the dump"
collect_counts after_ > "$tmp/counts-after"

[[ -s "$tmp/postgres.dump" ]] || die "postgres dump is empty"
[[ -s "$tmp/mongo.archive.gz" ]] || die "mongo archive is empty"
log "checking both archives can be read"
dc_exec "$PG_SERVICE" sh -c 'pg_restore --list > /dev/null' < "$tmp/postgres.dump"
dc_exec "$MONGO_SERVICE" sh -c "mongorestore $(mongo_archive_args) --archive --gzip --dryRun" < "$tmp/mongo.archive.gz" > /dev/null 2>&1

{ echo "created_utc=$stamp"; cat "$tmp/counts-before" "$tmp/counts-after"; } > "$tmp/MANIFEST.txt"
rm -f "$tmp/counts-before" "$tmp/counts-after"
(cd "$tmp" && sha256sum postgres.dump mongo.archive.gz > SHA256SUMS)
mv "$tmp" "$final"
log "backup complete: $final"

# ---- retention: keep the newest $KEEP complete backups --------------------------------------------------
dirs=()
for d in "$BACKUP_DIR"/*/; do
  d="${d%/}"
  if [[ "${d##*/}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ -f "$d/MANIFEST.txt" ]]; then dirs+=("$d"); fi
done
n=${#dirs[@]}
if (( n > KEEP )); then
  for ((i = 0; i < n - KEEP; i++)); do log "retention: removing ${dirs[i]}"; rm -rf -- "${dirs[i]}"; done
fi
log "backups kept: $(( n > KEEP ? KEEP : n ))"
