#!/usr/bin/env bash
# RESTORE TEST: restores a backup into scratch databases and checks the result. The live data is never touched.
#   ./db/backup/restore-test.sh                  # newest backup
#   ./db/backup/restore-test.sh ./backups/20261117T020000Z
# Checks: checksums; both archives restore without errors; row counts lie between the manifest's before/after
# counts; the patient_with_age view and the triggers exist; the visits collection has its 6 indexes + _id
# index and its JSON-schema validator. Prints RESTORE TEST PASSED and exits 0, or exits 1 on the first problem.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

SCRATCH_PG="${SCRATCH_PG:-hc_restore_test}"
SCRATCH_MONGO="${SCRATCH_MONGO:-hc_restore_test}"
dir="${1:-$(latest_backup)}"
log "testing backup $dir"
verify_checksums "$dir"

cleanup() {
  dc_exec "$PG_SERVICE" sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -c 'DROP DATABASE IF EXISTS ${SCRATCH_PG}'" > /dev/null 2>&1 || true
  dc_exec "$MONGO_SERVICE" mongosh ${MONGO_URI:+"$MONGO_URI"} --quiet --eval "db.getSiblingDB('${SCRATCH_MONGO}').dropDatabase()" > /dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

log "restoring postgres into scratch database ${SCRATCH_PG}"
dc_exec "$PG_SERVICE" sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE ${SCRATCH_PG}'" > /dev/null
dc_exec "$PG_SERVICE" sh -c "pg_restore -U \"\$POSTGRES_USER\" -d ${SCRATCH_PG} --no-owner --exit-on-error" < "$dir/postgres.dump"

log "restoring mongodb into scratch database ${SCRATCH_MONGO}"
dc_exec "$MONGO_SERVICE" sh -c "mongorestore ${MONGO_URI:+--uri='$MONGO_URI'} --nsInclude='${MONGO_DB}.*' --nsFrom='${MONGO_DB}.*' --nsTo='${SCRATCH_MONGO}.*' --archive --gzip --drop" < "$dir/mongo.archive.gz"

log "checking row counts"
verify_counts "$dir" "$SCRATCH_PG" "$SCRATCH_MONGO" || die "row counts do not match the manifest"

log "checking structure"
view_rows="$(pg_sql "$SCRATCH_PG" "SELECT COUNT(*) FROM patient_with_age")"
patient_rows="$(pg_sql "$SCRATCH_PG" "SELECT COUNT(*) FROM patient")"
[[ "$view_rows" == "$patient_rows" ]] || die "patient_with_age returns $view_rows rows but patient has $patient_rows"
triggers="$(pg_sql "$SCRATCH_PG" "SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal")"
(( triggers >= 5 )) || die "expected at least 5 user triggers, found $triggers"
indexes="$(mongo_eval "db.getSiblingDB('${SCRATCH_MONGO}').visits.getIndexes().length")"
[[ "$indexes" == "7" ]] || die "visits should have 7 indexes (6 + _id), found $indexes"
validator="$(mongo_eval "db.getSiblingDB('${SCRATCH_MONGO}').getCollectionInfos({name:'visits'})[0].options.validator ? 'yes' : 'no'")"
[[ "$validator" == *yes* ]] || die "visits collection lost its JSON-schema validator"

log "RESTORE TEST PASSED for $dir"
