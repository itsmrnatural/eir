/** Express 4 does not catch rejected promises; wrap every async handler/middleware. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** Copy of obj without keys whose value is undefined. */
export function stripUndefined(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
