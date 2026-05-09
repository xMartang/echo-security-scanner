import { parseEnv } from '@/config/env.js';

const validEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/testdb',
  REDIS_URL: 'redis://localhost:6379',
  TRIVY_SERVER_URL: 'http://trivy-server:8080',
  SERVICE_NAME: 'test-api',
};

describe('parseEnv', () => {
  it('parses valid env with required fields only', () => {
    const result = parseEnv(validEnv);
    expect(result.PORT).toBe(3000);
    expect(result.LOG_LEVEL).toBe('info');
    expect(result.SCAN_INTERVAL_MS).toBe(900_000);
    expect(result.LOG_DIR).toBe('./logs/local');
    expect(result.SERVICE_NAME).toBe('test-api');
  });

  it('respects overridden defaults', () => {
    const result = parseEnv({
      ...validEnv,
      PORT: '4000',
      LOG_LEVEL: 'debug',
      SCAN_INTERVAL_MS: '60000',
    });
    expect(result.PORT).toBe(4000);
    expect(result.LOG_LEVEL).toBe('debug');
    expect(result.SCAN_INTERVAL_MS).toBe(60_000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow('Invalid environment variables');
  });

  it('throws when REDIS_URL is missing', () => {
    const { REDIS_URL: _omit, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow('Invalid environment variables');
  });

  it('throws when TRIVY_SERVER_URL is missing', () => {
    const { TRIVY_SERVER_URL: _omit, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow('Invalid environment variables');
  });

  it('throws when SERVICE_NAME is missing', () => {
    const { SERVICE_NAME: _omit, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow('Invalid environment variables');
  });

  it('throws on invalid URL format', () => {
    expect(() =>
      parseEnv({ ...validEnv, DATABASE_URL: 'not-a-url' }),
    ).toThrow('Invalid environment variables');
  });

  it('throws on invalid LOG_LEVEL value', () => {
    expect(() =>
      parseEnv({ ...validEnv, LOG_LEVEL: 'verbose' }),
    ).toThrow('Invalid environment variables');
  });
});
