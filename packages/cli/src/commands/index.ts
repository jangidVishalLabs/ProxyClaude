import type { Command } from 'commander';
import { runLogin } from './login.js';
import { runLogout } from './logout.js';
import { runStatus } from './status.js';
import { runProjects } from './projects.js';
import { runConnect } from './connect.js';
import { runSync } from './sync.js';
import {
  runAdminUserList,
  runAdminUserCreate,
  runAdminUserProvision,
  runAdminUserDisable,
  runAdminProjectCreate,
  runAdminProjectUpdate,
  runAdminAssign,
  runAdminKeyList,
  runAdminKeyRevoke,
  runAdminAudit,
  runAdminOnboard,
} from './admin.js';
import { promptPassword, promptYesNo } from '../lib/prompt.js';

/** Wire all command actions onto the commander program. */
export function registerCommands(program: Command): void {
  program
    .command('login')
    .description('Authenticate with the ProxyClaude backend')
    .option('-e, --email <email>', 'account email')
    .option('-p, --password <password>', 'account password (prefer the interactive prompt)')
    .option('--api-url <url>', 'backend API URL')
    .action((opts) => runLogin(opts, { promptPassword }));

  program
    .command('logout')
    .description('Revoke the session and clear local credentials')
    .action(() => runLogout());

  program
    .command('status')
    .description('Show current login status and active sessions')
    .action(() => runStatus());

  program
    .command('projects')
    .description('List the projects you are assigned to')
    .action(() => runProjects());

  program
    .command('connect <project>')
    .description('Open a persistent session in a project workspace')
    .action(async (project: string) => {
      process.exitCode = await runConnect(project);
    });

  program
    .command('reconnect <project>')
    .description('Re-attach to your existing session after a disconnect')
    .action(async (project: string) => {
      process.exitCode = await runConnect(project, {}, { reconnect: true });
    });

  program
    .command('sync <project>')
    .description('Safely pull upstream changes into your local checkout')
    .option('--path <dir>', 'local repository path (remembered after first use)')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action((project: string, opts: { path?: string; yes?: boolean }) =>
      runSync(project, opts, { confirm: () => promptYesNo('Pull these changes?') }),
    );

  registerAdminCommands(program);
}

/** Admin subcommands (ADMIN role only): `pc admin <noun> <verb>`. */
function registerAdminCommands(program: Command): void {
  const admin = program.command('admin').description('Admin operations (requires an ADMIN login)');

  const user = admin.command('user').description('Manage developer/admin accounts');
  user
    .command('list')
    .description('List user accounts')
    .option('-e, --email <email>', 'filter to an exact email')
    .action((opts: { email?: string }) => runAdminUserList(opts));
  user
    .command('create <email>')
    .description('Create an account (auto-generates a temp password unless --password)')
    .option('-r, --role <role>', 'DEVELOPER or ADMIN', 'DEVELOPER')
    .option('-p, --password <password>', 'set an explicit password')
    .action((email: string, opts: { role?: string; password?: string }) =>
      runAdminUserCreate(email, opts),
    );
  user
    .command('provision <emailOrId>')
    .description("Provision the user's VPS workspace and allocate a vpsUsername")
    .action((emailOrId: string) => runAdminUserProvision(emailOrId));
  user
    .command('disable <emailOrId>')
    .description('Disable an account (blocks login + revokes refresh tokens)')
    .action((emailOrId: string) => runAdminUserDisable(emailOrId));

  const project = admin.command('project').description('Manage projects');
  project
    .command('create <slug>')
    .description('Create a project')
    .requiredOption('-n, --name <name>', 'display name')
    .option('--vps-path <path>', 'workspace path on the VPS')
    .option('--repo-url <url>', 'git remote URL')
    .action((slug: string, opts: { name?: string; vpsPath?: string; repoUrl?: string }) =>
      runAdminProjectCreate(slug, opts),
    );
  project
    .command('update <slug>')
    .description('Update a project (name / vpsPath / repoUrl)')
    .option('-n, --name <name>', 'display name')
    .option('--vps-path <path>', 'workspace path on the VPS')
    .option('--repo-url <url>', 'git remote URL')
    .action((slug: string, opts: { name?: string; vpsPath?: string; repoUrl?: string }) =>
      runAdminProjectUpdate(slug, opts),
    );

  admin
    .command('assign <email> <slug>')
    .description('Assign a user to a project')
    .action((email: string, slug: string) => runAdminAssign(email, slug));

  const key = admin.command('key').description('Manage SSH keys');
  key
    .command('list <email>')
    .description("List a user's SSH keys")
    .action((email: string) => runAdminKeyList(email));
  key
    .command('revoke [keyId]')
    .description('Revoke an SSH key (by keyId, or --user for their single active key)')
    .option('-u, --user <email>', 'revoke the user\'s sole active key')
    .action((keyId: string | undefined, opts: { user?: string }) =>
      runAdminKeyRevoke({ keyId, user: opts.user }),
    );

  admin
    .command('audit')
    .description('Show the audit log')
    .option('-a, --action <action>', 'filter by action')
    .option('-l, --limit <n>', 'max entries')
    .action((opts: { action?: string; limit?: string }) => runAdminAudit(opts));

  admin
    .command('onboard <email>')
    .description('Create + provision + assign a developer in one step')
    .requiredOption('--project <slug>', 'project to assign the developer to')
    .option('--create-project', 'create the project if it does not exist')
    .option('-n, --name <name>', 'project name (with --create-project)')
    .option('-r, --role <role>', 'DEVELOPER or ADMIN', 'DEVELOPER')
    .action(
      (
        email: string,
        opts: { project?: string; createProject?: boolean; name?: string; role?: string },
      ) => runAdminOnboard(email, opts),
    );
}
