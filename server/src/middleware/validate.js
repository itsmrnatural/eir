import { AppError } from '../errors.js';

function formatIssue(where, issue) {
  let message = issue.message;
  if (issue.code === 'invalid_type' && issue.received === 'undefined') message = 'is required';
  if (issue.code === 'unrecognized_keys') {
    message = `unknown or forbidden field(s): ${issue.keys.join(', ')}`;
  }
  return { in: where, path: issue.path.join('.'), message };
}

function summarize(issues) {
  const shown = issues
    .slice(0, 3)
    .map((i) => `${i.in}${i.path ? `.${i.path}` : ''}: ${i.message}`)
    .join('; ');
  return `Invalid request: ${shown}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ''}`;
}

/**
 * validate({ params, query, body }) -> middleware. Parsed (and normalised) values are placed on
 * req.valid.{params,query,body}; handlers must read from there, never from req.body directly.
 */
export function validate(schemas = {}) {
  const parts = [
    ['params', schemas.params, (req) => req.params],
    ['query', schemas.query, (req) => req.query],
    ['body', schemas.body, (req) => req.body],
  ];
  return (req, _res, next) => {
    const valid = {};
    const issues = [];
    for (const [where, schema, read] of parts) {
      if (!schema) continue;
      const result = schema.safeParse(read(req));
      if (result.success) valid[where] = result.data;
      else issues.push(...result.error.issues.map((i) => formatIssue(where, i)));
    }
    if (issues.length) return next(new AppError('VALIDATION_ERROR', summarize(issues), { issues }));
    req.valid = valid;
    return next();
  };
}
