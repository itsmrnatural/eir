import { validateUserInput } from '../../lib/validation.js';
import { publicHealthIssues } from '../../lib/reference-data.js';
import { mapPgError } from './pg-helpers.js';

export function createUsersRepo({ pgPool }) {
  return {
    async findByUsername(username) {
      const res = await pgPool.query('SELECT user_id, username, password_hash, role FROM users WHERE username = $1', [String(username)]);
      return res.rows[0] ?? null;
    },
    async create(input) {
      const v = validateUserInput(input ?? {});
      try {
        const res = await pgPool.query(
          'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING user_id, username, role',
          [v.username, v.password_hash, v.role],
        );
        return res.rows[0];
      } catch (err) {
        throw mapPgError(err);
      }
    },
  };
}

export function createMetaRepo({ pgPool }) {
  return {
    async listBranches() {
      const res = await pgPool.query('SELECT branch_id, branch_code, branch_name FROM branch ORDER BY branch_code');
      return res.rows;
    },
    // The health-issue list is configuration (db/seed/health-issues.json), not a table.
    async listHealthIssues() {
      return publicHealthIssues();
    },
  };
}
