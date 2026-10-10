const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execSync, spawnSync } = require('node:child_process');
const bench = require('./lib/bench');
const { checkForUpdates } = require('./lib/updater');

// Apps launched from Finder don't inherit the shell PATH, so claude/opencode/git wouldn't be found.
try {
  const out = execSync(`${process.env.SHELL || '/bin/zsh'} -ilc 'printf "__PATH__%s" "$PATH"'`, { encoding: 'utf8', timeout: 8000 });
  process.env.PATH = out.split('__PATH__').pop().trim();
} catch {}

let win;
let current = null;

const dataDir = () => app.getPath('userData');
const runsDir = () => path.join(dataDir(), 'runs');
const mcpFile = () => path.join(dataDir(), 'mcp.json');
const prefsFile = () => path.join(dataDir(), 'prefs.json');
const availFile = () => path.join(dataDir(), 'availability.json');
const secretsFile = () => path.join(dataDir(), 'secrets.json');
const localesDir = path.join(__dirname, 'locales');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadI18n() {
  const langs = fs.readdirSync(localesDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  const load = l => readJson(path.join(localesDir, `${l}.json`), {});
  const system = (app.getPreferredSystemLanguages()[0] || app.getLocale()).toLowerCase();
  const auto = langs.find(l => system.startsWith(l)) || 'en';
  const pref = readJson(prefsFile(), {}).lang;
  const lang = langs.includes(pref) ? pref : auto;
  return {
    lang,
    pref: langs.includes(pref) ? pref : 'auto',
    auto,
    names: Object.fromEntries(langs.map(l => [l, load(l)._name || l])),
    strings: { ...load('en'), ...load(lang) },
  };
}

ipcMain.handle('i18n:get', loadI18n);

function mainT(key, vars = {}) {
  return (loadI18n().strings[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? '');
}

const updateCheck = manual => checkForUpdates({ win, t: mainT, manual, isBusy: () => !!current });
ipcMain.handle('update:check', () => updateCheck(true));
ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('i18n:set', (_, lang) => {
  fs.writeFileSync(prefsFile(), JSON.stringify({ ...readJson(prefsFile(), {}), lang: lang === 'auto' ? undefined : lang }, null, 2));
});

ipcMain.handle('models:list', () => bench.listModels(process.env));
ipcMain.handle('ui:accent', () => systemPreferences.getAccentColor());

ipcMain.handle('env:detect', () =>
  ['claude', 'opencode', 'codex'].map(cmd => {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 10000 });
    return { cmd, version: r.status === 0 ? r.stdout.trim().split('\n')[0] : null };
  }));

ipcMain.handle('mcp:get', () => readJson(mcpFile(), {}));

function readSecret(key) {
  const raw = readJson(secretsFile(), {})[key];
  try { return raw ? safeStorage.decryptString(Buffer.from(raw, 'base64')) : null; } catch { return null; }
}

ipcMain.handle('secret:has', (_, key) => !!readSecret(key));
ipcMain.handle('secret:set', (_, key, value) => {
  const raw = readJson(secretsFile(), {});
  if (value) raw[key] = safeStorage.encryptString(value).toString('base64');
  else delete raw[key];
  fs.writeFileSync(secretsFile(), JSON.stringify(raw), { mode: 0o600 });
});

ipcMain.handle('models:availability', () => {
  if (!fs.existsSync(availFile())) {
    for (const f of fs.readdirSync(runsDir()).filter(f => f.endsWith('.json'))) markUnavailable(readJson(path.join(runsDir(), f), { attempts: [] }));
  }
  return readJson(availFile(), {});
});

let probing = false;
ipcMain.handle('models:probe', async (_, models) => {
  if (probing) return;
  probing = true;
  const avail = readJson(availFile(), {});
  let done = 0;
  const queue = [...models];
  // ponytail: 6 probes in parallel, enough for ~100 models in a few minutes
  const worker = async () => {
    for (let m; (m = queue.shift());) {
      const r = await bench.probeModel(m, process.env);
      avail[`opencode|${m}`] = { ...r, checkedAt: Date.now() };
      fs.writeFileSync(availFile(), JSON.stringify(avail, null, 2));
      win?.webContents.send('probe:update', { done: ++done, total: models.length, avail });
    }
  };
  try {
    await Promise.all(Array.from({ length: 6 }, worker));
  } finally {
    probing = false;
  }
  return avail;
});

function markUnavailable(run) {
  const failed = run.attempts.filter(a => a.status === 'done' && a.error && bench.ACCOUNT_ERROR.test(a.error));
  if (!failed.length) return;
  const avail = readJson(availFile(), {});
  for (const a of failed) avail[`${a.harness}|${a.model}`] = { ok: false, reason: bench.errorMessage(a.error), checkedAt: Date.now() };
  fs.writeFileSync(availFile(), JSON.stringify(avail, null, 2));
}

ipcMain.handle('stats:get', () => {
  const by = {};
  for (const f of fs.readdirSync(runsDir()).filter(f => f.endsWith('.json'))) {
    for (const a of readJson(path.join(runsDir(), f), { attempts: [] }).attempts) {
      if (a.status !== 'done' || a.error) continue;
      for (const k of [`${a.harness}|${a.model}`, a.harness]) {
        const s = (by[k] ??= { n: 0, tokens: 0, cost: 0 });
        s.n++;
        s.tokens += (a.tokensIn || 0) + (a.tokensOut || 0);
        s.cost += a.costUsd || 0;
      }
    }
  }
  return by;
});
ipcMain.handle('mcp:set', (_, servers) => fs.writeFileSync(mcpFile(), JSON.stringify(servers, null, 2)));
ipcMain.handle('mcp:probe', async (_, url) => {
  try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
});

ipcMain.handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

function readRun(file) {
  const run = JSON.parse(fs.readFileSync(path.join(runsDir(), file), 'utf8'));
  if (run.status === 'running' && current?.id !== run.id) {
    run.status = 'stopped';
    for (const a of run.attempts) if (a.status === 'running') a.status = 'stopped';
  }
  return run;
}

ipcMain.handle('runs:list', () =>
  fs.readdirSync(runsDir())
    .filter(f => f.endsWith('.json'))
    .map(readRun)
    .map(({ id, name, createdAt, status, targets, repeat }) => ({ id, name, createdAt, status, count: targets.length * repeat }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

ipcMain.handle('runs:get', (_, id) => readRun(`${path.basename(id)}.json`));

ipcMain.handle('runs:delete', (_, id) => {
  fs.rmSync(path.join(runsDir(), `${path.basename(id)}.json`), { force: true });
  fs.rmSync(path.join(runsDir(), path.basename(id)), { recursive: true, force: true });
});

ipcMain.handle('path:open', (_, p) => {
  const target = path.resolve(p);
  if (target.startsWith(runsDir() + path.sep) && fs.existsSync(target)) shell.openPath(target);
});

ipcMain.handle('run:start', (_, cfg) => {
  if (current) throw new Error('RUN_IN_PROGRESS');
  const id = Date.now().toString(36);
  const run = { ...cfg, id, outputsDir: path.join(runsDir(), id), createdAt: new Date().toISOString(), status: 'running', attempts: [], summary: [] };
  const figmaToken = readSecret('figma');
  if (figmaToken) run.mcpSecretEnv = { figma: { FIGMA_API_KEY: figmaToken } };
  const ctx = { id: run.id, stopped: false, child: null };
  current = ctx;
  const save = () => {
    const { mcpServers, mcpFile, mcpSecretEnv, ...persisted } = run;
    fs.writeFileSync(path.join(runsDir(), `${run.id}.json`), JSON.stringify(persisted, null, 2));
    win?.webContents.send('run:update', persisted);
  };
  bench.runBench(run, { env: process.env, onUpdate: save, ctx })
    .catch(e => { run.status = 'error'; run.error = e.message; save(); })
    .finally(() => {
      current = null;
      markUnavailable(run);
      win?.webContents.send('avail:changed');
    });
  return run.id;
});

ipcMain.handle('run:stop', () => {
  if (!current) return;
  current.stopped = true;
  current.child?.kill();
});

app.whenReady().then(() => {
  const icon = path.join(__dirname, 'build/icon.png');
  if (!app.isPackaged && fs.existsSync(icon)) app.dock?.setIcon(icon);
  fs.mkdirSync(runsDir(), { recursive: true });
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'ui/index.html'));
  if (app.isPackaged) win.webContents.once('did-finish-load', () => setTimeout(() => updateCheck(false), 3000));
});

app.on('before-quit', () => current?.child?.kill());
app.on('window-all-closed', () => app.quit());
