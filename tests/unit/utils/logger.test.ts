import { createLogger } from '@/common/utils/log/logger.js';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR = join('./logs', 'local');
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Log file naming: current file = api.debug.log (symlink on Linux/Docker),
 * rotated files = api.debug.log.1, api.debug.log.2, …
 * This helper finds whichever is present (symlink or numbered fallback).
 */
async function readLevelFile(
  dir: string,
  serviceName: string,
  level: string,
  timeoutMs = 2000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const files = await readdir(dir);
      // Prefer the symlink (api.debug.log); fall back to any numbered file
      // (api.debug.log.1, api.debug.log.2, …) on platforms where symlinks
      // are unavailable.
      const match =
        files.find((f) => f === `${serviceName}.${level}.log`) ??
        files.find((f) => f.startsWith(`${serviceName}.${level}.log.`));
      if (match) return readFile(join(dir, match), 'utf-8');
    } catch {
      // dir may not exist yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${serviceName}.${level}.log in ${dir}`);
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

  // ── timestamp format ────────────────────────────────────────────────────────

  it('emits time as ISO-8601 string, not epoch ms', async () => {
    const logger = createLogger({ serviceName: 'ts-test', dir, level: 'debug' });
    logger.info('timestamp check');
    const content = await readLevelFile(dir, 'ts-test', 'info');
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(typeof parsed.time).toBe('string');
    expect(String(parsed.time)).toMatch(ISO_RE);
  });

  // ── cumulative routing ──────────────────────────────────────────────────────

  it('debug records go to debug.log ONLY (below info threshold)', async () => {
    const logger = createLogger({ serviceName: 'test', dir, level: 'debug' });
    logger.debug({ x: 1 }, 'hello debug');
    const content = await readLevelFile(dir, 'test', 'debug');
    expect(content).toContain('hello debug');
    expect(JSON.parse(content.trim())).toMatchObject({ level: 'debug', msg: 'hello debug' });
    // debug is below info threshold — must NOT appear in info.log or error.log
    // Wait briefly for any stray writes then re-read
    await new Promise((r) => setTimeout(r, 300));
    const filesAfter = await readdir(dir);
    expect(filesAfter.some((f) => f.startsWith('test.info.'))).toBe(false);
    expect(filesAfter.some((f) => f.startsWith('test.error.'))).toBe(false);
  });

  it('info records go to debug.log AND info.log', async () => {
    const logger = createLogger({ serviceName: 'test', dir, level: 'debug' });
    logger.info({ x: 2 }, 'hello info');
    const [infoContent, debugContent] = await Promise.all([
      readLevelFile(dir, 'test', 'info'),
      readLevelFile(dir, 'test', 'debug'),
    ]);
    expect(infoContent).toContain('hello info');
    expect(debugContent).toContain('hello info');
    expect(JSON.parse(infoContent.trim())).toMatchObject({ level: 'info', msg: 'hello info' });
  });

  it('warn records go to debug.log AND info.log', async () => {
    const logger = createLogger({ serviceName: 'test', dir, level: 'debug' });
    logger.warn({ x: 3 }, 'hello warn');
    const [infoContent, debugContent] = await Promise.all([
      readLevelFile(dir, 'test', 'info'),
      readLevelFile(dir, 'test', 'debug'),
    ]);
    expect(infoContent).toContain('hello warn');
    expect(debugContent).toContain('hello warn');
    expect(JSON.parse(infoContent.trim())).toMatchObject({ level: 'warn', msg: 'hello warn' });
  });

  it('error records go to ALL THREE files (debug, info, error)', async () => {
    const logger = createLogger({ serviceName: 'test', dir, level: 'debug' });
    logger.error({ err: new Error('boom') }, 'hello error');
    const [errorContent, infoContent, debugContent] = await Promise.all([
      readLevelFile(dir, 'test', 'error'),
      readLevelFile(dir, 'test', 'info'),
      readLevelFile(dir, 'test', 'debug'),
    ]);
    expect(errorContent).toContain('hello error');
    expect(infoContent).toContain('hello error');
    expect(debugContent).toContain('hello error');
    expect(JSON.parse(errorContent.trim())).toMatchObject({ level: 'error', msg: 'hello error' });
  });

  it('pino filters out debug-level records when logger level is info', async () => {
    const logger = createLogger({ serviceName: 'nodebug', dir, level: 'info' });
    logger.debug('should not appear — below info threshold');
    logger.info('trigger write to both debug.log and info.log');
    // debug.log exists (cumulative routing: info records land there too),
    // but must NOT contain the debug-level message pino suppressed.
    const debugContent = await readLevelFile(dir, 'nodebug', 'debug');
    expect(debugContent).not.toContain('should not appear');
    expect(debugContent).toContain('trigger write');
  });

  // Verifies that logs land in ./logs/local/ — the plan's done-condition
  it('writes to LOG_DIR when using the project log dir', async () => {
    const logger = createLogger({ serviceName: 'e2e-verify', dir: LOG_DIR, level: 'debug' });
    logger.info('e2e log entry');
    const content = await readLevelFile(LOG_DIR, 'e2e-verify', 'info');
    expect(content).toContain('e2e log entry');
  });
});
