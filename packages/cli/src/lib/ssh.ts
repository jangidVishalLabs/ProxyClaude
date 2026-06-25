import { spawn } from 'node:child_process';

export interface SshLaunch {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  projectPath: string;
  tmuxName: string;
}

/** Single-quote a string for safe embedding in a remote shell command. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the ssh argv for an interactive, persistent session (plan §5, §8).
 * `tmux new-session -A` attaches if the session exists, creates it otherwise —
 * so connect and reconnect are the same operation. ServerAlive* keeps the
 * connection from silently dying on a flaky network.
 */
export function buildSshArgs(launch: SshLaunch): string[] {
  const remote = `cd ${shQuote(launch.projectPath)} && exec tmux new-session -A -s ${shQuote(
    launch.tmuxName,
  )}`;
  return [
    '-t',
    '-i',
    launch.keyPath,
    '-p',
    String(launch.port),
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-o',
    'StrictHostKeyChecking=accept-new',
    `${launch.user}@${launch.host}`,
    remote,
  ];
}

/** Launch the interactive SSH+tmux session, inheriting the terminal. */
export function launchSsh(launch: SshLaunch): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', buildSshArgs(launch), { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });
}
