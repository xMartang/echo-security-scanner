import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@/api/middleware/async-handler.js';

function mockReqRes() {
  return {
    req: {} as Request,
    res: {} as Response,
    next: jest.fn<NextFunction>(),
  };
}

describe('asyncHandler', () => {
  it('calls the wrapped handler and does not call next on success', async () => {
    const { req, res, next } = mockReqRes();
    const handler = asyncHandler((_req, _res, _next) => Promise.resolve());

    await new Promise<void>((resolve) => {
      next.mockImplementation(resolve as (...args: unknown[]) => unknown);
      handler(req, res, next as unknown as NextFunction);
      setTimeout(resolve, 50);
    });

    expect(next).not.toHaveBeenCalled();
  });

  it('forwards rejected promise to next(err)', async () => {
    const { req, res, next } = mockReqRes();
    const expectedError = new Error('boom');
    const handler = asyncHandler(() => Promise.reject(expectedError));

    await new Promise<void>((resolve) => {
      next.mockImplementation(resolve as (...args: unknown[]) => unknown);
      handler(req, res, next as unknown as NextFunction);
    });

    expect(next).toHaveBeenCalledWith(expectedError);
  });
});
