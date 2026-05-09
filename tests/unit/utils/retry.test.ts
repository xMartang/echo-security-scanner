import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { retryOnPrismaError } from '@/utils/retry.js';

function makeDeadlockError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('deadlock detected', {
    code: 'P2034',
    clientVersion: '6.0.0',
  });
}

function makePoolTimeoutError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('connection pool timeout', {
    code: 'P2024',
    clientVersion: '6.0.0',
  });
}

function makeOtherError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique constraint', {
    code: 'P2002',
    clientVersion: '6.0.0',
  });
}

describe('retryOnPrismaError', () => {
  it('returns immediately on success', async () => {
    const fn = jest.fn<() => Promise<string>>().mockResolvedValue('ok');
    const result = await retryOnPrismaError(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries P2034 and succeeds on third call', async () => {
    let calls = 0;
    const fn = jest.fn<() => Promise<string>>().mockImplementation(() => {
      calls++;
      if (calls < 3) return Promise.reject(makeDeadlockError());
      return Promise.resolve('success');
    });

    const result = await retryOnPrismaError(fn, { baseDelayMs: 1 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on non-deadlock Prisma error (no retry)', async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(makeOtherError());
    await expect(retryOnPrismaError(fn, { baseDelayMs: 1 })).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on non-Prisma errors (no retry)', async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('network error'));
    await expect(retryOnPrismaError(fn, { baseDelayMs: 1 })).rejects.toThrow('network error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting maxRetries on persistent deadlock', async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(makeDeadlockError());
    await expect(retryOnPrismaError(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toMatchObject({
      code: 'P2034',
    });
    // initial attempt + 2 retries = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries P2024 (connection pool timeout) the same as P2034', async () => {
    let calls = 0;
    const fn = jest.fn<() => Promise<string>>().mockImplementation(() => {
      calls++;
      if (calls < 2) return Promise.reject(makePoolTimeoutError());
      return Promise.resolve('ok');
    });

    const result = await retryOnPrismaError(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects custom maxRetries', async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(makeDeadlockError());
    await expect(retryOnPrismaError(fn, { maxRetries: 1, baseDelayMs: 1 })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
