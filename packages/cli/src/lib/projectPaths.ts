import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configDir } from './paths.js';

/**
 * Maps a project slug to the local checkout path on the developer's machine,
 * so `proxyclaude sync <slug>` knows which repo to update (plan §9).
 */
function storePath(): string {
  return join(configDir(), 'projects.json');
}

type PathMap = Record<string, string>;

function readMap(): PathMap {
  const path = storePath();
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as PathMap) : {};
  } catch {
    return {};
  }
}

export function getProjectPath(slug: string): string | undefined {
  return readMap()[slug];
}

export function setProjectPath(slug: string, localPath: string): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const map = readMap();
  map[slug] = localPath;
  writeFileSync(path, JSON.stringify(map, null, 2), { mode: 0o600 });
}
