import { AppError, toErrorResponse } from '../errors.js';

/** Unmatched route -> 404 in the error envelope. */
export function notFoundHandler(req, _res, next) {
  next(new AppError('NOT_FOUND', 'Route not found'));
}

/** The single place where errors become HTTP responses. */
export function createErrorHandler(logger) {
  // Express recognises error handlers by their 4-argument signature.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    const { status, body } = toErrorResponse(err);
    const log = req.log || logger;
    if (status >= 500) log.error({ err }, 'unhandled error');
    else log.debug({ code: body.error.code }, 'request rejected');

    if (body.error.code === 'UNAUTHENTICATED') res.set('WWW-Authenticate', 'Bearer');
    return res.status(status).json(body);
  };
}
