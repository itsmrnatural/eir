import { validationError } from './errors.js';
import { BCRYPT_ROUNDS } from './dev-users.js';
import { ROLES } from './validation.js';

export const MIN_PASSWORD_LENGTH = 8;

/** bcryptjs is imported lazily so the in-memory repositories never need it. */
export async function bcryptHash(password) {
  const { default: bcrypt } = await import('bcryptjs');
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function createUser({ repos, username, role, password, hash = bcryptHash }) {
  if (!ROLES.includes(role)) throw validationError(`role must be one of ${ROLES.join(' or ')}`, { field: 'role' });
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw validationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`, { field: 'password' });
  }
  return repos.users.create({ username, password_hash: await hash(password), role });
}
