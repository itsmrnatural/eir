// Lets scripts that only need the users table run without a MongoDB connection.
import { createUsersRepo } from '../repositories/pg-mongo/users-meta.js';

export const createUsersRepoOnly = (pgPool) => ({ users: createUsersRepo({ pgPool }) });
