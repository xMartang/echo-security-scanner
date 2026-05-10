import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { ValidationError } from '@/common/utils/errors.js';

const SEVERITY_SCHEMA = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

/**
 * Validates the optional `?severity=` query param.
 * UNKNOWN is excluded -- it's an internal mapping, not a valid filter value.
 * Calls next(ValidationError) on bad input; calls next() when absent or valid.
 */
export function validateSeverity(req: Request, _res: Response, next: NextFunction): void {
  const { severity } = req.query;
  if (severity === undefined) {
    next();
    return;
  }

  const result = SEVERITY_SCHEMA.safeParse(severity);
  if (!result.success) {
    next(
      new ValidationError(
        `Invalid severity value: "${typeof severity === 'string' ? severity : JSON.stringify(severity)}". Must be one of: CRITICAL, HIGH, MEDIUM, LOW`,
        'severity',
      ),
    );
    return;
  }

  next();
}
