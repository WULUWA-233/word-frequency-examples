// ==UserScript==
// @name         爱听写词频与例句面板
// @namespace    li-tianyu.word-frequency
// @version      5.0.0
// @description  将页面已经返回的词频、词形和例句整理为独立面板，支持 fetch / XHR。
// @author       Li Tianyu (AI-assisted)
// @match        https://www.idictation.cn/*
// @grant        none
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';
  const KEY = '__IDICT_FREQ_PANEL__';
  window[KEY]?.dispose();
  const cache = new Map();
  const xhrInfo = new WeakMap();
  const fetchOriginal = window.fetch;
  const openOriginal = XMLHttpRequest.prototype.open;
  const sendOriginal = XMLHttpRequest.prototype.send;
  let disposed = false, observer, host, panel, scheduled = false, renderedSignature = '';

  function isTarget(value) {
    try {
      const url = new URL(String(value), location.href);
      return url.origin === location.origin && url.pathname === '/article/v1/word/search';
    } catch { return false; }
  }
  function count(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  function consume(data) {
    if (disposed) return;
    const values = data?.values, freq = values?.word_fenbu_v4;
    const word = typeof values?.word_real === 'string' ? values.word_real : values?.word;
    if (!freq || typeof word !== 'string' || !word.trim() || word.length > 100) return;
    const normalized = word.trim().toLowerCase();
    let listening = null;
    if (freq.jjColors && typeof freq.jjColors === 'object') {
      const entries = Object.values(freq.jjColors).flatMap(group => group && typeof group === 'object' ? Object.values(group) : [null]);
      if (entries.length && entries.every(value => count(value) !== null)) listening = entries.reduce((a, b) => a + b, 0);
      if (!Number.isSafeInteger(listening)) listening = null;
    }
    const total = count(freq.test_total), hits = count(freq.test_count);
    const probability = total !== null && total > 0 && hits !== null && hits <= total
      ? `${(hits / total * 100).toFixed(2)}%` : null;
    const details = freq.details && typeof freq.details === 'object' ? freq.details : {};
    const items = details[values.word] || details[values.word_real] || [];
    const examples = Array.isArray(items) ? items.slice(0, 100).filter(item => item && typeof item.text === 'string')
      .map(item => ({ text: item.text.slice(0, 10000), source: [item.name, item.part].filter(value => typeof value === 'string').join(' ') })) : [];
    const forms = Object.entries(details).slice(0, 100).filter(([, list]) => Array.isArray(list))
      .map(([name, list]) => ({ name, count: list.length }));
    cache.delete(normalized);
    cache.set(normalized, { reading: count(freq.yuedu_count), listening, answers: count(freq.daanci_count), probability, examples, forms });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    schedule();
  }

  // Return the site's response immediately; parse only an independent clone.
  const fetchWrapped = async function (...args) {
    const response = await fetchOriginal.apply(this, args);
    if (!disposed && response.ok && isTarget(args[0]?.url || args[0])) {
      Promise.resolve().then(() => response.clone().json()).then(consume).catch(() => {});
    }
    return response;
  };
  const openWrapped = function (method, url, ...args) {
    xhrInfo.set(this, isTarget(url));
    return openOriginal.call(this, method, url, ...args);
  };
  const sendWrapped = function (...args) {
    if (xhrInfo.get(this)) this.addEventListener('loadend', () => {
      if (disposed || this.status < 200 || this.status >= 300) return;
      try {
        if (this.responseType === 'json') consume(this.response);
        else if (this.responseType === '' || this.responseType === 'text') consume(JSON.parse(this.responseText));
      } catch { /* Invalid or partial responses leave the original page intact. */ }
    }, { once: true });
    return sendOriginal.apply(this, args);
  };
  if (fetchOriginal) window.fetch = fetchWrapped;
  XMLHttpRequest.prototype.open = openWrapped;
  XMLHttpRequest.prototype.send = sendWrapped;

  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!disposed) render(); });
  }
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent?.appendChild(node);
    return node;
  }
  function render() {
    const dialog = [...document.querySelectorAll('.el-dialog')].find(node => node.textContent.includes('划词后立即翻译'));
    const word = (dialog?.querySelector('.text-theme.font-semibold')?.textContent || '').trim().toLowerCase();
    const data = cache.get(word);
    if (!data || !dialog?.isConnected) {
      if (host) host.hidden = true;
      renderedSignature = '';
      return;
    }
    const signature = JSON.stringify([word, data]);
    if (host && !host.isConnected) { host = null; renderedSignature = ''; }
    if (!host) {
      host = element('aside');
      host.id = 'idict-word-frequency-panel';
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;width:min(390px,calc(100vw - 32px));max-height:65vh;overflow:auto;z-index:2147483000;';
      const root = host.attachShadow({ mode: 'closed' });
      const style = element('style', ':host{font:14px/1.6 system-ui;color:#183047} section{background:#fff;border:1px solid #b4c8db;border-radius:14px;padding:16px;box-shadow:0 10px 32px #0003} h3{margin:0 0 8px} dt{color:#567} dd{margin:0;font-weight:600} dl{display:grid;grid-template-columns:1fr 1fr;gap:8px} p{overflow-wrap:anywhere} small{color:#567} button{float:right;cursor:pointer}', root);
      void style;
      panel = element('section', undefined, root);
      document.body.appendChild(host);
    }
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    host.hidden = false;
    panel.replaceChildren();
    const close = element('button', '关闭', panel);
    close.type = 'button';
    close.addEventListener('click', () => { host.hidden = true; });
    element('h3', `${word} · 词频与例句`, panel);
    const dl = element('dl', undefined, panel);
    for (const [label, value] of [['阅读次数', data.reading], ['听力次数', data.listening], ['答案词次数', data.answers], ['出现概率', data.probability]]) {
      element('dt', label, dl);
      element('dd', value === null ? '暂无数据' : String(value), dl);
    }
    element('small', '统计来自当前页面响应；缺失字段保留为暂无数据。', panel);
    if (data.forms.length) element('p', `词形（响应中的例句条目数）：${data.forms.map(form => `${form.name} ${form.count}`).join(' · ')}`, panel);
    for (const example of data.examples) {
      element('p', example.text, panel);
      element('small', example.source, panel);
    }
    if (!data.examples.length) element('p', '暂无例句', panel);
  }
  function start() {
    if (disposed || observer || !document.body) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  window[KEY] = {
    dispose() {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener('DOMContentLoaded', start);
      host?.remove();
      cache.clear();
      // Restore only our wrappers, so another script's later hooks survive.
      if (window.fetch === fetchWrapped) window.fetch = fetchOriginal;
      if (XMLHttpRequest.prototype.open === openWrapped) XMLHttpRequest.prototype.open = openOriginal;
      if (XMLHttpRequest.prototype.send === sendWrapped) XMLHttpRequest.prototype.send = sendOriginal;
    },
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
