import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { validateSeverity } from '@/api/middleware/validate-severity.js';
import { ValidationError } from '@/common/utils/errors.js';

function makeContext(severityQuery?: string) {
  return {
    req: { query: severityQuery !== undefined ? { severity: severityQuery } : {} } as unknown as Request,
    res: {} as Response,
    next: jest.fn<NextFunction>() as unknown as NextFunction,
  };
}

describe('validateSeverity', () => {
  it('calls next() with no args when severity is absent', () => {
    const { req, res, next } = makeContext();
    validateSeverity(req, res, next);
    expect((next as jest.Mock)).toHaveBeenCalledWith();
  });

  it.each(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])(
    'calls next() with no args for valid severity %s',
    (severity) => {
      const { req, res, next } = makeContext(severity);
      validateSeverity(req, res, next);
      expect((next as jest.Mock)).toHaveBeenCalledWith();
    },
  );

  it('calls next(ValidationError) for invalid severity', () => {
    const { req, res, next } = makeContext('NEGLIGIBLE');
    validateSeverity(req, res, next);
    const [err] = (next as jest.Mock).mock.calls[0] as [unknown];
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain('NEGLIGIBLE');
    expect((err as ValidationError).field).toBe('severity');
  });

  it('rejects UNKNOWN -- it is an internal value, not a valid filter', () => {
    const { req, res, next } = makeContext('UNKNOWN');
    validateSeverity(req, res, next);
    const [err] = (next as jest.Mock).mock.calls[0] as [unknown];
    expect(err).toBeInstanceOf(ValidationError);
  });
});
