import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type pino from 'pino';

/**
 * Returns middleware that logs each completed request: method, path, status,
 * and duration in milliseconds. Uses the provided pino logger.
 */
export function createRequestLogger(logger: pino.Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startMs = Date.now();

    res.on('finish', () => {
      logger.info({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startMs,
      }, 'http request');
    });

    next();
  };
}
