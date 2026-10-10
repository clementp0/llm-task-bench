const assert = require('node:assert');
const { parseClaude, parseOpencode, toOpencodeMcp, parseMcp, summarize } = require('./lib/bench');

const c = parseClaude(JSON.stringify({ result: 'ok', is_error: false, total_cost_usd: 0.07, num_turns: 1, usage: { input_tokens: 10, cache_creation_input_tokens: 100, output_tokens: 5 } }), 0, '');
assert.deepStrictEqual(c, { text: 'ok', error: null, tokensIn: 110, tokensOut: 5, costUsd: 0.07, turns: 1 });
assert.ok(parseClaude('not json', 1, 'boom').error.includes('boom'));

const o = parseOpencode([
  '{"type":"step_start","part":{}}',
  '{"type":"text","part":{"text":"o"}}',
  '{"type":"text","part":{"text":"k"}}',
  '{"type":"step_finish","part":{"tokens":{"input":100,"output":3,"reasoning":8,"cache":{"read":50,"write":0}},"cost":0.01}}',
].join('\n'), 0, '');
assert.deepStrictEqual(o, { text: 'ok', error: null, tokensIn: 150, tokensOut: 11, costUsd: 0.01, turns: 1 });
assert.ok(parseOpencode('', 1, 'fail').error);

assert.deepStrictEqual(parseMcp('{"mcpServers":{"a":{"url":"u"}}}'), { a: { url: 'u' } });
assert.strictEqual(parseMcp('  '), null);
assert.deepStrictEqual(toOpencodeMcp({ a: { url: 'u' }, b: { command: 'npx', args: ['x'], env: { K: '1' } } }), {
  a: { type: 'remote', url: 'u', enabled: true },
  b: { type: 'local', command: ['npx', 'x'], environment: { K: '1' }, enabled: true },
});

const att = (model, success, costUsd, wallMs) => ({ status: 'done', harness: 'claude', model, success, costUsd, wallMs, tokensIn: 10, tokensOut: 1, files: [] });
const s = summarize([att('big', true, 1, 10000), att('small', true, 0.1, 5000), att('bad', false, 0.01, 1000)]);
assert.deepStrictEqual(s.map(r => r.model), ['small', 'big', 'bad']);
assert.strictEqual(s[0].score, 100);
assert.deepStrictEqual(s[0].badges, ['best', 'cheapest', 'fastest']);
assert.strictEqual(s[2].score, 0);

const { isNewer } = require('./lib/updater');
assert.ok(isNewer('v0.1.2', '0.1.1'));
assert.ok(isNewer('0.2.0', '0.1.9'));
assert.ok(isNewer('1.0.0', '0.10.0'));
assert.ok(!isNewer('v0.1.1', '0.1.1'));
assert.ok(!isNewer('0.1.0', '0.1.1'));

console.log('ok');
