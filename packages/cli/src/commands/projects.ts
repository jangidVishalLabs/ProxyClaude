import { requireLogin } from '../lib/session.js';
import { makeApiClient, type MakeClient } from '../lib/clientFactory.js';
import { consoleIo, type Io } from '../lib/io.js';

export interface ProjectsDeps {
  io?: Io;
  makeClient?: MakeClient;
}

export async function runProjects(deps: ProjectsDeps = {}): Promise<void> {
  const io = deps.io ?? consoleIo;
  const makeClient = deps.makeClient ?? makeApiClient;

  const creds = requireLogin();
  const client = makeClient(creds.apiUrl, {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
  });

  const { projects } = await client.listProjects();
  if (projects.length === 0) {
    io.out('No projects assigned. Ask an admin to assign you to a project.');
    return;
  }

  const width = Math.max(...projects.map((p) => p.slug.length), 4);
  io.out(`${'SLUG'.padEnd(width)}  NAME`);
  for (const p of projects) {
    io.out(`${p.slug.padEnd(width)}  ${p.name}`);
  }
}
