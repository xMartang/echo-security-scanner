import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandlerFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Wraps an async route handler so unhandled Promise rejections are forwarded
 * to Express's global error handler via next(err) instead of crashing.
 */
export function asyncHandler(fn: AsyncHandlerFn): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
