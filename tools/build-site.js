'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(projectRoot, 'dist');

/** Publishes only the browser entry, shared runtime, and original audio; native config and tests stay outside the site. */
function buildSite() {
  if (path.dirname(outputRoot) !== projectRoot || path.basename(outputRoot) !== 'dist') {
    throw new Error('Build output must be the project dist directory');
  }
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputRoot, 'web'), { recursive: true });
  fs.mkdirSync(path.join(outputRoot, 'game'), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'web', 'index.html'), path.join(outputRoot, 'index.html'));
  fs.copyFileSync(path.join(projectRoot, 'web', 'platform-browser.js'), path.join(outputRoot, 'web', 'platform-browser.js'));
  for (const directory of ['src', 'assets']) {
    fs.cpSync(path.join(projectRoot, 'game', directory), path.join(outputRoot, 'game', directory), { recursive: true });
  }
  fs.writeFileSync(path.join(outputRoot, '.nojekyll'), '');
  console.log('Static site built in dist/');
}

buildSite();
