import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const EXPECTED = {
  repoName: 'KWG',
  projectId: 'new-final-8edfc',
  site: 'new-final-8edfc',
  title: 'SEO Magic',
  markers: [
    'SEO Magic',
    'Keyword clustering, page grouping, approval workflows & AI content generation',
    'Content',
  ],
  bundleRequiredMarkers: [
    'generate_finalize_timeout',
    'generate_finalize_error',
    'All outputs are produced. Saving the final results and cleaning up.',
  ],
  bundleForbiddenMarkers: [
    'Finalizing...',
    'All outputs are produced. Finishing persistence and cleanup.',
  ],
  previewChannel: 'kwg-verify',
};

const args = process.argv.slice(2);
const command = args[0] ?? 'check';
const allowDirty = args.includes('--allow-dirty');

const repoRoot = resolveRepoRoot();
const cwd = path.resolve(process.cwd());
const distDir = path.join(repoRoot, 'dist');
const distIndexPath = path.join(distDir, 'index.html');
const appSourcePath = path.join(repoRoot, 'src', 'App.tsx');
const firebaseConfigPath = path.join(repoRoot, 'firebase-applet-config.json');
const firebaseJsonPath = path.join(repoRoot, 'firebase.json');

await main().catch(fail);

async function main() {
  if (!['check', 'preview', 'live'].includes(command)) {
    throw new Error(`Unknown command "${command}". Use check, preview, or live.`);
  }

  runGuards({ allowDirty });

  if (command === 'check') {
    printSummary({
      mode: 'check',
      repoRoot,
      localTitle: readExpectedBundle().title,
      expectedAsset: readExpectedBundle().assetPath,
    });
    return;
  }

  run('npm', ['run', 'build'], repoRoot);
  const localBundle = readExpectedBundle();

  const previewUrl = deployPreview();
  const previewVerification = await verifyHostedRelease({
    label: 'preview',
    baseUrl: previewUrl,
    expectedAssetPath: localBundle.assetPath,
    expectedTitle: localBundle.title,
    expectedMarkers: EXPECTED.markers,
  });

  printSummary({
    mode: 'preview',
    repoRoot,
    localTitle: localBundle.title,
    expectedAsset: localBundle.assetPath,
    observedAsset: previewVerification.observedAssetPath,
    url: previewUrl,
    cacheControl: previewVerification.cacheControl,
  });

  if (command === 'live') {
    deployLive();
    const liveUrl = `https://${EXPECTED.site}.web.app`;
    const liveVerification = await verifyHostedRelease({
      label: 'live',
      baseUrl: liveUrl,
      expectedAssetPath: localBundle.assetPath,
      expectedTitle: localBundle.title,
      expectedMarkers: EXPECTED.markers,
    });

    printSummary({
      mode: 'live',
      repoRoot,
      localTitle: localBundle.title,
      expectedAsset: localBundle.assetPath,
      observedAsset: liveVerification.observedAssetPath,
      url: liveUrl,
      cacheControl: liveVerification.cacheControl,
    });
  }
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[release] ${message}`);
  process.exit(1);
}

function runGuards({ allowDirty: dirtyAllowed }) {
  if (cwd !== repoRoot) {
    throw new Error(`Run release commands from the repo root only.\nrepo root: ${repoRoot}\ncwd: ${cwd}`);
  }

  if (path.basename(repoRoot) !== EXPECTED.repoName) {
    throw new Error(`Release is locked to the ${EXPECTED.repoName} repo.\nresolved root: ${repoRoot}`);
  }

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    throw new Error(`Missing .git at repo root: ${repoRoot}`);
  }

  const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
  if (firebaseConfig.projectId !== EXPECTED.projectId) {
    throw new Error(`Unexpected Firebase project in firebase-applet-config.json.\nexpected: ${EXPECTED.projectId}\nactual: ${firebaseConfig.projectId}`);
  }

  const firebaseJson = JSON.parse(fs.readFileSync(firebaseJsonPath, 'utf8'));
  if (firebaseJson.hosting?.site !== EXPECTED.site) {
    throw new Error(`firebase.json hosting.site must be ${EXPECTED.site}.`);
  }

  const source = fs.readFileSync(appSourcePath, 'utf8');
  for (const marker of EXPECTED.markers) {
    if (!source.includes(marker)) {
      throw new Error(`Missing required KWG marker in src/App.tsx: ${marker}`);
    }
  }
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  if (!indexHtml.includes(`<title>${EXPECTED.title}</title>`)) {
    throw new Error(`index.html is missing expected title marker "${EXPECTED.title}".`);
  }

  const dirtyFiles = getDirtyTrackedFiles();
  if (dirtyFiles.length > 0) {
    console.error('[release] Tracked changes detected:');
    for (const dirtyFile of dirtyFiles) console.error(`  ${dirtyFile}`);
    if (!dirtyAllowed) {
      throw new Error('Deploy blocked because the worktree is dirty. Re-run with --allow-dirty only if intentional.');
    }
  }
}

function resolveRepoRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], process.cwd()).trim().replace(/\//g, path.sep);
}

function getDirtyTrackedFiles() {
  const raw = run('git', ['status', '--short', '--untracked-files=no'], repoRoot).trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readExpectedBundle() {
  if (!fs.existsSync(distIndexPath)) {
    throw new Error(`Missing build output: ${distIndexPath}`);
  }

  const html = fs.readFileSync(distIndexPath, 'utf8');
  if (!html.includes(`<title>${EXPECTED.title}</title>`)) {
    throw new Error(`Built index.html is missing expected title "${EXPECTED.title}".`);
  }

  const assetMatch = html.match(/<script type="module" crossorigin src="([^"]+)"/);
  if (!assetMatch) {
    throw new Error('Could not find built JS asset in dist/index.html.');
  }

  const assetPath = assetMatch[1];
  const localAssetPath = path.join(distDir, assetPath.replace(/^\/assets\//, 'assets/').replace(/^\//, '').replace(/\//g, path.sep));
  if (!fs.existsSync(localAssetPath)) {
    throw new Error(`Built asset does not exist: ${localAssetPath}`);
  }

  const bundleContent = fs.readFileSync(localAssetPath, 'utf8');
  for (const marker of EXPECTED.markers) {
    if (!bundleContent.includes(marker)) {
      throw new Error(`Built bundle is missing expected KWG marker "${marker}".`);
    }
  }
  verifyBundleMarkers({
    label: 'built bundle',
    bundleContent,
    requiredMarkers: EXPECTED.bundleRequiredMarkers,
    forbiddenMarkers: EXPECTED.bundleForbiddenMarkers,
  });

  return {
    title: EXPECTED.title,
    assetPath,
  };
}

function deployPreview() {
  const json = run('npx', [
    'firebase',
    'hosting:channel:deploy',
    EXPECTED.previewChannel,
    '--project',
    EXPECTED.projectId,
    '--json',
  ], repoRoot);
  const parsed = JSON.parse(extractJson(json));
  const resultEntry = parsed?.result?.[EXPECTED.site];
  const url = resultEntry?.url;
  if (!url) {
    throw new Error(`Preview deploy did not return a URL.\nOutput:\n${json}`);
  }
  return url;
}

function deployLive() {
  run('npx', [
    'firebase',
    'deploy',
    '--only',
    'hosting',
    '--project',
    EXPECTED.projectId,
    '--json',
  ], repoRoot);
}

async function verifyHostedRelease({ label, baseUrl, expectedAssetPath, expectedTitle, expectedMarkers }) {
  const cacheBustUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
  const response = await fetchUrl(cacheBustUrl);
  const html = response.body;
  const observedAssetPath = extractAssetPath(html);
  const titleTag = `<title>${expectedTitle}</title>`;
  if (!html.includes(titleTag)) {
    throw new Error(`${label} verification failed: hosted HTML title did not match ${expectedTitle}.`);
  }
  if (observedAssetPath !== expectedAssetPath) {
    throw new Error(`${label} verification failed: hosted asset mismatch.\nexpected: ${expectedAssetPath}\nactual: ${observedAssetPath}`);
  }
  if (!response.cacheControl.toLowerCase().includes('no-cache') && !response.cacheControl.toLowerCase().includes('no-store')) {
    throw new Error(`${label} verification failed: hosted HTML is cacheable.\nCache-Control: ${response.cacheControl || '(missing)'}`);
  }

  const hostedBundle = (await fetchUrl(joinUrl(baseUrl, expectedAssetPath))).body;
  for (const marker of expectedMarkers) {
    if (!hostedBundle.includes(marker)) {
      throw new Error(`${label} verification failed: hosted bundle is missing marker "${marker}".`);
    }
  }
  verifyBundleMarkers({
    label: `${label} hosted bundle`,
    bundleContent: hostedBundle,
    requiredMarkers: EXPECTED.bundleRequiredMarkers,
    forbiddenMarkers: EXPECTED.bundleForbiddenMarkers,
  });

  return {
    observedAssetPath,
    cacheControl: response.cacheControl,
  };
}

function verifyBundleMarkers({ label, bundleContent, requiredMarkers, forbiddenMarkers }) {
  for (const marker of requiredMarkers) {
    if (!bundleContent.includes(marker)) {
      throw new Error(`${label} is missing required marker "${marker}".`);
    }
  }

  for (const marker of forbiddenMarkers) {
    if (bundleContent.includes(marker)) {
      throw new Error(`${label} still contains forbidden marker "${marker}".`);
    }
  }
}

async function fetchUrl(url) {
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  const body = await response.text();
  return {
    body,
    cacheControl: response.headers.get('cache-control') ?? '',
  };
}

function joinUrl(baseUrl, relativePath) {
  return `${baseUrl.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`;
}

function extractAssetPath(html) {
  const assetMatch = html.match(/<script type="module" crossorigin src="([^"]+)"/);
  if (!assetMatch) {
    throw new Error('Hosted HTML is missing the module script asset.');
  }
  return assetMatch[1];
}

function printSummary({ mode, repoRoot: root, localTitle, expectedAsset, observedAsset, url, cacheControl }) {
  console.log('\n[release] Summary');
  console.log(`  mode: ${mode}`);
  console.log(`  repo: ${root}`);
  console.log(`  title: ${localTitle}`);
  console.log(`  expected asset: ${expectedAsset}`);
  if (observedAsset) console.log(`  observed asset: ${observedAsset}`);
  if (url) console.log(`  url: ${url}`);
  if (cacheControl) console.log(`  cache-control: ${cacheControl}`);
}

function extractJson(output) {
  const trimmed = output.trim();
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace === -1) {
    throw new Error(`Could not parse JSON output.\n${output}`);
  }
  return trimmed.slice(firstBrace);
}

function run(command, commandArgs, workingDirectory) {
  const fullCommand = [command, ...commandArgs].map(quoteArg).join(' ');
  return execSync(fullCommand, {
    cwd: workingDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
}

function quoteArg(value) {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

process.on('unhandledRejection', fail);
