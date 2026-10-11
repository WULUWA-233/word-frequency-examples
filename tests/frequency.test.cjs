const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const code = fs.readFileSync(path.join(__dirname, '../word-frequency-examples.user.js'), 'utf8');
const fixture = () => ({ values: { word: 'hello', word_real: 'hello', word_fenbu_v4: {
  yuedu_count: 11, daanci_count: 33, jjColors: { group: { a: 22 } }, test_count: 3, test_total: 4,
  details: { hello: [{ text: '<script>literal example</script>', name: 'demo', part: '1' }] },
} } });

function setup() {
  const dom = new JSDOM('<div class="el-dialog"><h3 class="text-theme font-semibold">hello</h3><p>划词后立即翻译</p><p>阅读 ** 听力 ** 答案词 ** 概率 **%</p></div><div class="vip-pay-class">original popup</div>', { runScripts: 'outside-only', url: 'https://www.idictation.cn/demo' });
  const w = dom.window, roots = [];
  w.XMLHttpRequest = class extends w.EventTarget {
    open() {}
    send() { this.dispatchEvent(new w.Event('loadend')); }
  };
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (options) { const root = attach.call(this, options); roots.push(root); return root; };
  w.fetch = async () => ({ ok: true, clone: () => ({ json: async () => fixture() }) });
  w.eval(code);
  return { dom, w, roots };
}

test('statistics preserve semantic field mapping, examples are literal text and original UI survives', async () => {
  const { dom, w, roots } = setup();
  await w.fetch('/article/v1/word/search'); await tick();
  const values = [...roots[0].querySelectorAll('dd')].map(node => node.textContent);
  assert.deepEqual(values, ['11', '22', '33', '75.00%']);
  assert.ok(roots[0].textContent.includes('<script>literal example</script>'));
  assert.equal(roots[0].querySelector('script'), null);
  assert.ok(w.document.querySelector('.vip-pay-class'));
  assert.ok(w.document.querySelector('.el-dialog').textContent.includes('阅读 **'));
  dom.window.close();
});

test('malformed counts are shown as missing, not invented as zero', async () => {
  const { dom, w, roots } = setup();
  w.__IDICT_FREQ_PANEL__.dispose();
  const data = fixture();
  data.values.word_fenbu_v4.yuedu_count = 'bad';
  delete data.values.word_fenbu_v4.jjColors;
  data.values.word_fenbu_v4.test_count = 8;
  w.fetch = async () => ({ ok: true, clone: () => ({ json: async () => data }) });
  w.eval(code);
  await w.fetch('/article/v1/word/search'); await tick();
  const values = [...roots.at(-1).querySelectorAll('dd')].map(node => node.textContent);
  assert.deepEqual(values, ['暂无数据', '暂无数据', '33', '暂无数据']);
  dom.window.close();
});

test('reinjection restores network hooks rather than stacking them; dispose restores originals', async () => {
  const { dom, w } = setup();
  const first = w.fetch;
  w.eval(code);
  assert.notEqual(w.fetch, first);
  await w.fetch('/article/v1/word/search'); await tick();
  assert.equal(w.document.querySelectorAll('#idict-word-frequency-panel').length, 1);
  w.__IDICT_FREQ_PANEL__.dispose();
  assert.equal(w.document.querySelector('#idict-word-frequency-panel'), null);
  dom.window.close();
});

test('foreign and lookalike endpoints are ignored', async () => {
  const { dom, w, roots } = setup();
  await w.fetch('https://evil.test/article/v1/word/search');
  await w.fetch('/article/v1/word/search-extra');
  await tick();
  assert.equal(roots.length, 0);
  dom.window.close();
});

test('fetch callers are not blocked by asynchronous cloned-body parsing', async () => {
  const { dom, w } = setup();
  w.__IDICT_FREQ_PANEL__.dispose();
  w.fetch = async () => ({ ok: true, clone: () => ({ json: () => new Promise(() => {}) }) });
  w.eval(code);
  const response = await w.fetch('/article/v1/word/search');
  assert.equal(response.ok, true);
  dom.window.close();
});

test('XHR JSON responses work and disposal restores original open/send functions', async () => {
  const { dom, w, roots } = setup();
  w.__IDICT_FREQ_PANEL__.dispose();
  const open = w.XMLHttpRequest.prototype.open, send = w.XMLHttpRequest.prototype.send;
  w.eval(code);
  const request = new w.XMLHttpRequest();
  request.open('GET', '/article/v1/word/search');
  request.status = 200;
  request.responseType = 'json';
  request.response = fixture();
  request.send();
  await tick();
  assert.equal(roots.at(-1).querySelector('dd').textContent, '11');
  w.__IDICT_FREQ_PANEL__.dispose();
  assert.equal(w.XMLHttpRequest.prototype.open, open);
  assert.equal(w.XMLHttpRequest.prototype.send, send);
  dom.window.close();
});
