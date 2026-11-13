# TODO: Health Centre RFID-Based Record System

NIT Delhi | CSE-1 G1 | DBMS Course Project | Submitted to: Dr. Shelly Sachdeva
Team: Aditya Kumar, Aryan Nautiyal, Dhananjay Rajput, Guru Prasad Bhandari

**Stack:** Flask, Jinja + Bootstrap, PostgreSQL, MongoDB, USB RFID reader (keyboard mode)
**Tooling:** uv, ruff, pytest, GitHub Actions

---

## Final Decisions (locked in Phase 0)

- RFID table: `rfid_table (rfid_id PK, roll_no FK, is_active BOOLEAN)`
- Mongo collections: `student_visit`, `non_student_visit`, `gym_in_out`, `hostel_in_out`, `hostel_home_in_out`
- Sample queries are rewritten to use these names (no `db.visits`, no `status = 'ACTIVE'`)
- Non-student identity: (`phone_no`, `name`), max 5 names per phone
- Timestamps are always set by the server, never by the client
- Branch is derived from `roll_no` using one documented rule

## Project Structure

```
healthcentre/
  app.py
  db.py                 # postgres + mongo connections
  auth.py               # login, role_required decorator
  routes/               # staff.py, admin.py, reports.py, gym_hostel.py
  templates/
  static/
  sql/                  # schema.sql, seed.sql
  scripts/              # seed_mongo.py, backup.sh, restore.sh
  tests/
  .github/workflows/ci.yml
  .pre-commit-config.yaml
  pyproject.toml
  uv.lock
  .env.example
  README.md
```

---

## Phase 0: Design Cleanup
- [ ] Fix naming inconsistencies across the ER model, internal schema diagram, table lists and sample queries
- [ ] Decide how `patient_id` (ISA hierarchy) maps to `roll_no` and to `phone_no` + `name`
- [ ] Use one name for the year column (`year` or `batch_year`)
- [ ] Write down the `roll_no` to `branch_id` derivation rule
- [ ] Fix the RFID section of the synopsis (missing heading on the TID paragraph; ID cards usually expose a UID)
- [ ] Update the Technical Feasibility line to: Flask, HTML/Bootstrap, PostgreSQL, MongoDB
- [ ] Create the GitHub repo, `.gitignore` (`.venv/`, `.env`, `__pycache__/`), LICENSE, README stub
- [ ] Set branch rules (`main` / `dev` / feature branches) and a PR template
- [ ] Split these tasks into GitHub issues and milestones, one per phase

## Phase 1: Tooling (uv + ruff)
- [ ] Install uv on every team member's machine
- [ ] `uv init healthcentre`, set `requires-python = ">=3.12"`
- [ ] `uv add flask flask-login psycopg2-binary pymongo python-dotenv`
- [ ] `uv add --dev ruff pytest`
- [ ] Configure ruff in `pyproject.toml` (rules: E, F, I, B, UP, S)
- [ ] Commit `pyproject.toml` and `uv.lock`
- [ ] Add `.pre-commit-config.yaml` with ruff and ruff-format
- [ ] Add `.github/workflows/ci.yml` (`uv sync --locked`, `ruff check`, `ruff format --check`, `pytest`)
- [ ] Add `.env.example` (`DATABASE_URL`, `MONGO_URI`, `SECRET_KEY`)
- [ ] Add a first smoke test and confirm CI goes green
- [ ] README "Setup in 3 commands": `uv sync`, copy `.env.example` to `.env`, `uv run flask --app app run --debug`

## Phase 2: Databases

### PostgreSQL
- [ ] `branch_table (branch_id PK, branch_name UNIQUE)`
- [ ] `student_info (roll_no PK, name, dob, sex, year, branch_id FK)`
- [ ] `rfid_table (rfid_id PK, roll_no FK, is_active)`
- [ ] `non_student_info (phone_no, name, dob, sex, designation)` with PK (`phone_no`, `name`)
- [ ] `users (user_id PK, password_hash, role)`
- [ ] CHECK constraints: sex in (M, F, Other), designation in (staff, faculty, worker), role in (Admin, Staff)
- [ ] Indexes on `roll_no`, `rfid_id`, `phone_no`
- [ ] Enforce 5 members per phone number (trigger, plus an app-level check for a friendly error)
- [ ] `sql/schema.sql` and `sql/seed.sql` (branches, students, RFID tags, non-students, one Admin and one Staff user)

### MongoDB
- [ ] Create all 5 collections
- [ ] Indexes: (`roll_no`, `date_time`), (`phone_no`, `date_time`), `health_issue`
- [ ] Schema validation rules per collection
- [ ] `scripts/seed_mongo.py` with sample visits across several dates and hours

## Phase 3: Flask Core
- [ ] App factory, config loading from `.env`, `db.py` connections
- [ ] Login and logout with hashed passwords
- [ ] `@role_required("Admin")` and `@role_required("Staff")` decorators
- [ ] Base template: Bootstrap navbar, flash messages, error pages (403, 404, 500)
- [ ] CSRF protection on forms
- [ ] Parameterized queries only (no string-built SQL)

## Phase 4: Staff Pages
- [ ] Category selector: Student / Non-Student
- [ ] **Student visit:** autofocus tap input, lookup by RFID (active tags only), show roll no, name, age, sex, branch, year, auto date/time, health-issue dropdown, remedy field, save to `student_visit`
- [ ] **Non-student existing:** enter phone, list registered names (max 5), pick one, auto-fill details, enter issue and remedy
- [ ] **Non-student new:** form for phone, name, age/DOB, sex, designation, reject if 5 already registered, then save and record the visit
- [ ] Manual roll-number fallback for forgotten or lost cards
- [ ] Clear messages for unknown or inactive tags
- [ ] Return focus to the tap input after each save so the next student can tap immediately

## Phase 5: Admin Pages
- [ ] Patient search by name, roll no or phone
- [ ] Edit patient details
- [ ] Edit or correct a visit record (log who changed what and when)
- [ ] Health history for a patient: date range, or all visits
- [ ] Reports (Chart.js): most common health issues, peak hours, most frequent visitors, visits by branch, visits by year
- [ ] Visits-in-a-period report

## Phase 6: Gym and Hostel Extension
- [ ] Gym tap page (toggle in/out, store date, in_time, out_time)
- [ ] Hostel tap page (toggle in/out)
- [ ] Home-trip page (out date/time, in date/time)
- [ ] Handle double taps, exit without entry, and missing exits

## Phase 7: RFID Hardware
- [ ] Test the reader with a real NIT Delhi ID card and note the exact tag format
- [ ] Normalise tag format (case, separators) so it matches the DB
- [ ] Confirm the reader sends Enter after the tag ID
- [ ] Confirm the tag ID is stable between taps and between readers
- [ ] Build a mock tap page for development without hardware

## Phase 8: Reliability and Security
- [ ] Scheduled backups: `pg_dump` and `mongodump` (`scripts/backup.sh`)
- [ ] Test restoring from backup (`scripts/restore.sh`)
- [ ] Restrict DB users to the minimum privileges the app needs
- [ ] Keep secrets in `.env` only, never in git
- [ ] Limit access to patient health data to logged-in staff and admins
- [ ] Session timeout and login attempt limiting

## Phase 9: Testing
- [ ] Unit tests: 5-member limit, tag lookup, inactive tags, timestamp set by server
- [ ] Test every report query against the seed data
- [ ] End-to-end flow: tap, fetch, submit, verify in DB
- [ ] Lookup speed check with 10k+ student rows
- [ ] Trial with real reader and Health Centre staff, collect feedback
- [ ] `uv run ruff check . && uv run pytest` passes before every PR

## Phase 10: Documentation and Submission
- [ ] README: setup, env vars, how to run, how to connect the reader
- [ ] Final ER diagram and internal schema diagram matching the built schema
- [ ] Final report and demo script
- [ ] Screenshots or demo video
- [ ] Tag release `v1.0`

---

## Out of Scope (per synopsis)
Diagnosis, billing, appointments, medicine stock management

## Assumptions
- Every student brings their ID card to the Health Centre
- Non-students are identified by phone number and name

## Stretch Goals
- [ ] CSV / PDF export of reports
- [ ] Health-issue autocomplete from past entries
- [ ] Gym and hostel occupancy dashboard
- [ ] Docker Compose for PostgreSQL and MongoDB
- [ ] Type checking with `ty`
