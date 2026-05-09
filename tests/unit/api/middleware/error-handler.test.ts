import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { createErrorHandler } from '@/api/middleware/error-handler.js';
import { ImageNotFoundError, ValidationError } from '@/utils/errors.js';

const silentLogger = pino({ level: 'silent' });
const handler = createErrorHandler(silentLogger);

function makeResponse() {
  const json = jest.fn<(body: unknown) => Response>();
  const status = jest.fn<(code: number) => Response>().mockReturnThis();
  return { json, status, res: { json, status } as unknown as Response };
}

describe('createErrorHandler', () => {
  const req = {} as Request;
  const next = (() => undefined) as unknown as NextFunction;

  it('returns 404 for ImageNotFoundError', () => {
    const { res, status, json } = makeResponse();
    handler(new ImageNotFoundError('nginx', '1.19'), req, res, next);
    expect(status).toHaveBeenCalledWith(404);
    const body = (json.mock.calls[0] as [{ error: { message: string } }])[0];
    expect(body.error.message).toContain('nginx');
  });

  it('returns 400 with VALIDATION_ERROR code for ValidationError', () => {
    const { res, status, json } = makeResponse();
    handler(new ValidationError('bad input', 'severity'), req, res, next);
    expect(status).toHaveBeenCalledWith(400);
    const body = (json.mock.calls[0] as [{ error: { code: string } }])[0];
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 for unknown errors', () => {
    const { res, status, json } = makeResponse();
    handler(new Error('database exploded'), req, res, next);
    expect(status).toHaveBeenCalledWith(500);
    const body = (json.mock.calls[0] as [{ error: { message: string } }])[0];
    expect(body.error.message).toBe('Internal server error');
  });
});
