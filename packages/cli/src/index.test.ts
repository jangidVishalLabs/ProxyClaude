import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildProgram, handleError } from './index.js';
import { CliError } from './lib/errors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function captureExit(fn: () => void): { code: number | undefined; err: string } {
  let code: number | undefined;
  let err = '';
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c;
    throw new Error('__exit__');
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => {
    err += s;
    return true;
  }) as never);
  try {
    fn();
  } catch (e) {
    if (!(e instanceof Error) || e.message !== '__exit__') throw e;
  }
  return { code, err };
}

describe('handleError', () => {
  it('exits with the CliError exit code and prints the message', () => {
    const { code, err } = captureExit(() =>
      handleError(new CliError('access denied', 'ACCESS_DENIED', 3)),
    );
    expect(code).toBe(3);
    expect(err).toContain('access denied');
  });

  it('maps AUTH_INVALID to exit code 2', () => {
    const { code } = captureExit(() => handleError(new CliError('bad', 'AUTH_INVALID')));
    expect(code).toBe(2);
  });

  it('exits 1 for an unknown error', () => {
    const { code, err } = captureExit(() => handleError(new Error('boom')));
    expect(code).toBe(1);
    expect(err).toContain('unexpected error');
  });
});

describe('buildProgram', () => {
  it('registers the expected commands', () => {
    const names = buildProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toEqual([
      'admin',
      'connect',
      'login',
      'logout',
      'projects',
      'reconnect',
      'status',
      'sync',
    ]);
  });
});
