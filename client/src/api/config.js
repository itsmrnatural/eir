const env = import.meta.env ?? {};
const fallback = env.MODE === 'mock' ? '/api/v1' : 'http://localhost:4000/api/v1';

/** Base URL for every request, e.g. http://localhost:4000/api/v1 (no trailing slash). */
export const API_BASE_URL = String(env.VITE_API_BASE_URL || fallback).replace(/\/+$/, '');
