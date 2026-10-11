const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const i18n = { lang: 'en', strings: {} };
const t = (k, v = {}) => (i18n.strings[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');
const tn = (k, n, v = {}) => t(`${k}_${n === 1 ? 'one' : 'other'}`, { n, ...v });

const fmt = {
  ms: ms => ms == null ? '—' : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`,
  tok: n => n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : `${Math.round(n)}`,
  usd: n => n == null ? '—' : n === 0 ? t('run.free') : `${n < 0.01 ? n.toFixed(4) : n.toFixed(3)} $`,
  pct: n => `${Math.round(n * 100)} %`,
  date: s => new Date(s).toLocaleString(i18n.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
};

const HARNESS = { claude: 'Claude Code', opencode: 'OpenCode' };
const FORM_KEY = 'llm-task-bench:form';
const short = m => m.slice(m.indexOf('/') + 1);
const isImage = f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f);
const fileUrl = (dir, f) => encodeURI(`file://${dir}/${f}`).replace(/#/g, '%23');

const PRESETS = {
  figma: { label: 'Figma', server: { command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio', '--no-telemetry'] }, token: 'figma' },
  playwright: { label: 'Playwright', server: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
  'chrome-devtools': { label: 'Chrome DevTools', server: { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] } },
  'shopify-dev': { label: 'Shopify Dev', server: { command: 'npx', args: ['-y', '@shopify/dev-mcp@latest'] } },
  context7: { label: 'Context7', server: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } },
};

const state = {
  groups: [], selected: new Set(), open: new Set(['Claude Code']), filter: '',
  custom: {}, mcpOn: new Set(), probes: {}, env: null,
  runId: null, run: null, folder: null,
  avail: {}, stats: {}, probe: null, tokens: {},
  runView: (() => { try { return localStorage.getItem('llm-task-bench:runview') || 'graph'; } catch { return 'graph'; } })(),
};

function show(view) {
  for (const v of ['new', 'run', 'settings']) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view !== 'run') state.runId = null;
  if (view === 'settings') renderSettings();
  renderRuns();
}

function allMcp() {
  const out = {};
  for (const [k, p] of Object.entries(PRESETS)) out[k] = { ...p, desc: t(`mcp.${k}`), preset: true };
  for (const [k, server] of Object.entries(state.custom)) out[k] = { label: k, desc: server.url || [server.command, ...(server.args || [])].join(' '), server };
  return out;
}

function renderMcp() {
  $('#mcp-list').innerHTML = Object.entries(allMcp()).map(([k, m]) => {
    const url = m.server.url;
    const down = url && state.probes[url] === false;
    if (m.token) {
      const has = state.tokens[m.token];
      return `<div class="field check-row">
        <input type="checkbox" id="mcp-${esc(k)}" data-mcp="${esc(k)}" ${has && state.mcpOn.has(k) ? 'checked' : ''} ${has ? '' : 'disabled'}>
        <span class="grow"><label for="mcp-${esc(k)}"><b>${esc(m.label)}</b></label><small>${esc(m.desc)}</small>
          ${has
            ? `<small class="ok">${t('mcp.tokenSaved')} <button class="link" data-token-remove="${esc(m.token)}">${t('mcp.removeToken')}</button></small>`
            : `<span class="token-row"><input type="password" id="token-${esc(m.token)}" placeholder="${t('mcp.tokenPh')}" autocomplete="off"><button class="btn small" data-token-save="${esc(m.token)}">${t('mcp.saveToken')}</button></span><small>${t('mcp.tokenHelp')}</small>`}
        </span>
      </div>`;
    }
    return `<label class="field check-row">
      <input type="checkbox" data-mcp="${esc(k)}" ${state.mcpOn.has(k) ? 'checked' : ''}>
      <span class="grow"><b>${esc(m.label)}</b><small>${esc(m.desc)}</small>${down ? `<small class="warn">${t('mcp.unreachable')}</small>` : ''}</span>
      ${m.preset ? '' : `<button class="btn small" data-remove-mcp="${esc(k)}">${t('mcp.delete')}</button>`}
    </label>`;
  }).join('');
}

function renderModels() {
  const f = state.filter.toLowerCase();
  const html = state.groups.map((g, gi) => {
    const models = g.models.filter(m => m.toLowerCase().includes(f));
    if (!models.length) return '';
    const n = g.models.filter(m => state.selected.has(`${g.harness}|${m}`)).length;
    const open = f || state.open.has(g.provider);
    return `<div class="provider">
      <div class="provider-head">
        <button class="disclosure ${open ? 'open' : ''}" data-toggle="${esc(g.provider)}" aria-expanded="${!!open}">${esc(g.provider)}</button>
        <span class="count">${n ? t('new.nOfM', { n, m: g.models.length }) : g.models.length}</span>
        <button class="link" data-all="${gi}">${models.every(m => state.selected.has(`${g.harness}|${m}`)) ? t('new.none') : t('new.all')}</button>
      </div>
      ${open ? `<div class="model-list">${models.map(m => {
        const k = `${g.harness}|${m}`;
        const off = state.avail[k]?.ok === false;
        return `<label class="${off ? 'off' : ''}" ${off ? `title="${esc(state.avail[k].reason)}"` : ''}><input type="checkbox" data-key="${esc(k)}" ${state.selected.has(k) ? 'checked' : ''} ${off ? 'disabled' : ''}>${esc(g.harness === 'opencode' ? short(m) : m)}</label>`;
      }).join('')}</div>` : ''}
    </div>`;
  }).join('');
  const hasProbe = Object.entries(state.avail).some(([k, v]) => k.startsWith('opencode|') && v.ok !== false);
  const banner = state.probe
    ? `<p class="banner">${t('avail.probing', { done: state.probe.done, total: state.probe.total })}</p>`
    : !hasProbe && state.groups.some(g => g.harness === 'opencode')
      ? `<p class="banner">${t('avail.prompt')} <button class="link" data-probe>${t('avail.check')}</button></p>`
      : '';
  $('#model-groups').innerHTML = banner + html || `<p class="empty">${state.groups.length ? t('new.noMatch') : t('new.loadingModels')}</p>`;
  renderEstimate();
  $('#sel-count').textContent = state.selected.size ? tn('new.selected', state.selected.size) : '';
}

async function renderRuns() {
  const runs = await api.listRuns();
  $('#runs').innerHTML = runs.map(r => `
    <button class="run-item ${r.id === state.runId ? 'active' : ''}" data-run="${esc(r.id)}">
      <span class="run-name">${r.status === 'running' ? '<span class="status running"></span>' : ''}${esc(r.name || t('runs.untitled'))}</span>
      <small>${fmt.date(r.createdAt)}</small>
    </button>`).join('') || `<p class="side-empty">${t('runs.empty')}</p>`;
}

function availSummary() {
  const entries = Object.entries(state.avail).filter(([k]) => k.startsWith('opencode|'));
  const off = entries.filter(([, v]) => v.ok === false);
  const last = Math.max(0, ...entries.map(([, v]) => v.checkedAt || 0));
  return `<div class="group">
    <div class="field">
      <p class="grow">${state.probe ? t('avail.probing', { done: state.probe.done, total: state.probe.total })
        : entries.length ? t('avail.summary', { ok: entries.length - off.length, off: off.length, date: fmt.date(last) }) : t('avail.never')}</p>
      <button class="btn small" data-probe ${state.probe ? 'disabled' : ''}>${t(entries.length ? 'avail.recheck' : 'avail.check')}</button>
    </div>
    ${off.length ? `<details class="field off-list"><summary>${tn('avail.offList', off.length)}</summary>
      <table><tbody>${off.map(([k, v]) => `<tr><td>${esc(short(splitKey(k).model))}</td><td class="muted">${esc(v.reason)}</td></tr>`).join('')}</tbody></table>
    </details>` : ''}
  </div>
  <p class="hint">${t('avail.hint')}</p>`;
}

function renderSettings() {
  const tools = state.env || [];
  const LABEL = { claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex' };
  const INSTALL = { claude: 'curl -fsSL https://claude.ai/install.sh | bash', opencode: 'curl -fsSL https://opencode.ai/install | bash', codex: 'npm i -g @openai/codex' };
  const providers = state.groups.filter(g => g.harness === 'opencode');
  const langs = [['auto', t('settings.auto', { lang: i18n.names[i18n.auto] })], ...Object.entries(i18n.names)];
  $('#view-settings').innerHTML = `
    <header class="page-head"><h1>${t('settings.title')}</h1></header>
    <h2>${t('theme.title')}</h2>
    <div class="group">
      <div class="field"><span>${t('theme.label')}</span>
        <div class="segmented" role="group">${['light', 'dark', 'system'].map(v => `<button class="${state.theme === v ? 'on' : ''}" data-theme-pick="${v}" aria-pressed="${state.theme === v}">${t(`theme.${v}`)}</button>`).join('')}</div>
      </div>
    </div>
    <h2>${t('settings.language')}</h2>
    <div class="group">
      <label class="field"><span>${t('settings.languageLabel')}</span>
        <select id="s-lang">${langs.map(([v, name]) => `<option value="${esc(v)}" ${v === i18n.pref ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
      </label>
    </div>
    <h2>${t('update.title')}</h2>
    <div class="group">
      <div class="field"><span>${t('update.version')}</span><span class="grow">${esc(state.version)}</span><button class="btn small" id="update-check">${t('update.check')}</button></div>
    </div>
    <div class="section-head"><h2>${t('settings.environment')}</h2><button class="btn small" id="env-refresh">${t('settings.refresh')}</button></div>
    <p class="hint">${t('settings.lead')}</p>
    <h2>${t('settings.tools')}</h2>
    <div class="group">${tools.map(x => `
      <div class="field">
        <span>${LABEL[x.cmd]}</span>
        <span class="grow">${x.version ? esc(x.version) : `<span class="muted">${t('settings.notInstalled')}</span><small><code>${esc(INSTALL[x.cmd])}</code></small>`}
          ${x.cmd === 'codex' && x.version ? `<small class="muted">${t('settings.codexSoon')}</small>` : ''}</span>
        <span class="state ${x.version ? 'ok' : ''}">${x.version ? t('settings.detected') : t('settings.absent')}</span>
      </div>`).join('') || `<p class="empty">${t('settings.detecting')}</p>`}
    </div>
    <h2>${t('avail.title')}</h2>
    ${availSummary()}
    <h2>${t('settings.providers')}</h2>
    <div class="group">${providers.map(g => `
      <div class="field"><span>${esc(g.provider.replace('OpenCode · ', ''))}</span><span class="grow muted">${t('settings.modelCount', { n: g.models.length })}</span></div>`).join('') || `<p class="empty">${t('settings.noProvider')}</p>`}
    </div>
    <p class="hint">${t('settings.providerHint')}</p>`;
}

function failReason(r, s) {
  const a = r.attempts.filter(x => x.model === s.model && x.harness === s.harness && x.status === 'done').pop();
  if (!a) return t('fail.unknown');
  if (a.error) {
    try { const j = JSON.parse(a.error); return j.data?.message || j.message || a.error; } catch {}
    return a.error.split('\n').find(Boolean).slice(0, 200);
  }
  return a.checks?.some(c => !c.pass) ? t('fail.checks') : t('fail.unknown');
}

const EYE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const jump = r => `<button class="icon-btn jump" data-jump="${esc(`${r.harness}|${r.model}`)}" title="${t('run.viewOutput')}" aria-label="${esc(`${t('run.viewOutput')} : ${r.model}`)}">${EYE}</button>`;

function openAttempts(key) {
  const items = [...document.querySelectorAll(`.attempt[data-key="${CSS.escape(key)}"]`)];
  items.forEach(d => { d.open = true; d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); });
  items[0]?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function timeCost(rows) {
  const top = rows.slice(0, 15);
  const maxMs = Math.max(...top.map(r => r.avgMs)) || 1;
  const maxCost = Math.max(...top.map(r => r.avgCost));
  const bar = (v, max, label) => `<span class="bar"><span class="track"><i style="width:${max ? Math.max((v / max) * 100, 1) : 1}%"></i></span><em>${label}</em></span>`;
  return `<figure class="bars">
    <div class="bar-row head"><span></span><span>${t('run.col.time')}</span><span>${t('run.col.cost')}</span><span></span></div>
    ${top.map((r, i) => `<div class="bar-row ${i === 0 ? 'first' : ''}">
      <span class="bar-name">${esc(short(r.model))}</span>
      ${bar(r.avgMs, maxMs, fmt.ms(r.avgMs))}
      ${bar(r.avgCost, maxCost, fmt.usd(r.avgCost))}
      ${jump(r)}
    </div>`).join('')}
    <figcaption>${t('run.timeCostCaption')}${rows.length > top.length ? ` ${t('run.chartMore', { n: rows.length - top.length })}` : ''}</figcaption>
  </figure>`;
}

const gap = (r, leader) => {
  const d = r.avgMs - leader.avgMs;
  return `${d < 0 ? '−' : '+'}${fmt.ms(Math.abs(d))}`;
};

function graph(rows) {
  const leader = rows[0];
  const step = (r, place) => !r ? '<div></div>' : `<div class="place">
      <span class="place-name">${esc(short(r.model))} ${jump(r)}</span>
      <span class="place-meta">${t('run.col.score').toLowerCase()} ${r.score} · ${fmt.ms(r.avgMs)}${place > 1 ? ` (${gap(r, leader)})` : ''}<br>${fmt.tok(r.avgTokens)} ${t('run.tokens')} · ${fmt.usd(r.avgCost)}</span>
      <div class="block p${place}">${place}</div>
    </div>`;
  const rest = rows.slice(3, 15);
  return `<div class="podium">${step(rows[1], 2)}${step(rows[0], 1)}${step(rows[2], 3)}</div>
    ${rest.length ? `<figure class="score-chart">
      <div class="score-row head"><span></span><span></span><span>${t('run.col.score')}</span><span></span><span class="num">${t('run.col.time')}</span><span class="num">${t('run.col.gap')}</span><span class="num">${t('run.col.tokens')}</span><span class="num">${t('run.col.cost')}</span><span></span></div>
      ${rest.map((r, i) => `<div class="score-row" title="${esc(`${r.model} · ${fmt.pct(r.successRate)} · ${fmt.tok(r.avgTokens)} ${t('run.tokens')}`)}">
        <span class="rank num">${i + 4}</span>
        <span class="bar-name">${esc(short(r.model))}</span>
        <span class="track"><i style="width:${Math.max(r.score, 1)}%"></i></span>
        <b class="num">${r.score}</b>
        <span class="num muted">${fmt.ms(r.avgMs)}</span>
        <span class="num muted">${gap(r, leader)}</span>
        <span class="num muted">${fmt.tok(r.avgTokens)}</span>
        <span class="num muted">${fmt.usd(r.avgCost)}</span>
        ${jump(r)}
      </div>`).join('')}
    </figure>` : ''}
    <p class="note">${t('run.graphCaption')}${rows.length > 15 ? ` ${t('run.chartMore', { n: rows.length - 15 })}` : ''}</p>`;
}

function renderRun() {
  const r = state.run;
  if (!r) return;
  const total = r.targets.length * r.repeat;
  const done = r.attempts.filter(a => a.status !== 'running').length;
  const running = r.attempts.find(a => a.status === 'running');
  const meta = [fmt.date(r.createdAt), tn('run.models', r.targets.length), r.repeat > 1 ? t('run.repeats', { n: r.repeat }) : null, r.folder?.split('/').pop()].filter(Boolean).join(', ');

  const ok = r.summary.filter(s => s.successRate > 0);
  const failed = r.summary.filter(s => !s.successRate);
  const rows = ok.map((s, i) => `
    <tr class="${i === 0 && s.score ? 'winner' : ''}">
      <td class="num rank">${i + 1}</td>
      <td><span class="model">${esc(s.model)}</span><small>${HARNESS[s.harness]}${s.badges?.length ? ` — ${s.badges.map(b => t(`note.${b}`)).join(', ')}` : ''}</small></td>
      <td class="num ${s.successRate === 1 ? 'ok' : s.successRate ? 'warn' : 'ko'}">${fmt.pct(s.successRate)}</td>
      <td class="num">${fmt.ms(s.avgMs)}</td>
      <td class="num muted">${i ? gap(s, ok[0]) : '—'}</td>
      <td class="num">${fmt.tok(s.avgTokens)}</td>
      <td class="num">${fmt.usd(s.avgCost)}</td>
      <td class="num">${fmt.usd(s.costPerSuccess)}</td>
      <td class="num">${s.avgFiles.toFixed(s.avgFiles % 1 ? 1 : 0)}</td>
      <td class="num score">${s.score}</td>
      <td class="num">${jump(s)}</td>
    </tr>`).join('');

  const attempts = r.attempts.map(a => {
    const st = a.status === 'running' ? 'running' : a.status === 'stopped' ? 'stopped' : a.success ? 'ok' : 'ko';
    return `<details class="attempt" data-key="${esc(`${a.harness}|${a.model}`)}">
      <summary>
        <span class="model">${esc(a.model)}</span>
        <span class="state ${st}">${t(`attempt.${st}`)}</span>
        <span class="grow"></span>
        ${a.wallMs != null ? `<span class="muted num">${fmt.ms(a.wallMs)}, ${fmt.tok((a.tokensIn || 0) + (a.tokensOut || 0))} ${t('run.tokens')}, ${fmt.usd(a.costUsd)}</span>` : ''}
      </summary>
      <div class="attempt-body">
        ${a.error ? `<pre class="ko">${esc(a.error)}</pre>` : ''}
        ${(a.checks || []).map(c => `<p class="${c.pass ? 'ok' : 'ko'}">${c.pass ? t('check.pass') : t('check.fail')} : ${esc(c.kind ? t(`check.${c.kind}`, { value: c.value }) : c.name)}</p>`).join('')}
        ${a.outputs?.length ? `<div class="outputs">
          ${a.outputs.filter(isImage).map(f => `<img src="${fileUrl(a.outDir, f)}" alt="${esc(f)}">`).join('')}
          <p class="muted">${a.outputs.map(esc).join(', ')}</p>
          <button class="btn small" data-open="${esc(a.outDir)}">${t('run.openFolder')}</button>
        </div>` : ''}
        ${a.text ? `<pre>${esc(a.text)}</pre>` : ''}
      </div>
    </details>`;
  }).join('') + Array.from({ length: Math.max(0, total - r.attempts.length) }, (_, i) => {
    const target = r.targets[Math.floor((r.attempts.length + i) / r.repeat)];
    return `<div class="attempt pending"><span class="model">${esc(target.model)}</span><span class="muted">${t(r.status === 'running' ? 'attempt.pending' : 'attempt.notStarted')}</span></div>`;
  }).join('');
  const hasOutputs = r.attempts.some(a => a.outputs?.length);

  $('#view-run').innerHTML = `
    <header class="page-head">
      <div><h1>${esc(r.name || t('runs.untitled'))}</h1><p class="meta">${esc(meta)}</p></div>
      <div class="actions">
        ${r.status === 'running' ? `<button class="btn" id="r-stop">${t('run.stop')}</button>` : `<button class="btn" id="r-delete">${t('run.delete')}</button><button class="btn" id="r-export">${t('run.exportPdf')}</button><button class="btn" id="r-rerun">${t('run.rerun')}</button>`}
      </div>
    </header>
    <p class="status-line"><span class="state ${esc(r.status)}">${t(`run.status.${r.status}`)}</span>${r.status === 'running' ? ` ${t('run.progress', { done, total })}${running ? `, ${t('run.working', { model: esc(running.model) })}` : ''}` : ''}</p>
    ${r.status === 'running' ? `<div class="progress"><span style="transform:scaleX(${done / total})"></span></div>` : ''}
    ${r.error ? `<pre class="ko">${esc(r.error)}</pre>` : ''}
    <blockquote class="prompt">${esc(r.prompt)}</blockquote>
    ${ok.length ? `<div class="section-head ranking-head"><h2>${t('run.ranking')}</h2>
      <div class="segmented" role="group">${['graph', 'timecost', 'table'].map(v => `<button class="${state.runView === v ? 'on' : ''}" data-runview="${v}" aria-pressed="${state.runView === v}">${t(`run.view.${v}`)}</button>`).join('')}</div></div>` : ''}
    ${ok.length && state.runView === 'graph' ? graph(ok) : ''}
    ${ok.length && state.runView === 'timecost' ? timeCost(ok) : ''}
    ${rows && state.runView === 'table' ? `<table>
      <thead><tr><th class="num">#</th><th>${t('run.col.model')}</th>${['success', 'time', 'gap', 'tokens', 'cost', 'costPerSuccess', 'files', 'score'].map(c => `<th class="num">${t(`run.col.${c}`)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="hint">${t('run.tableHint')}</p>` : ''}
    ${failed.length ? `<details class="failed">
      <summary>${t('run.failed', { n: failed.length })}</summary>
      <p class="hint">${t('run.failedHint')}</p>
      <table><tbody>${failed.map(s => `
        <tr><td><span class="dnf">DNF</span><span class="model">${esc(s.model)}</span><small>${HARNESS[s.harness]}</small></td><td class="reason">${esc(failReason(r, s))}</td></tr>`).join('')}
      </tbody></table>
    </details>` : ''}
    <div class="section-head attempts-head"><h2>${t('run.attempts')}</h2>${hasOutputs ? `<button class="btn small" data-open="${esc(r.outputsDir)}">${t('run.openOutputs')}</button>` : ''}</div>
    <div class="attempts">${attempts || `<p class="empty">${t('run.firstStarting')}</p>`}</div>`;
}

async function openRun(id) {
  state.run = await api.getRun(id);
  show('run');
  state.runId = id;
  renderRun();
  renderRuns();
}

function readForm() {
  return {
    name: $('#f-name').value.trim(),
    prompt: $('#f-prompt').value,
    expect: $('#f-expect').value,
    checkCmd: $('#f-check').value,
    folder: state.folder,
    repeat: Math.max(1, +$('#f-repeat').value || 1),
    timeoutMin: Math.max(1, +$('#f-timeout').value || 15),
    mcpOn: [...state.mcpOn],
    strictMcp: $('#f-strict').checked,
  };
}

function fillForm(f) {
  $('#f-name').value = f.name || '';
  $('#f-prompt').value = f.prompt || '';
  $('#f-expect').value = f.expect || '';
  $('#f-check').value = f.checkCmd || '';
  $('#f-repeat').value = f.repeat || 1;
  $('#f-timeout').value = f.timeoutMin || 15;
  $('#f-strict').checked = !!f.strictMcp;
  state.mcpOn = new Set(f.mcpOn || []);
  setFolder(f.folder || null);
  if (f.targets) state.selected = new Set(f.targets.map(x => `${x.harness}|${x.model}`));
  renderModels();
  renderMcp();
}

function setFolder(p) {
  state.folder = p;
  $('#f-folder-label').textContent = p ? p.replace(/^\/Users\/[^/]+/, '~') : t('new.noFolder');
  $('#f-folder-label').classList.toggle('muted', !p);
  $('#f-folder-clear').hidden = !p;
}

const splitKey = k => ({ harness: k.slice(0, k.indexOf('|')), model: k.slice(k.indexOf('|') + 1) });

function persistForm() {
  try {
    localStorage.setItem(FORM_KEY, JSON.stringify({ ...readForm(), targets: [...state.selected].map(splitKey) }));
  } catch {}
}

function parseMcpInput(cmd) {
  if (/^https?:\/\//.test(cmd)) return { type: 'http', url: cmd };
  const [command, ...args] = cmd.split(/\s+/);
  return { command, args };
}

async function probeMcp() {
  for (const m of Object.values(allMcp())) {
    if (m.server.url) state.probes[m.server.url] = await api.probe(m.server.url);
  }
  renderMcp();
}

function estimate() {
  const repeat = Math.max(1, +$('#f-repeat').value || 1);
  let tokens = 0, cost = 0, unknown = 0, known = 0;
  for (const k of state.selected) {
    const own = state.stats[k];
    const src = own || state.stats[splitKey(k).harness];
    if (src) { tokens += src.tokens / src.n; known++; }
    if (own) cost += own.cost / own.n;
    else unknown++;
  }
  return { n: state.selected.size * repeat, tokens: tokens * repeat, cost: cost * repeat, unknown, known };
}

function renderEstimate() {
  const e = estimate();
  const repeat = Math.max(1, +$('#f-repeat').value || 1);
  const open = $('#f-estimate .estimate-box')?.classList.contains('open');
  $('#f-estimate').innerHTML = !e.n ? '' : `<div class="estimate-box ${open ? 'open' : ''}">
    <span>${t('est.warning')}</span>
    <button class="link" data-estimate aria-expanded="${!!open}">${t('est.view')}</button>
    <div class="estimate-pop" role="tooltip">
      <dl>
        <dt>${t('est.attemptsLabel')}</dt><dd>${t('est.attemptsValue', { n: e.n, models: state.selected.size, repeat })}</dd>
        <dt>${t('est.perAttempt')}</dt><dd>${e.known ? `≈ ${fmt.tok(e.tokens / repeat / e.known)} ${t('run.tokens')}` : '—'}</dd>
        <dt>${t('est.totalTokens')}</dt><dd>${e.known ? `≈ ${fmt.tok(e.tokens)}` : '—'}</dd>
        <dt>${t('est.totalCost')}</dt><dd>${e.known ? (e.cost ? `≈ ${fmt.usd(e.cost)}` : t('run.free')) : '—'}</dd>
      </dl>
      ${e.unknown ? `<p>${tn('est.unknown', e.unknown)}</p>` : ''}
      <p class="muted">${t('est.source')}</p>
    </div>
  </div>`;
}

function dropUnavailable() {
  for (const k of state.selected) if (state.avail[k]?.ok === false) state.selected.delete(k);
}

async function probeModels() {
  const models = state.groups.filter(g => g.harness === 'opencode').flatMap(g => g.models);
  if (!models.length || state.probe) return;
  state.probe = { done: 0, total: models.length };
  renderModels();
  if (!$('#view-settings').hidden) renderSettings();
  state.avail = await api.probeModels(models) || state.avail;
  state.probe = null;
  dropUnavailable();
  renderModels();
  persistForm();
  if (!$('#view-settings').hidden) renderSettings();
}

async function detect() {
  [state.env, state.groups] = await Promise.all([api.detect(), api.listModels()]);
  $('#env-dot').className = `status ${state.env.some(x => x.version && x.cmd !== 'codex') ? 'ok' : 'ko'}`;
  renderModels();
  if (!$('#view-settings').hidden) renderSettings();
}

async function start() {
  const form = readForm();
  const err = msg => { $('#f-error').textContent = msg; $('#f-error').hidden = !msg; };
  if (!form.prompt.trim()) return err(t('new.errPrompt'));
  if (!state.selected.size) return err(t('new.errModels'));
  err('');
  const e = estimate();
  if ((e.n >= 20 || e.cost >= 1) && !confirm(t('est.confirm', { n: e.n, tokens: e.known ? fmt.tok(e.tokens) : '?', cost: fmt.usd(e.cost), unknown: e.unknown }))) return;
  const mcp = allMcp();
  const servers = Object.fromEntries(form.mcpOn.filter(k => mcp[k] && (!mcp[k].token || state.tokens[mcp[k].token])).map(k => [k, mcp[k].server]));
  try {
    const id = await api.startRun({
      ...form,
      mcpJson: Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : '',
      targets: [...state.selected].map(splitKey),
      outputHint: t('prompt.outputHint'),
      timeoutMsg: t('error.timeout', { min: form.timeoutMin }),
    });
    openRun(id);
  } catch (e) {
    const msg = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    err(msg === 'RUN_IN_PROGRESS' ? t('new.errRunning') : msg);
  }
}

const closeEstimate = () => $('#f-estimate .estimate-box')?.classList.remove('open');
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEstimate(); });

document.addEventListener('click', async e => {
  if (!e.target.closest('.estimate-box')) closeEstimate();
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.view) show(btn.dataset.view);
  else if (btn.dataset.run) openRun(btn.dataset.run);
  else if (btn.dataset.open) api.openPath(btn.dataset.open);
  else if (btn.dataset.jump) openAttempts(btn.dataset.jump);
  else if (btn.dataset.themePick || btn.id === 'theme-toggle') {
    const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    state.theme = btn.dataset.themePick || (dark ? 'light' : 'dark');
    await api.setTheme(state.theme);
    if (!$('#view-settings').hidden) renderSettings();
  }
  else if (btn.dataset.runview) {
    state.runView = btn.dataset.runview;
    try { localStorage.setItem('llm-task-bench:runview', state.runView); } catch {}
    renderRun();
  } else if (btn.dataset.probe != null) probeModels();
  else if (btn.dataset.tokenSave) {
    const key = btn.dataset.tokenSave;
    const value = $(`#token-${key}`).value.trim();
    if (!value) return;
    await api.setSecret(key, value);
    state.tokens[key] = true;
    state.mcpOn.add(key);
    renderMcp();
    persistForm();
  } else if (btn.dataset.tokenRemove) {
    await api.setSecret(btn.dataset.tokenRemove, '');
    state.tokens[btn.dataset.tokenRemove] = false;
    state.mcpOn.delete(btn.dataset.tokenRemove);
    renderMcp();
    persistForm();
  }
  else if (btn.dataset.estimate != null) {
    const box = btn.closest('.estimate-box');
    box.classList.toggle('open');
    btn.setAttribute('aria-expanded', box.classList.contains('open'));
  }
  else if (btn.dataset.toggle) {
    const p = btn.dataset.toggle;
    state.open.has(p) ? state.open.delete(p) : state.open.add(p);
    renderModels();
  } else if (btn.dataset.all) {
    const g = state.groups[btn.dataset.all];
    const keys = g.models.filter(m => m.toLowerCase().includes(state.filter.toLowerCase())).map(m => `${g.harness}|${m}`);
    const all = keys.every(k => state.selected.has(k));
    keys.forEach(k => (all ? state.selected.delete(k) : state.selected.add(k)));
    state.open.add(g.provider);
    renderModels();
    persistForm();
  } else if (btn.dataset.removeMcp) {
    e.preventDefault();
    delete state.custom[btn.dataset.removeMcp];
    state.mcpOn.delete(btn.dataset.removeMcp);
    await api.setMcp(state.custom);
    renderMcp();
    persistForm();
  } else if (btn.id === 'm-add') {
    const name = $('#m-name').value.trim().replace(/\s+/g, '-');
    const cmd = $('#m-cmd').value.trim();
    if (!name || !cmd) return;
    state.custom[name] = parseMcpInput(cmd);
    state.mcpOn.add(name);
    await api.setMcp(state.custom);
    $('#m-name').value = $('#m-cmd').value = '';
    renderMcp();
    probeMcp();
    persistForm();
  } else if (btn.id === 'f-folder') {
    const p = await api.pickFolder();
    if (p) { setFolder(p); persistForm(); }
  } else if (btn.id === 'f-folder-clear') { setFolder(null); persistForm(); }
  else if (btn.id === 'f-start') start();
  else if (btn.id === 'r-stop') api.stopRun();
  else if (btn.id === 'r-export') {
    btn.disabled = true;
    await api.exportPdf(`${state.run.name || t('runs.untitled')} - ${t(`run.view.${state.runView}`)}`);
    btn.disabled = false;
  }
  else if (btn.id === 'r-rerun') { fillForm(state.run); show('new'); }
  else if (btn.id === 'r-delete' && confirm(t('run.confirmDelete'))) { await api.deleteRun(state.run.id); show('new'); }
  else if (btn.id === 'update-check') {
    btn.disabled = true;
    await api.checkUpdate();
    btn.disabled = false;
  } else if (btn.id === 'env-refresh') { state.env = null; renderSettings(); detect(); }
});

document.addEventListener('change', async e => {
  if (e.target.id === 's-lang') {
    await api.setLang(e.target.value);
    try { sessionStorage.setItem('llm-task-bench:view', 'settings'); } catch {}
    return location.reload();
  }
  const { key, mcp } = e.target.dataset;
  if (key) {
    e.target.checked ? state.selected.add(key) : state.selected.delete(key);
    renderModels();
  } else if (mcp) {
    e.target.checked ? state.mcpOn.add(mcp) : state.mcpOn.delete(mcp);
  } else return;
  persistForm();
});

$('#f-filter').addEventListener('input', e => { state.filter = e.target.value; renderModels(); });
$('#view-new').addEventListener('input', () => { persistForm(); renderEstimate(); });

api.onRunUpdate(run => {
  if (run.id === state.runId) { state.run = run; renderRun(); }
  if (run.status !== 'running' || run.attempts.length <= 1) renderRuns();
});

function applyStatic() {
  document.documentElement.lang = i18n.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = el.ariaLabel = t(el.dataset.i18nTitle); });
}

(async () => {
  Object.assign(i18n, await api.i18n());
  state.version = await api.version();
  state.theme = await api.getTheme();
  applyStatic();
  state.custom = await api.getMcp();
  state.tokens.figma = await api.hasSecret('figma');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FORM_KEY)) || {}; } catch {}
  fillForm(saved);
  let view = 'new';
  try { view = sessionStorage.getItem('llm-task-bench:view') || 'new'; sessionStorage.removeItem('llm-task-bench:view'); } catch {}
  show(view);
  probeMcp();
  [state.avail, state.stats] = await Promise.all([api.availability(), api.stats()]);
  await detect();
  dropUnavailable();
  renderModels();
})();

api.onProbe(p => {
  state.probe = { done: p.done, total: p.total };
  state.avail = p.avail;
  renderModels();
  if (!$('#view-settings').hidden) renderSettings();
});

api.onUpdateStatus(s => {
  const box = $('#update-status');
  box.hidden = s.phase === 'error';
  box.querySelector('p').textContent = t(s.phase === 'install' ? 'update.installing' : 'update.downloading', { version: s.version, pct: Math.round((s.progress || 0) * 100) });
  box.querySelector('.progress span').style.transform = `scaleX(${s.phase === 'install' ? 1 : s.progress || 0})`;
});

api.onAvailChanged(async () => {
  [state.avail, state.stats] = await Promise.all([api.availability(), api.stats()]);
  dropUnavailable();
  renderModels();
});
