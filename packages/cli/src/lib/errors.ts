import { exitCodeForCode, type ErrorCode } from '@proxyclaude/shared';

/**
 * Error type the CLI throws for known failures. Carries a process exit code so
 * the top-level handler can exit cleanly (plan §13).
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(
    message: string,
    readonly code: string = 'INTERNAL',
    exitCode?: number,
  ) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode ?? safeExit(code);
  }
}

function safeExit(code: string): number {
  try {
    return exitCodeForCode(code as ErrorCode);
  } catch {
    return 1;
  }
}
