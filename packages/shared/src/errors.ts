/**
 * Typed error codes shared by API and CLI (plan §13).
 * API maps AppError -> JSON { code, message } + httpStatus.
 * CLI maps code -> friendly message + exit code.
 */

export const ErrorCode = {
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  USER_DISABLED: 'USER_DISABLED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVISION_FAILED: 'PROVISION_FAILED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const HTTP_STATUS: Record<ErrorCode, number> = {
  AUTH_INVALID: 401,
  AUTH_TOKEN_EXPIRED: 401,
  USER_DISABLED: 403,
  ACCESS_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PROVISION_FAILED: 500,
  INTERNAL: 500,
};

/** CLI process exit codes per plan §13. */
const EXIT_CODE: Record<ErrorCode, number> = {
  AUTH_INVALID: 2,
  AUTH_TOKEN_EXPIRED: 2,
  USER_DISABLED: 2,
  ACCESS_DENIED: 3,
  NOT_FOUND: 1,
  VALIDATION_FAILED: 1,
  CONFLICT: 1,
  RATE_LIMITED: 1,
  PROVISION_FAILED: 1,
  INTERNAL: 1,
};

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  get exitCode(): number {
    return EXIT_CODE[this.code];
  }

  toBody(): ErrorBody {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function httpStatusForCode(code: ErrorCode): number {
  return HTTP_STATUS[code];
}

export function exitCodeForCode(code: ErrorCode): number {
  return EXIT_CODE[code];
}
