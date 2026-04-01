import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const WINDOWS_TEMURIN_JRE = {
  version: '21.0.10_7',
  downloadUrl:
    'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_windows_hotspot_21.0.10_7.zip',
};

function commandExists(command, env = process.env) {
  const probe = spawnSync(command, ['-version'], {
    stdio: 'ignore',
    env,
    shell: false,
  });
  return probe.status === 0;
}

function findJavaBinary(rootDir) {
  if (!fs.existsSync(rootDir)) return null;
  const queue = [rootDir];
  const binaryName = process.platform === 'win32' ? 'java.exe' : 'java';
  while (queue.length > 0) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(resolved);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === binaryName) {
        return resolved;
      }
    }
  }
  return null;
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'KWG-collab-gate' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Java runtime from ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function extractZip(zipPath, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  const result = spawnSync('tar', ['-xf', zipPath, '-C', destinationDir], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to extract Java runtime archive ${zipPath}`);
  }
}

async function ensureWindowsTemurinJre() {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const cacheRoot = path.join(localAppData, 'KWG-tools', 'temurin-jre');
  const versionDir = path.join(cacheRoot, WINDOWS_TEMURIN_JRE.version);
  const existingBinary = findJavaBinary(versionDir);
  if (existingBinary) return existingBinary;

  const archiveDir = path.join(cacheRoot, 'downloads');
  const archivePath = path.join(archiveDir, `OpenJDK21U-jre_x64_windows_hotspot_${WINDOWS_TEMURIN_JRE.version}.zip`);
  fs.mkdirSync(archiveDir, { recursive: true });

  if (!fs.existsSync(archivePath)) {
    process.stdout.write(`[collab:java] Downloading pinned Temurin JRE ${WINDOWS_TEMURIN_JRE.version}\n`);
    await downloadFile(WINDOWS_TEMURIN_JRE.downloadUrl, archivePath);
  }

  const extractRoot = path.join(versionDir, 'runtime');
  if (!findJavaBinary(extractRoot)) {
    process.stdout.write(`[collab:java] Extracting pinned Temurin JRE ${WINDOWS_TEMURIN_JRE.version}\n`);
    fs.rmSync(extractRoot, { recursive: true, force: true });
    extractZip(archivePath, extractRoot);
  }

  const javaBinary = findJavaBinary(extractRoot);
  if (!javaBinary) {
    throw new Error(`Pinned Temurin JRE extracted without a java binary under ${extractRoot}`);
  }
  return javaBinary;
}

export async function ensureJavaBinary() {
  const explicitJavaBin = process.env.KWG_JAVA_BIN;
  if (explicitJavaBin && fs.existsSync(explicitJavaBin)) return explicitJavaBin;

  const javaHome = process.env.KWG_JAVA_HOME ?? process.env.JAVA_HOME;
  if (javaHome) {
    const javaBinary = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(javaBinary)) return javaBinary;
  }

  if (commandExists(process.platform === 'win32' ? 'java.exe' : 'java')) {
    return process.platform === 'win32' ? 'java.exe' : 'java';
  }

  if (process.platform === 'win32') {
    return ensureWindowsTemurinJre();
  }

  throw new Error(
    'Java is required for the Firestore emulator. Install Java, set JAVA_HOME, or set KWG_JAVA_BIN before running test:firestore-rules.',
  );
}
