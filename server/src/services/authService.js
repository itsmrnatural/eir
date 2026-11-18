import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from '../errors.js';

// Compared against when the username does not exist, so "unknown user" and "wrong password"
// take about the same time and cannot be told apart by timing.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const publicUser = (u) => ({ user_id: u.user_id, username: u.username, role: u.role });

export function createAuthService({ repos, config }) {
  return {
    async login({ username, password }) {
      const user = await repos.users.findByUsername(username);
      const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !ok) throw new AppError('UNAUTHENTICATED', 'Invalid username or password');

      const token = jwt.sign({ username: user.username, role: user.role }, config.jwtSecret, {
        algorithm: 'HS256',
        expiresIn: config.jwtExpiresIn,
        subject: String(user.user_id),
      });
      return { token, user: publicUser(user) };
    },

    /** req.user was loaded from the database by requireAuth. */
    me(user) {
      return publicUser(user);
    },
  };
}
