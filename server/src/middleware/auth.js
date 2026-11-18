import jwt from 'jsonwebtoken';
import { AppError } from '../errors.js';
import { asyncHandler } from '../util/http.js';

const unauthenticated = (msg) => new AppError('UNAUTHENTICATED', msg);

/**
 * Builds the auth middleware for one app instance.
 *   requireAuth          - valid Bearer JWT AND the user still exists; sets req.user
 *   requireRole(...roles)- req.user.role must be one of roles (else 403 FORBIDDEN)
 *   staff                - [requireAuth, requireRole('STAFF','ADMIN')]   ("STAFF+")
 *   admin                - [requireAuth, requireRole('ADMIN')]
 *
 * The role used for authorisation is the one in the database, not the one baked into the
 * token, so a demoted or deleted account loses access immediately instead of after <= 1 h.
 */
export function createAuth({ repos, config }) {
  const requireAuth = asyncHandler(async (req, _res, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!match) throw unauthenticated('Missing or malformed Authorization header');

    let claims;
    try {
      claims = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'] });
    } catch (err) {
      throw unauthenticated(err?.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
    }

    const user = typeof claims.username === 'string' ? await repos.users.findByUsername(claims.username) : null;
    if (!user || String(user.user_id) !== String(claims.sub)) throw unauthenticated('Invalid token');

    req.user = { user_id: user.user_id, username: user.username, role: user.role };
    next();
  });

  const requireRole =
    (...roles) =>
    (req, _res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return next(new AppError('FORBIDDEN', 'You do not have permission to perform this action'));
      }
      return next();
    };

  return {
    requireAuth,
    requireRole,
    staff: [requireAuth, requireRole('STAFF', 'ADMIN')],
    admin: [requireAuth, requireRole('ADMIN')],
  };
}
