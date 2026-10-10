const { app, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = 'clementp0/llm-task-bench';

function isNewer(latest, current) {
  const a = latest.replace(/^v/, '').split('.').map(Number);
  const b = current.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

async function download(url, file, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  let done = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', chunk => { done += chunk.length; if (total) onProgress(done / total); });
  await pipeline(body, fs.createWriteStream(file));
}

function swapAndRelaunch(newApp, currentApp) {
  const script = path.join(os.tmpdir(), 'llm-task-bench-update.sh');
  fs.writeFileSync(script, `#!/bin/sh
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
mv "$2" "$2.old" && if mv "$1" "$2"; then rm -rf "$2.old"; else mv "$2.old" "$2"; fi
open "$2"
`);
  spawn('/bin/sh', [script, newApp, currentApp], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

async function install(release, win, t) {
  const version = release.tag_name.replace(/^v/, '');
  const asset = release.assets.find(a => a.name === `llm-task-bench-${version}-${process.arch}.zip`);
  const currentApp = path.resolve(app.getPath('exe'), '../../..');
  if (!app.isPackaged || !asset || !currentApp.endsWith('.app')) return shell.openExternal(release.html_url);
  try {
    fs.accessSync(path.dirname(currentApp), fs.constants.W_OK);
  } catch {
    await dialog.showMessageBox(win, { type: 'warning', message: t('update.noWrite'), detail: path.dirname(currentApp) });
    return shell.openExternal(release.html_url);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-task-bench-update-'));
  const zip = path.join(dir, asset.name);
  try {
    await download(asset.browser_download_url, zip, p => win?.setProgressBar(p));
    win?.setProgressBar(-1);
    await new Promise((resolve, reject) => spawn('ditto', ['-x', '-k', zip, dir]).on('close', c => (c ? reject(new Error(`ditto ${c}`)) : resolve())));
    const newApp = fs.readdirSync(dir).find(f => f.endsWith('.app'));
    if (!newApp) throw new Error('No .app in archive');
    swapAndRelaunch(path.join(dir, newApp), currentApp);
  } catch (e) {
    win?.setProgressBar(-1);
    dialog.showMessageBox(win, { type: 'error', message: t('update.failed'), detail: e.message });
  }
}

async function checkForUpdates({ win, t, manual = false, isBusy = () => false }) {
  let release;
  try {
    release = await latestRelease();
  } catch (e) {
    if (manual) dialog.showMessageBox(win, { type: 'error', message: t('update.checkFailed'), detail: e.message });
    return;
  }
  if (!isNewer(release.tag_name, app.getVersion())) {
    if (manual) dialog.showMessageBox(win, { message: t('update.upToDate', { version: app.getVersion() }) });
    return;
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    message: t('update.available', { version: release.tag_name.replace(/^v/, ''), current: app.getVersion() }),
    detail: (release.body || '').slice(0, 1500),
    buttons: [t('update.install'), t('update.later')],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  if (isBusy()) return dialog.showMessageBox(win, { type: 'warning', message: t('update.busy') });
  await install(release, win, t);
}

module.exports = { checkForUpdates, isNewer };
