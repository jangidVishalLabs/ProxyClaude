/**
 * Test environment defaults. Real secrets are irrelevant in tests; we only
 * need values that satisfy config validation. Integration tests hit a
 * dedicated DB (proxyclaude_test) so they never touch dev/seed data.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'b'.repeat(32);
process.env.ACCESS_TOKEN_TTL ||= '15m';
process.env.REFRESH_TOKEN_TTL_DAYS ||= '30';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://proxyclaude:proxyclaude@localhost:5432/proxyclaude_test?schema=public';
