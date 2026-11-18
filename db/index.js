// Public entry point of the db package.
//   import { createRepositories, createInMemoryRepositories, AppError } from '../db/index.js';
// Importing this file loads no third-party module: the repositories receive an already-built
// pg Pool and Mongo Db from the caller.
export { createRepositories } from './repositories/pg-mongo/index.js';
export { createInMemoryRepositories } from './repositories/in-memory/index.js';
export { AppError, ERROR_CODES, ERROR_STATUS } from './lib/errors.js';
