import { createLogger } from '@/utils/logger.js';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR = join('./logs', 'local');

/**
 * pino-roll appends a sequence number to the filename base:
 * e.g. api.debug.1.log, api.info.1.log, api.error.1.log
 */
async function readLevelFile(dir: string, serviceName: string, level: string, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const files = await readdir(dir);
      const match = files.find((f) => f.startsWith(`${serviceName}.${level}.`) && f.endsWith('.log'));
      if (match) return readFile(join(dir, match), 'utf-8');
    } catch {
      // dir may not exist yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${serviceName}.${level}.*.log in ${dir}`);
}

describe('createLogger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await (async () => {
      const d = join(tmpdir(), `logger-test-${Date.now()}`);
      await mkdir(d, { recursive: true });
      return d;
    })();
  });

  it('routes debug records to <service>.debug.*.log', async () => {
    const logger = createLogger({ serviceName: 'test', dir, level: 'debug' });
    logger.debug({ x: 1 }, 'hello debug');
    const content = await readLevelFile(dir, 'test', 'debug');
    expect(content).toContain('hello debug');
    expect(JSON.parse(content.trim())).toMatchObject({ level: 20, msg: 'hello debug' });
  });

  it('routes info records to <service>.info.*.log', async () => {
    const logger = createLogger({ serviceName: 'test', dir, level: 'debug' });
    logger.info({ x: 2 }, 'hello info');
    const content = await readLevelFile(dir, 'test', 'info');
    expect(content).toContain('hello info');
    expect(JSON.parse(content.trim())).toMatchObject({ level: 30, msg: 'hello info' });
  });

  it('routes warn records to <service>.info.*.log (folded)', async () => {
    const logger = createLogger({ serviceName: 'test', dir, level: 'debug' });
    logger.warn({ x: 3 }, 'hello warn');
    const content = await readLevelFile(dir, 'test', 'info');
    expect(content).toContain('hello warn');
    expect(JSON.parse(content.trim())).toMatchObject({ level: 40, msg: 'hello warn' });
  });

  it('routes error records to <service>.error.*.log', async () => {
    const logger = createLogger({ serviceName: 'test', dir, level: 'debug' });
    logger.error({ err: new Error('boom') }, 'hello error');
    const content = await readLevelFile(dir, 'test', 'error');
    expect(content).toContain('hello error');
    expect(JSON.parse(content.trim())).toMatchObject({ level: 50, msg: 'hello error' });
  });

  it('does not write debug records when level is info', async () => {
    const logger = createLogger({ serviceName: 'nodebug', dir, level: 'info' });
    logger.debug('should not appear');
    logger.info('trigger info write');
    await readLevelFile(dir, 'nodebug', 'info');
    const files = await readdir(dir);
    expect(files.some((f) => f.startsWith('nodebug.debug.'))).toBe(false);
  });

  // Verifies that logs land in ./logs/local/ — the plan's done-condition
  it('writes to LOG_DIR when using the project log dir', async () => {
    const logger = createLogger({ serviceName: 'e2e-verify', dir: LOG_DIR, level: 'debug' });
    logger.info('e2e log entry');
    const content = await readLevelFile(LOG_DIR, 'e2e-verify', 'info');
    expect(content).toContain('e2e log entry');
  });
});
