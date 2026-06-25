import { getConfig } from './config.js';
import { buildServer } from './server.js';

/** Boot the API server. */
async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildServer({ logLevel: config.NODE_ENV === 'test' ? 'silent' : 'info' });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
