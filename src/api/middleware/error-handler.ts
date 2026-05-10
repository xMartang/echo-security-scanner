import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import type pino from 'pino';
import { ImageNotFoundError, ValidationError } from '@/common/utils/errors.js';

/**
 * Global Express error handler (4-arg signature).
 * Maps domain errors to HTTP status codes; logs unexpected 500s at error level.
 * Must be the LAST middleware registered in the app.
 */
export function createErrorHandler(logger: pino.Logger): ErrorRequestHandler {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof ImageNotFoundError) {
      res.status(404).json({ error: { message: err.message } });
      return;
    }

    if (err instanceof ValidationError) {
      res.status(400).json({
        error: { message: err.message, code: 'VALIDATION_ERROR' },
      });
      return;
    }

    // Unexpected error -- log it and return a generic 500
    logger.error({ err }, 'unhandled request error');
    res.status(500).json({ error: { message: 'Internal server error' } });
  };
}
