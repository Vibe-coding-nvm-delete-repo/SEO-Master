import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const EXPECTED = {
  repoName: 'KWG',
  projectId: 'new-final-8edfc',
  databaseId: 'first-db',
  recurrence: 'DAILY',
  retention: '30d',
};

function getScheduleRecurrence(schedule) {
  if (schedule.dailyRecurrence) {
    return 'DAILY';
  }
  if (schedule.weeklyRecurrence) {
    return 'WEEKLY';
  }
  return String(schedule.recurrence ?? 'UNKNOWN').toUpperCase();
}

function formatRetention(retention) {
  if (!retention) {
    return 'unknown';
  }

  if (retention === '2592000s') {
    return '30d';
  }

  if (retention === '86400s') {
    return '1d';
  }

  return retention;
}

function fail(message) {
  console.error(`\n[firestore-backup] ${message}`);
  process.exit(1);
}

function run(command) {
  try {
    return execSync(command, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      shell: true,
    }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? '';
    const stdout = error?.stdout?.toString?.() ?? '';
    fail(`Command failed: ${command}\n${stdout}${stderr}`.trim());
  }
}

function assertRepo() {
  const repoRoot = run('git rev-parse --show-toplevel');
  const repoName = path.basename(repoRoot);
  if (repoName !== EXPECTED.repoName) {
    fail(`Backup management is locked to ${EXPECTED.repoName}. Resolved root: ${repoRoot}`);
  }

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    fail(`Missing .git directory in repo root: ${repoRoot}`);
  }

  const firebaseConfigPath = path.join(repoRoot, 'firebase-applet-config.json');
  if (!fs.existsSync(firebaseConfigPath)) {
    fail(`Missing firebase-applet-config.json in ${repoRoot}`);
  }

  const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
  if (firebaseConfig.projectId !== EXPECTED.projectId) {
    fail(`Expected Firebase project ${EXPECTED.projectId}, found ${firebaseConfig.projectId ?? 'undefined'}`);
  }

  return repoRoot;
}

function loadJsonCommand(command) {
  const output = run(command);
  try {
    return JSON.parse(output);
  } catch {
    fail(`Expected JSON output from command:\n${command}\n\nActual output:\n${output}`);
  }
}

function getDatabase() {
  const response = loadJsonCommand(
    `npx firebase-tools firestore:databases:get ${EXPECTED.databaseId} --project ${EXPECTED.projectId} --json`
  );
  return response.result;
}

function getSchedules() {
  const response = loadJsonCommand(
    `npx firebase-tools firestore:backups:schedules:list --project ${EXPECTED.projectId} --database ${EXPECTED.databaseId} --json`
  );
  return Array.isArray(response.result) ? response.result : [];
}

function printStatus() {
  const database = getDatabase();
  const schedules = getSchedules();

  console.log(`Repo: ${assertRepo()}`);
  console.log(`Project: ${EXPECTED.projectId}`);
  console.log(`Database: ${EXPECTED.databaseId}`);
  console.log(`Location: ${database.locationId ?? database.location ?? 'unknown'}`);
  console.log(`Point in Time Recovery: ${database.pointInTimeRecoveryEnablement ?? database.pointInTimeRecovery ?? 'unknown'}`);
  console.log(`Schedules: ${schedules.length}`);

  schedules.forEach((schedule, index) => {
    console.log(`  [${index + 1}] ${schedule.name}`);
    console.log(`      recurrence: ${getScheduleRecurrence(schedule)}`);
    console.log(`      retention: ${formatRetention(schedule.retention)}`);
  });
}

function ensureSchedule() {
  const repoRoot = assertRepo();
  const schedules = getSchedules();

  if (schedules.length === 0) {
    console.log('[firestore-backup] No schedule found. Creating daily Firestore backup schedule...');
    run(
      `npx firebase-tools firestore:backups:schedules:create --project ${EXPECTED.projectId} --database ${EXPECTED.databaseId} --recurrence ${EXPECTED.recurrence} --retention ${EXPECTED.retention}`
    );
  } else {
    const exactMatch = schedules.find((schedule) => {
      const recurrence = getScheduleRecurrence(schedule);
      const retention = formatRetention(schedule.retention);
      return recurrence === EXPECTED.recurrence && retention === EXPECTED.retention;
    });

    if (exactMatch) {
      console.log(`[firestore-backup] Existing backup schedule already matches ${EXPECTED.recurrence}/${EXPECTED.retention}.`);
    } else {
      const scheduleName = schedules[0].name;
      console.log(`[firestore-backup] Updating existing schedule retention to ${EXPECTED.retention}: ${scheduleName}`);
      run(
        `npx firebase-tools firestore:backups:schedules:update "${scheduleName}" --project ${EXPECTED.projectId} --retention ${EXPECTED.retention}`
      );
    }
  }

  const database = getDatabase();
  const finalSchedules = getSchedules();

  console.log('\n[firestore-backup] Current Firestore backup status');
  console.log(`  repo=${repoRoot}`);
  console.log(`  project=${EXPECTED.projectId}`);
  console.log(`  database=${EXPECTED.databaseId}`);
  console.log(`  location=${database.locationId ?? database.location ?? 'unknown'}`);
  console.log(`  point_in_time_recovery=${database.pointInTimeRecoveryEnablement ?? database.pointInTimeRecovery ?? 'unknown'}`);
  console.log(`  schedules=${finalSchedules.length}`);

  finalSchedules.forEach((schedule) => {
    console.log(`  schedule=${schedule.name}`);
    console.log(`    recurrence=${getScheduleRecurrence(schedule)}`);
    console.log(`    retention=${formatRetention(schedule.retention)}`);
  });
}

const mode = process.argv[2] ?? 'status';

if (mode === 'status') {
  assertRepo();
  printStatus();
} else if (mode === 'ensure') {
  ensureSchedule();
} else {
  fail(`Unknown mode "${mode}". Use "status" or "ensure".`);
}
