import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { loginBody } from '../validation/schemas.js';

export function authRouter({ services, auth, validate, loginLimiter }) {
  const r = Router();

  r.post(
    '/login',
    loginLimiter,
    validate({ body: loginBody }),
    asyncHandler(async (req, res) => {
      res.json(await services.auth.login(req.valid.body));
    }),
  );

  r.get('/me', auth.requireAuth, (req, res) => {
    res.json(services.auth.me(req.user));
  });

  return r;
}
