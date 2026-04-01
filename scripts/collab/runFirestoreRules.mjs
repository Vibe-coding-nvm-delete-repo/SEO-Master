import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ensureJavaBinary } from './ensureJava.mjs';

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const innerCommand = 'npx vitest run src/firestore.rules.emulator.test.ts';
const javaBinary = await ensureJavaBinary();
const javaBinDir = path.dirname(javaBinary);
const javaHome = path.dirname(javaBinDir);
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${javaBinDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
};

const result = process.platform === 'win32'
  ? spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `npx firebase emulators:exec --only firestore --project demo-kwg '${innerCommand}'`,
      ],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        env,
      },
    )
  : spawnSync(
      npxCommand,
      [
        'firebase',
        'emulators:exec',
        '--only',
        'firestore',
        '--project',
        'demo-kwg',
        innerCommand,
      ],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        env,
      },
    );

if (result.error) {
  console.error('[collab:firestore-rules] Failed to launch Firestore emulator command.');
  console.error(result.error);
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
