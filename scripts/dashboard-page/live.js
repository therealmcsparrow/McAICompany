(function (g) {
  'use strict';
  var doc = g.document;
  var POLL_MS = 2000;
  var MAX_FAILS = 3;
  var ANNOUNCE_GAP_MS = 5000;
  var STOPPED = 'Dashboard server stopped. Run /aico:dashboard for a new link.';

  var etag = null;
  var runEtag = null;
  var runSlug = null;
  var runCb = null;
  var fails = 0;
  var paused = false;
  var stopped = false;
  var busy = false;
  var again = false;
  var timer = null;
  var lastData = '';
  var pending = [];
  var lastAnnounce = 0;
  var annTimer = null;

  function $(id) { return doc.getElementById(id); }
  function setStatus(text) { $('status').textContent = text; }
  function setConn(text) { $('conn').textContent = text; }

  function announce(text) {
    if (text) setStatus(text);
    lastAnnounce = g.Date.now();
  }

  function flushChanges() {
    annTimer = null;
    var text = g.aicoBoard.describe(pending);
    pending = [];
    if (text) announce(text);
  }

  function queueChanges(changes) {
    if (!changes.length) return;
    pending = pending.concat(changes);
    if (annTimer !== null) return;
    var wait = lastAnnounce + ANNOUNCE_GAP_MS - g.Date.now();
    if (wait <= 0) flushChanges();
    else annTimer = g.setTimeout(flushChanges, wait);
  }

  async function getJson(url, tag) {
    var headers = {};
    if (tag) headers['If-None-Match'] = tag;
    var res = await g.fetch(url, { headers: headers, cache: 'no-store' });
    if (res.status === 304) return { status: 304 };
    if (res.status !== 200) return { status: res.status };
    return { status: 200, json: await res.json(), etag: res.headers && res.headers.get ? res.headers.get('etag') : null };
  }

  async function pollBoard() {
    try {
      var r = await getJson('api/board', etag);
      if (r.status === 304) return true;
      if (r.status !== 200) return false;
      var out = g.aicoBoard.render(r.json);
      if (!out) return false;
      etag = r.etag;
      var t = g.aicoBoard.clock(out.generated) || g.aicoBoard.clock(new g.Date().toISOString());
      lastData = t;
      setConn('Live, updated ' + t);
      queueChanges(out.changes);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function pollRun() {
    if (!runSlug) return;
    var slug = runSlug;
    var cb = runCb;
    try {
      var r = await getJson('api/run/' + encodeURIComponent(slug), runEtag);
      if (slug !== runSlug) return;
      if (r.status === 304) return;
      if (r.status === 200) { runEtag = r.etag; cb(r.json); } else cb(null);
    } catch (e) {
      if (slug === runSlug) cb(null);
    }
  }

  function schedule() {
    if (timer !== null) g.clearTimeout(timer);
    timer = g.setTimeout(poll, POLL_MS);
  }

  function stop() {
    stopped = true;
    if (timer !== null) { g.clearTimeout(timer); timer = null; }
    setConn(STOPPED);
    setStatus(STOPPED);
    $('pause').disabled = true;
  }

  async function poll() {
    timer = null;
    if (paused || stopped || busy) return;
    busy = true;
    var results = await Promise.all([pollBoard(), pollRun()]);
    busy = false;
    if (results[0]) {
      if (fails > 0) announce('Connection restored');
      fails = 0;
    } else {
      fails++;
      if (fails >= MAX_FAILS) { stop(); return; }
      if (fails === 1) announce('Connection lost. Retrying.');
      setConn('Connection lost. ' + (lastData ? 'Showing data from ' + lastData + '. ' : '') + 'Retrying.');
    }
    if (paused || stopped) return;
    if (again) { again = false; poll(); return; }
    schedule();
  }

  function setPaused(on) {
    if (stopped || paused === on) return;
    paused = on;
    var btn = $('pause');
    btn.setAttribute('aria-pressed', String(on));
    $('paused').hidden = !on;
    if (on) {
      if (timer !== null) { g.clearTimeout(timer); timer = null; }
      setStatus('Updates paused');
    } else {
      setStatus('Updates resumed');
      if (busy) again = true; else poll();
    }
  }

  function watchRun(slug, cb) {
    runSlug = slug;
    runCb = cb;
    runEtag = null;
    if (slug && !paused && !stopped && !busy) { if (timer !== null) g.clearTimeout(timer); poll(); }
  }

  function start() {
    $('pause').addEventListener('click', function () { setPaused(!paused); });
    poll();
  }

  g.aicoLive = { announce: announce, watchRun: watchRun, start: start };
  if (!g.AICO_MANUAL_START) start();
})(globalThis);
