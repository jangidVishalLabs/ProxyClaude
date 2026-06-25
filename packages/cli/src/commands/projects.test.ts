import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProjects } from './projects.js';
import { saveCredentials } from '../lib/credentials.js';
import { CliError } from '../lib/errors.js';

let home: string;
const lines: string[] = [];
const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pc-proj-'));
  process.env.PROXYCLAUDE_HOME = home;
  lines.length = 0;
});
afterEach(() => {
  delete process.env.PROXYCLAUDE_HOME;
  rmSync(home, { recursive: true, force: true });
});

function login() {
  saveCredentials({ apiUrl: 'http://api', email: 'd@x.com', accessToken: 'a', refreshToken: 'r' });
}

describe('runProjects', () => {
  it('fails when not logged in', async () => {
    await expect(runProjects({ io })).rejects.toBeInstanceOf(CliError);
  });

  it('renders a table of assigned projects', async () => {
    login();
    const listProjects = vi.fn().mockResolvedValue({
      projects: [
        { id: '1', slug: 'alpha', name: 'Alpha', repoUrl: null, defaultBranch: 'main' },
        {
          id: '2',
          slug: 'client-plugin',
          name: 'Client Plugin',
          repoUrl: null,
          defaultBranch: 'main',
        },
      ],
    });
    await runProjects({ io, makeClient: () => ({ listProjects }) as never });
    const out = lines.join('\n');
    expect(out).toContain('SLUG');
    expect(out).toContain('alpha');
    expect(out).toContain('client-plugin');
    expect(out).toContain('Client Plugin');
  });

  it('shows a helpful message when no projects are assigned', async () => {
    login();
    const listProjects = vi.fn().mockResolvedValue({ projects: [] });
    await runProjects({ io, makeClient: () => ({ listProjects }) as never });
    expect(lines.join('\n')).toContain('No projects assigned');
  });
});
