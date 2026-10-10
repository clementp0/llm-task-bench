const { spawn, spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLAUDE_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'];

function listModels(env) {
  const groups = [{ harness: 'claude', provider: 'Claude Code', models: CLAUDE_MODELS }];
  const r = spawnSync('opencode', ['models'], { env, encoding: 'utf8', timeout: 60000 });
  const byProvider = new Map();
  for (const line of (r.stdout || '').split('\n').map(s => s.trim())) {
    if (!/^[\w.-]+\/\S+$/.test(line)) continue;
    const p = line.split('/')[0];
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p).push(line);
  }
  for (const [p, models] of byProvider) groups.push({ harness: 'opencode', provider: `OpenCode · ${p}`, models });
  return groups;
}

function parseMcp(json) {
  if (!json?.trim()) return null;
  const j = JSON.parse(json);
  return j.mcpServers ?? j;
}

function toOpencodeMcp(servers) {
  const out = {};
  for (const [name, s] of Object.entries(servers)) {
    out[name] = s.url
      ? { type: 'remote', url: s.url, ...(s.headers && { headers: s.headers }), enabled: true }
      : { type: 'local', command: [s.command, ...(s.args || [])], ...(s.env && { environment: s.env }), enabled: true };
  }
  return out;
}

function parseClaude(out, code, err) {
  let j;
  try { j = JSON.parse(out.trim().split('\n').pop()); } catch { return { text: '', error: (err || out || `exit ${code}`).slice(-2000) }; }
  const u = j.usage || {};
  return {
    text: j.result ?? '',
    error: j.is_error ? String(j.result || j.subtype) : null,
    tokensIn: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    tokensOut: u.output_tokens || 0,
    costUsd: j.total_cost_usd ?? null,
    turns: j.num_turns ?? null,
  };
}

function parseOpencode(out, code, err) {
  const r = { text: '', error: null, tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 0 };
  for (const line of out.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'text') r.text += e.part?.text ?? '';
    else if (e.type === 'step_start') r.turns++;
    else if (e.type === 'step_finish') {
      const t = e.part?.tokens || {};
      r.tokensIn += (t.input || 0) + (t.cache?.read || 0) + (t.cache?.write || 0);
      r.tokensOut += (t.output || 0) + (t.reasoning || 0);
      r.costUsd += e.part?.cost || 0;
    } else if (e.type === 'error') r.error = JSON.stringify(e.error ?? e).slice(0, 2000);
  }
  if (code !== 0 && !r.error) r.error = (err || `exit ${code}`).slice(-2000);
  return r;
}

function exec(cmd, args, opts, ctx) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.child = child;
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => resolve({ code: -1, out, err: e.message }));
    child.on('close', (code, signal) => {
      ctx.child = null;
      if (signal && !ctx.stopped) err = ctx.timeoutMsg || 'Timeout';
      resolve({ code, out, err });
    });
  });
}

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function prepareWorkdir(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-task-bench-'));
  if (src) fs.cpSync(src, dir, { recursive: true, filter: p => !p.includes(`${path.sep}node_modules`) });
  if (!fs.existsSync(path.join(dir, '.git'))) git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=bench', '-c', 'user.email=bench@local', 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'baseline');
  return dir;
}

function changedFiles(dir) {
  git(dir, 'add', '-A');
  return git(dir, 'diff', '--cached', '--name-only', 'HEAD').split('\n').filter(Boolean);
}

function runChecks(run, text, dir) {
  const checks = [];
  if (run.expect?.trim()) {
    checks.push({ kind: 'contains', value: run.expect.trim(), pass: text.toLowerCase().includes(run.expect.trim().toLowerCase()) });
  }
  if (run.checkCmd?.trim()) {
    const r = spawnSync('/bin/sh', ['-c', run.checkCmd], { cwd: dir, timeout: 120000 });
    checks.push({ kind: 'command', value: run.checkCmd.trim(), pass: r.status === 0 });
  }
  return checks;
}

function saveOutputs(dir, files, outDir) {
  const saved = [];
  for (const f of files) {
    const src = path.join(dir, f);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(outDir, f)), { recursive: true });
    fs.copyFileSync(src, path.join(outDir, f));
    saved.push(f);
  }
  return saved;
}

async function runOne(run, t, env, ctx, outDir) {
  const dir = prepareWorkdir(run.folder);
  const prompt = run.outputHint ? `${run.prompt}\n\n${run.outputHint}` : run.prompt;
  ctx.timeoutMsg = run.timeoutMsg;
  const opts = { cwd: dir, env, timeout: (run.timeoutMin || 15) * 60000 };
  const started = Date.now();
  try {
    let r;
    if (t.harness === 'claude') {
      const args = ['-p', prompt, '--model', t.model, '--output-format', 'json', '--dangerously-skip-permissions'];
      if (run.mcpFile) args.push('--mcp-config', run.mcpFile, ...(run.strictMcp ? ['--strict-mcp-config'] : []));
      const x = await exec('claude', args, opts, ctx);
      r = parseClaude(x.out, x.code, x.err);
    } else {
      const ocEnv = run.mcpServers ? { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: toOpencodeMcp(run.mcpServers) }) } : env;
      const x = await exec('opencode', ['run', prompt, '-m', t.model, '--format', 'json', '--auto', '--dir', dir], { ...opts, env: ocEnv }, ctx);
      r = parseOpencode(x.out, x.code, x.err);
    }
    const wallMs = Date.now() - started;
    const checks = runChecks(run, r.text, dir);
    const files = changedFiles(dir);
    const outputs = saveOutputs(dir, files, outDir);
    return { ...r, wallMs, files, outputs, outDir: outputs.length ? outDir : null, checks, success: !r.error && checks.every(c => c.pass), status: 'done' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function summarize(attempts) {
  const groups = new Map();
  for (const a of attempts) {
    if (a.status !== 'done') continue;
    const k = `${a.harness}|${a.model}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const rows = [...groups.values()].map(list => {
    const ok = list.filter(a => a.success).length;
    const sum = f => list.reduce((s, a) => s + (f(a) || 0), 0);
    const cost = sum(a => a.costUsd);
    return {
      harness: list[0].harness,
      model: list[0].model,
      runs: list.length,
      successRate: ok / list.length,
      avgMs: sum(a => a.wallMs) / list.length,
      avgTokens: sum(a => a.tokensIn + a.tokensOut) / list.length,
      avgCost: cost / list.length,
      costPerSuccess: ok ? cost / ok : null,
      avgFiles: sum(a => a.files?.length) / list.length,
    };
  });
  const ok = rows.filter(r => r.successRate > 0);
  const minCost = Math.min(...ok.map(r => r.avgCost));
  const minMs = Math.min(...ok.map(r => r.avgMs));
  // ponytail: score = réussite × moyenne(coût relatif, temps relatif) ; remplacer par des poids réglables si besoin
  for (const r of rows) {
    r.score = r.successRate ? Math.round(100 * r.successRate * (0.5 * (minCost + 0.001) / (r.avgCost + 0.001) + 0.5 * minMs / r.avgMs)) : 0;
  }
  rows.sort((a, b) => b.score - a.score || a.avgCost - b.avgCost);
  const best = key => ok.length ? ok.reduce((a, b) => (b[key] < a[key] ? b : a)) : null;
  for (const [key, badge] of [['avgCost', 'cheapest'], ['avgMs', 'fastest']]) {
    const b = best(key);
    if (b) (b.badges ??= []).push(badge);
  }
  if (rows[0]?.score) (rows[0].badges ??= []).unshift('best');
  return rows;
}

async function runBench(run, { env, onUpdate, ctx }) {
  run.mcpServers = parseMcp(run.mcpJson);
  if (run.mcpServers) {
    run.mcpFile = path.join(os.tmpdir(), `llm-task-bench-mcp-${run.id}.json`);
    for (const [k, env] of Object.entries(run.mcpSecretEnv || {})) {
      if (run.mcpServers[k]) run.mcpServers[k] = { ...run.mcpServers[k], env: { ...run.mcpServers[k].env, ...env } };
    }
    fs.writeFileSync(run.mcpFile, JSON.stringify({ mcpServers: run.mcpServers }), { mode: 0o600 });
  }
  try {
    for (const t of run.targets) {
      for (let i = 0; i < run.repeat; i++) {
        if (ctx.stopped) break;
        const attempt = { harness: t.harness, model: t.model, status: 'running', startedAt: Date.now() };
        run.attempts.push(attempt);
        onUpdate();
        try {
          const outDir = path.join(run.outputsDir, `${run.attempts.length}-${t.model.replace(/[^\w.-]+/g, '_')}`);
          Object.assign(attempt, await runOne(run, t, env, ctx, outDir));
        } catch (e) {
          Object.assign(attempt, { status: 'done', success: false, error: e.message, tokensIn: 0, tokensOut: 0, costUsd: 0, wallMs: Date.now() - attempt.startedAt });
        }
        if (ctx.stopped && !attempt.success) attempt.status = 'stopped';
        run.summary = summarize(run.attempts);
        onUpdate();
      }
    }
    run.status = ctx.stopped ? 'stopped' : 'done';
  } finally {
    if (run.mcpFile) fs.rmSync(run.mcpFile, { force: true });
  }
  onUpdate();
}

const ACCOUNT_ERROR = /"statusCode":\s*(401|402|403|404)|access is disabled|insufficient|not found|not supported|unauthorized|forbidden|quota|no such model|invalid model/i;

function errorMessage(e) {
  try {
    const j = JSON.parse(e);
    return j.data?.message || j.message || e;
  } catch {
    return String(e).split('\n').find(Boolean)?.slice(0, 200) || '';
  }
}

async function probeModel(model, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-task-bench-probe-'));
  try {
    const x = await exec('opencode', ['run', 'Reply with: ok', '-m', model, '--format', 'json', '--dir', dir], { cwd: dir, env, timeout: 90000 }, {});
    const r = parseOpencode(x.out, x.code, x.err);
    if (!r.error) return { ok: true, costUsd: r.costUsd };
    return { ok: ACCOUNT_ERROR.test(r.error) ? false : null, reason: errorMessage(r.error) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { listModels, runBench, summarize, parseClaude, parseOpencode, toOpencodeMcp, parseMcp, probeModel, errorMessage, ACCOUNT_ERROR };
