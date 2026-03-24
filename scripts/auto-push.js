const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..');
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.log('Set GITHUB_TOKEN env var first');
  process.exit(1);
}

(async () => {
  const status = await git.statusMatrix({ fs, dir });
  const changed = status.filter(([, h, w, s]) => h !== 1 || w !== 1 || s !== 1);
  
  if (changed.length === 0) {
    console.log('No changes to push.');
    return;
  }

  console.log(`${changed.length} changed files. Committing...`);
  
  await git.add({ fs, dir, filepath: '.' });
  
  const date = new Date().toISOString().split('T')[0];
  await git.commit({
    fs, dir,
    message: `chore: daily auto-backup ${date}`,
    author: { name: 'Auto-backup', email: 'noreply@auto.dev' },
  });

  await git.push({
    fs, http, dir, remote: 'origin', ref: 'main',
    onAuth: () => ({ username: 'x-access-token', password: TOKEN }),
  });

  console.log('Pushed successfully!');
})().catch(e => console.error('Error:', e.message));
