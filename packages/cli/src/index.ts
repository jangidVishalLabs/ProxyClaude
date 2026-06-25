import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { CliError } from './lib/errors.js';
import { registerCommands } from './commands/index.js';

/**
 * Build the CLI program. Commands are registered by the modules in ./commands
 * (added per Phase 6 task). Kept as a factory so tests can build without running.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('proxyclaude')
    .description('CLI-first access to shared Claude Code workspaces')
    .version('0.0.0');

  registerCommands(program);
  return program;
}

export function handleError(err: unknown): never {
  if (err instanceof CliError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(err.exitCode);
  }
  process.stderr.write(`unexpected error: ${String(err)}\n`);
  process.exit(1);
}

/**
 * True when this module is the program entry point. Resolves argv[1] through
 * realpath + pathToFileURL so it still matches when invoked via an npm `bin`
 * symlink (argv[1] is the symlink, import.meta.url is the resolved file).
 */
function invokedAsBinary(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

// Run only when invoked as the binary (not when imported by tests).
if (invokedAsBinary()) {
  buildProgram().parseAsync(process.argv).catch(handleError);
}
