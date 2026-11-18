#!/usr/bin/env bash
# Self-test of the backup/restore SCRIPT LOGIC (layout, checksums, retention, count bounds, scratch cleanup)
# using a fake `docker` on PATH. It does NOT test pg_dump/mongodump themselves - for that run the real
# restore test (README, "Restore test") against your compose stack.
#   ./db/backup/selftest.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/state" "$work/backups"

cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
# fake: docker compose exec -T <service> <command...>
S="$SHIM_STATE"
[[ "$1 $2 $3" == "compose exec -T" ]] || { echo "shim: unexpected: $*" >&2; exit 2; }
shift 4
get() { grep -E "^$2=" "$1" | cut -d= -f2; }
counts_line() { echo "patient=$(get "$1" patient) student=$(get "$1" student) non_student=$(get "$1" non_student) audit_log=$(get "$1" audit_log) visits=$(get "$1" visits)"; }
load_counts() { tr ' ' '\n' | grep -E '^(patient|student|non_student|audit_log|visits)=' > "$1"; }
pick() { if [[ "$1" == *hc_restore_test* ]]; then echo "$S/scratch"; else echo "$S/live"; fi; }
bump() { [[ "${SHIM_BUMP:-0}" == 1 ]] && sed -i 's/^visits=.*/visits=999/' "$S/live" || true; }

if [[ "$1" == mongosh ]]; then
  js="$*"; f="$(pick "$js")"
  case "$js" in
    *dropDatabase*) rm -f "$S/scratch" "$S/scratch.mongo" ;;
    *countDocuments*) get "$([[ "$js" == *hc_restore_test* ]] && echo "$S/scratch.mongo" || echo "$S/live")" visits ;;
    *getIndexes*) echo 7 ;;
    *getCollectionInfos*) echo yes ;;
  esac
  exit 0
fi

script="$3"
case "$script" in
  *pg_dump*) { echo "PGDUMP $(counts_line "$S/live")"; } ; bump ;;
  *"pg_restore --list"*) cat > /dev/null ;;
  *pg_restore*)
    data="$(cat)"; [[ "$data" == PGDUMP* ]] || exit 1
    if [[ "$script" == *hc_restore_test* ]]; then echo "$data" | load_counts "$S/scratch"; else echo "$data" | load_counts "$S/live"; fi ;;
  *mongodump*) echo "MONGODUMP visits=$(get "$S/live" visits)"; bump ;;
  *"mongorestore"*"--dryRun"*) cat > /dev/null ;;
  *mongorestore*)
    data="$(cat)"; [[ "$data" == MONGODUMP* ]] || exit 1
    if [[ "$script" == *--nsTo* ]]; then echo "$data" | load_counts "$S/scratch.mongo"; else
      sed -i "s/^visits=.*/$(echo "$data" | grep -o 'visits=[0-9]*')/" "$S/live"; fi ;;
  *"CREATE DATABASE"*) cp "$S/live" "$S/scratch" ;;
  *"DROP DATABASE"*) rm -f "$S/scratch" "$S/scratch.mongo" ;;
  *pg_trigger*) echo 7 ;;
  *patient_with_age*) f="$(pick "$script")"; get "$f" patient ;;
  *"COUNT(*) FROM "*)
    f="$(pick "$script")"; t="$(echo "$script" | sed -E 's/.*COUNT\(\*\) FROM ([a-z_]+).*/\1/')"; get "$f" "$t" ;;
esac
SHIM
chmod +x "$work/bin/docker"

export PATH="$work/bin:$PATH" SHIM_STATE="$work/state" BACKUP_DIR="$work/backups" KEEP=3
printf 'patient=10\nstudent=7\nnon_student=3\naudit_log=2\nvisits=50\n' > "$work/state/live"

pass=0
ok() { pass=$((pass + 1)); echo "  ok   - $1"; }
bad() { echo "  FAIL - $1" >&2; exit 1; }
run() { bash "$here/$1" "${@:2}" > "$work/out.txt" 2>&1; }

# older complete backups + noise that retention must ignore
for s in 20200101T000000Z 20200102T000000Z 20200103T000000Z 20200104T000000Z; do
  mkdir "$BACKUP_DIR/$s"; echo "created_utc=$s" > "$BACKUP_DIR/$s/MANIFEST.txt"
done
mkdir "$BACKUP_DIR/not-a-backup" "$BACKUP_DIR/20300101T000000Z"   # second one has no MANIFEST.txt => not complete

echo "backup.sh"
run backup.sh || { cat "$work/out.txt"; bad "backup.sh failed"; }
newest="$(ls -d "$BACKUP_DIR"/2[0-9][0-9][0-9]*Z | grep -v -e /2020 -e /2030 | sort | tail -n1)"
[[ -f "$newest/postgres.dump" && -f "$newest/mongo.archive.gz" && -f "$newest/SHA256SUMS" && -f "$newest/MANIFEST.txt" ]] && ok "backup directory has dump, archive, checksums, manifest" || bad "files missing"
grep -q '^before_pg_patient=10$' "$newest/MANIFEST.txt" && grep -q '^after_mongo_visits=50$' "$newest/MANIFEST.txt" && ok "manifest holds before/after counts" || bad "manifest counts"
[[ -d "$BACKUP_DIR/not-a-backup" && -d "$BACKUP_DIR/20300101T000000Z" ]] && ok "retention ignores directories that are not complete backups" || bad "retention touched foreign dirs"
[[ ! -d "$BACKUP_DIR/20200101T000000Z" && ! -d "$BACKUP_DIR/20200102T000000Z" && -d "$BACKUP_DIR/20200104T000000Z" ]] && ok "retention removed the oldest, kept the newest (KEEP=3: 2 old + new, plus the incomplete 2030 dir untouched)" || bad "retention: $(ls "$BACKUP_DIR")"
[[ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name '.incomplete-*')" ]] && ok "no .incomplete-* directory left behind" || bad "leftover tmp"

echo "restore-test.sh"
run restore-test.sh "$newest" || { cat "$work/out.txt"; bad "restore test failed on a good backup"; }
grep -q 'RESTORE TEST PASSED' "$work/out.txt" && ok "passes on a good backup" || bad "no PASS line"
[[ ! -e "$work/state/scratch" && ! -e "$work/state/scratch.mongo" ]] && ok "scratch databases are dropped afterwards" || bad "scratch not cleaned"
grep -q '^visits=50$' "$work/state/live" && ok "live data untouched" || bad "live data changed"

echo "writes during the backup (tables only grow)"
printf 'patient=10\nstudent=7\nnon_student=3\naudit_log=2\nvisits=50\n' > "$work/state/live"
sleep 1
SHIM_BUMP=1 run backup.sh || { cat "$work/out.txt"; bad "backup with concurrent writes"; }
latest="$(ls -d "$BACKUP_DIR"/2[0-9][0-9][0-9]*Z | grep -v -e /2020 -e /2030 | sort | tail -n1)"
grep -q '^before_mongo_visits=50$' "$latest/MANIFEST.txt" && grep -q '^after_mongo_visits=999$' "$latest/MANIFEST.txt" && ok "manifest brackets the change (50..999)" || bad "bracket"
run restore-test.sh "$latest" && ok "restore test accepts a count inside the bracket" || { cat "$work/out.txt"; bad "bracket test"; }

echo "damage detection"
cp -r "$latest" "$work/damaged"; echo "garbage" >> "$work/damaged/postgres.dump"
if run restore-test.sh "$work/damaged"; then bad "damaged dump accepted"; else grep -q 'checksum mismatch' "$work/out.txt" && ok "checksum mismatch is caught" || bad "wrong failure reason"; fi
cp -r "$latest" "$work/lying"; sed -i 's/^after_mongo_visits=.*/after_mongo_visits=60/' "$work/lying/MANIFEST.txt"
if run restore-test.sh "$work/lying"; then bad "count mismatch accepted"; else grep -q 'FAIL  mongo.visits' "$work/out.txt" && ok "a restored count outside the manifest bracket fails the test" || bad "wrong failure reason (count)"; fi
[[ ! -e "$work/state/scratch" ]] && ok "scratch cleaned even after a failure" || bad "scratch left after failure"

echo "restore.sh"
printf 'patient=1\nstudent=1\nnon_student=0\naudit_log=0\nvisits=1\n' > "$work/state/live"
run restore.sh "$latest" --yes || { cat "$work/out.txt"; bad "restore failed"; }
grep -q '^patient=10$' "$work/state/live" && ok "live data replaced by the backup's contents" || bad "restore did not replace data"
run restore.sh "$work/damaged" --yes && bad "restored a damaged backup" || ok "refuses a damaged backup"

echo "all $pass checks passed"
