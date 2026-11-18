// Development seed users. DEVELOPMENT ONLY - never load these into a real deployment.
// The bcrypt hashes (cost 10, $2b$) are precomputed so the in-memory repositories need no
// dependencies; db/seed/seed.js re-hashes with bcryptjs when it loads a real database.
export const DEV_USERS = Object.freeze([
  { username: 'admin', password: 'admin123', role: 'ADMIN', password_hash: '$2b$10$KSVRHJ8PXfZ3wlA9RgDu.eQtil2OyCQaLwt2DGrkME.ws2rU24mei' },
  { username: 'staff', password: 'staff123', role: 'STAFF', password_hash: '$2b$10$6x2vW/nwxTGQ/qmGwtqtC.0kHnXG0eeGvCmR.8DKO.8BxNbkzVGnS' },
]);
export const BCRYPT_ROUNDS = 10;
