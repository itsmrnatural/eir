# shellcheck shell=bash
# Shared settings and helpers for backup.sh / restore.sh / restore-test.sh. Source it, do not run it.
# Everything talks to the databases through `docker compose exec -T <service> ...`, so nothing but the
# docker CLI is needed on the host. Run the scripts from the directory that holds docker-compose.yml.

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"                         # retention: newest N complete backups are kept
COMPOSE="${COMPOSE:-docker compose}"
PG_SERVICE="${PG_SERVICE:-postgres}"       # compose service names (see the root docker-compose.yml)
MONGO_SERVICE="${MONGO_SERVICE:-mongo}"
MONGO_DB="${MONGO_DB:-health_centre}"
MONGO_URI="${MONGO_URI:-}"                 # only needed if mongo has auth; written as seen from INSIDE the mongo container
COUNT_TABLES=(patient student non_student audit_log)

die() { echo "[error] $*" >&2; exit 1; }
log() { echo "[$(basename "$0" .sh)] $*"; }

# shellcheck disable=SC2086  # COMPOSE is deliberately word-split ("docker compose")
dc_exec() { $COMPOSE exec -T "$@"; }

# psql inside the postgres container, using the image's own POSTGRES_USER / POSTGRES_DB variables.
pg_sql() { # pg_sql <database|""> <sql>
  local db="${1:-}" sql="$2"
  dc_exec "$PG_SERVICE" sh -c "psql -U \"\$POSTGRES_USER\" -d \"${db:-\$POSTGRES_DB}\" -v ON_ERROR_STOP=1 -Atc \"$sql\"" | tr -d '[:space:]'
}

mongo_eval() { # mongo_eval <js>
  dc_exec "$MONGO_SERVICE" mongosh ${MONGO_URI:+"$MONGO_URI"} --quiet --eval "$1" | tr -d '[:space:]'
}

# print "key=value" lines: row counts of the identity tables and the visit count
collect_counts() { # collect_counts <prefix> [pg_database] [mongo_database]
  local prefix="$1" pgdb="${2:-}" mdb="${3:-$MONGO_DB}" t
  for t in "${COUNT_TABLES[@]}"; do echo "${prefix}pg_${t}=$(pg_sql "$pgdb" "SELECT COUNT(*) FROM ${t}")"; done
  echo "${prefix}mongo_visits=$(mongo_eval "db.getSiblingDB('${mdb}').visits.countDocuments({})")"
}

manifest_get() { grep -E "^$2=" "$1/MANIFEST.txt" | head -n1 | cut -d= -f2; }

latest_backup() {
  local d best=""
  for d in "$BACKUP_DIR"/*/; do
    d="${d%/}"
    if [[ "${d##*/}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ -f "$d/MANIFEST.txt" ]]; then best="$d"; fi
  done
  [[ -n "$best" ]] || die "no complete backup found in $BACKUP_DIR"
  echo "$best"
}

verify_checksums() { # verify_checksums <backup_dir>
  [[ -f "$1/postgres.dump" && -f "$1/mongo.archive.gz" && -f "$1/MANIFEST.txt" ]] || die "$1 is not a complete backup"
  (cd "$1" && sha256sum --check --quiet SHA256SUMS) || die "checksum mismatch in $1 - the backup is damaged"
  log "checksums OK ($1)"
}

# Tables only grow (nothing is deleted), so a correct copy holds at least the rows counted before the dump
# started and at most the rows counted after it finished.
check_between() { # check_between <label> <low> <value> <high>
  if (( $3 >= $2 && $3 <= $4 )); then log "  OK    $1: $3 (expected $2..$4)"; return 0; fi
  log "  FAIL  $1: $3 (expected $2..$4)"; return 1
}

verify_counts() { # verify_counts <backup_dir> <pg_database|""> <mongo_database>
  local dir="$1" pgdb="$2" mdb="$3" t v failed=0
  for t in "${COUNT_TABLES[@]}"; do
    v="$(pg_sql "$pgdb" "SELECT COUNT(*) FROM ${t}")"
    check_between "postgres.${t}" "$(manifest_get "$dir" "before_pg_${t}")" "$v" "$(manifest_get "$dir" "after_pg_${t}")" || failed=1
  done
  v="$(mongo_eval "db.getSiblingDB('${mdb}').visits.countDocuments({})")"
  check_between "mongo.visits" "$(manifest_get "$dir" before_mongo_visits)" "$v" "$(manifest_get "$dir" after_mongo_visits)" || failed=1
  return "$failed"
}

mongo_dump_args() { # mongodump: this mongodb version has no --nsInclude, dump the database instead
  echo "${MONGO_URI:+--uri='$MONGO_URI'} --db='${MONGO_DB}'"
}

mongo_archive_args() { # namespace selection used by restore
  echo "${MONGO_URI:+--uri='$MONGO_URI'} --nsInclude='${MONGO_DB}.*'"
}
