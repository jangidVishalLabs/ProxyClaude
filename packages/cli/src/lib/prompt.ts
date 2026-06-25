import { createInterface } from 'node:readline';

/** Ask a yes/no question on the TTY. Defaults to no. */
export function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/** Read a password from the TTY without echoing it. */
export function promptPassword(promptText = 'Password: '): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdout = process.stdout as NodeJS.WriteStream & { _writeToOutput?: (s: string) => void };
    process.stdout.write(promptText);
    // Mute echoed characters.
    stdout._writeToOutput = (str: string) => {
      if (str.includes('\n') || str.includes('\r')) process.stdout.write(str);
    };
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
