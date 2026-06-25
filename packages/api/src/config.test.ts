import { describe, it, expect } from 'vitest';
import { parseConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('parseConfig', () => {
  it('accepts a valid env with defaults applied', () => {
    const c = parseConfig(valid as NodeJS.ProcessEnv);
    expect(c.NODE_ENV).toBe('development');
    expect(c.PORT).toBe(3000);
    expect(c.ACCESS_TOKEN_TTL).toBe('15m');
    expect(c.REFRESH_TOKEN_TTL_DAYS).toBe(30);
  });

  it('coerces PORT from string', () => {
    const c = parseConfig({ ...valid, PORT: '8080' } as NodeJS.ProcessEnv);
    expect(c.PORT).toBe(8080);
  });

  it('rejects a short JWT secret', () => {
    expect(() =>
      parseConfig({ ...valid, JWT_ACCESS_SECRET: 'too-short' } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => parseConfig(rest as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => parseConfig({ ...valid, NODE_ENV: 'staging' } as NodeJS.ProcessEnv)).toThrow();
  });
});
