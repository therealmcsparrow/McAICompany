(function (g) {
  'use strict';
  var doc = g.document;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/(pull|issues)\/\d+$/;
  var GATE_WORDS = { pass: ['Gate pass', 'ok'], fail: ['Gate fail', 'error'] };
  var REVIEW_WORDS = { approve: ['Review approve', 'ok'], changes: ['Review changes', 'error'], blocked: ['Review blocked', 'error'] };
  var STEP_ICON = { done: 'ok', blocked: 'error', 'needs-ceo': 'warn', handover: 'pending', running: 'pending' };
  var ICONS = {
    ok: [['circle', { cx: 8, cy: 8, r: 6.25 }], ['path', { d: 'M5 8.3l2 2 4-4.6' }]],
    warn: [['path', { d: 'M8 1.9L14.6 13.5H1.4z' }], ['path', { d: 'M8 6.2v3.3' }], ['path', { d: 'M8 11.6v.1' }]],
    error: [['circle', { cx: 8, cy: 8, r: 6.25 }], ['path', { d: 'M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8' }]],
    pending: [['circle', { cx: 8, cy: 8, r: 6.25, 'stroke-dasharray': '2.4 2.4' }]],
    unknown: [['circle', { cx: 8, cy: 8, r: 6.25 }], ['path', { d: 'M6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3' }], ['path', { d: 'M8 11.6v.1' }]]
  };

  var root = null;
  var parts = null;
  var openSlug = null;
  var opener = null;
  var stepNodes = {};
  var rendered = false;
  var seq = 0;

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 300) : ''; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function within(top, node) {
    for (var n = node; n; n = n.parentNode) if (n === top) return true;
    return false;
  }
  function icon(key) {
    var svg = doc.createElementNS(SVG_NS, 'svg');
    var attrs = { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
    Object.keys(attrs).forEach(function (k) { svg.setAttribute(k, attrs[k]); });
    (ICONS[key] || ICONS.unknown).forEach(function (part) {
      var n = doc.createElementNS(SVG_NS, part[0]);
      Object.keys(part[1]).forEach(function (k) { n.setAttribute(k, part[1][k]); });
      svg.append(n);
    });
    return svg;
  }
  function chip(word, key, extra) {
    var wrap = el('span', 'status s-' + key + (extra ? ' ' + extra : ''));
    wrap.append(icon(key), el('span', '', word));
    return wrap;
  }
  function hms(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60);
    return m ? m + 'm ' + (s % 60) + 's' : s + 's';
  }
  function clock(iso) {
    var d = new g.Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function section(title) {
    var s = el('section', 'drawer-sec');
    var h = el('h3', '', title);
    s.append(h);
    return s;
  }

  function build() {
    root = el('div', 'drawer');
    root.id = 'drawer';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'drawer-title');
    root.hidden = true;
    var head = el('div', 'drawer-head');
    var closeTop = el('button', 'close', 'Close');
    closeTop.type = 'button';
    var title = el('h2', '');
    title.id = 'drawer-title';
    title.tabIndex = -1;
    var slug = el('p', 'slug mono');
    var hint = el('p', 'muted', 'Press Escape to close.');
    head.append(closeTop, title, slug, hint);

    var error = el('p', 'drawer-error');
    error.hidden = true;
    error.append(icon('error'), el('span', '', 'Could not read this run. Close and try again.'));

    var prs = el('section', 'drawer-sec');
    prs.hidden = true;
    var prList = el('ul', 'links');
    var prNote = el('p', 'muted');
    prs.append(el('h3', '', 'Pull requests'), prNote, prList);

    var rounds = section('Rounds');
    var roundsList = el('ul', 'plain');
    rounds.append(roundsList);
    var routing = section('Reviewer routing');
    var routingText = el('p', '');
    routing.append(routingText);
    var steps = section('Steps');
    var stepList = el('ol', 'steps');
    steps.append(stepList);
    var live = el('div', 'drawer-live');
    live.hidden = true;

    var closeBottom = el('button', 'close', 'Close');
    closeBottom.type = 'button';
    var body = el('div', 'drawer-body');
    body.append(prs, rounds, routing, steps, live);
    root.append(head, error, body, closeBottom);
    parts = { closeTop: closeTop, closeBottom: closeBottom, title: title, slug: slug, error: error, body: body,
      prs: prs, prList: prList, prNote: prNote, roundsList: roundsList, routingText: routingText,
      stepList: stepList, live: live, rounds: rounds, routing: routing };
    root.addEventListener('keydown', onKey);
    closeTop.addEventListener('click', close);
    closeBottom.addEventListener('click', close);
    doc.body.append(root);
  }

  function focusables() {
    var list = [parts.closeTop];
    parts.prList.children.forEach(function (li) {
      li.children.forEach(function (a) { if (a.tagName === 'a') list.push(a); });
    });
    list.push(parts.closeBottom);
    return list;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (e.preventDefault) e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    var list = focusables();
    var i = list.indexOf(doc.activeElement);
    var next = null;
    if (e.shiftKey) { if (i <= 0) next = list[list.length - 1]; } else if (i === list.length - 1) next = list[0];
    if (next) {
      if (e.preventDefault) e.preventDefault();
      next.focus();
    }
  }

  function setBackground(on) {
    doc.body.children.forEach(function (n) {
      if (n === root) return;
      var t = n.tagName;
      if (t === 'header' || t === 'main' || (t === 'a' && /\bskip\b/.test(n.className || ''))) {
        if (on) n.setAttribute('inert', ''); else n.removeAttribute('inert');
      }
    });
  }

  function open(slug, button) {
    if (!root) build();
    openSlug = slug;
    opener = button || null;
    stepNodes = {};
    rendered = false;
    seq++;
    var title = opener ? str(opener.textContent, 200) : '';
    parts.title.textContent = 'Run: ' + (title || slug);
    parts.slug.textContent = slug;
    parts.stepList.replaceChildren();
    parts.roundsList.replaceChildren();
    parts.routingText.textContent = '';
    parts.live.replaceChildren();
    parts.live.hidden = true;
    parts.error.hidden = true;
    parts.body.hidden = true;
    root.hidden = false;
    setBackground(true);
    loadLinks(slug, seq);
    if (g.aicoLive) g.aicoLive.watchRun(slug, onRun);
    parts.title.focus();
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    setBackground(false);
    if (g.aicoLive) g.aicoLive.watchRun(null, null);
    openSlug = null;
    seq++;
    var back = opener;
    opener = null;
    if (back && within(doc.body, back)) back.focus();
    else if (doc.getElementById('board')) doc.getElementById('board').focus();
  }

  // Validator entry point (websec.M1). Mirrors its consumer: the browser URL parser and the <a href> it feeds.
  // Threats covered: javascript:/data: schemes, non-https, look-alike or userinfo hosts (only github.com),
  // path tricks and control characters (strict PR_URL shape first, then URL re-parse; returns the normalised href).
  function validUrl(u) {
    if (typeof u !== 'string' || !PR_URL.test(u)) return null;
    try {
      var p = new g.URL(u);
      if (p.protocol !== 'https:' || p.hostname !== 'github.com') return null;
      return p.href;
    } catch (e) { return null; }
  }

  async function loadLinks(slug, mine) {
    parts.prs.hidden = false;
    parts.prs.setAttribute('aria-busy', 'true');
    parts.prNote.textContent = 'Pull requests: loading';
    parts.prList.replaceChildren();
    var data = null;
    try {
      var res = await g.fetch('api/run/' + encodeURIComponent(slug) + '/links', { cache: 'no-store' });
      if (res.status === 200) data = await res.json();
    } catch (e) { data = null; }
    if (mine !== seq) return;
    parts.prs.removeAttribute('aria-busy');
    parts.prNote.textContent = '';
    if (!data || data.state === 'unavailable' || (data.state !== 'found' && data.state !== 'none')) {
      parts.prs.hidden = true;
      return;
    }
    var items = [];
    (Array.isArray(data.prs) ? data.prs : []).forEach(function (p) {
      var href = validUrl(p && p.url);
      var n = p && num(p.number);
      if (!href || n === null) return;
      var st = p.state === 'open' || p.state === 'closed' || p.state === 'merged' ? p.state : null;
      items.push(['PR #' + n + (st ? ' (' + st + ')' : ''), href]);
    });
    (Array.isArray(data.issues) ? data.issues : []).forEach(function (p) {
      var href = validUrl(p && p.url);
      var n = p && num(p.number);
      if (href && n !== null) items.push(['Issue #' + n, href]);
    });
    if (!items.length) { parts.prNote.textContent = 'No pull request found for this run.'; return; }
    items.forEach(function (it) {
      var li = el('li', '');
      var a = el('a', '', it[0]);
      a.setAttribute('href', it[1]);
      a.setAttribute('rel', 'noopener noreferrer');
      li.append(a);
      parts.prList.append(li);
    });
  }

  function setText(n, t) { if (n.textContent !== t) n.textContent = t; }

  function renderStep(s) {
    var key = str(s.step, 8);
    var status = str(s.status, 20);
    var ik = STEP_ICON[status] || 'unknown';
    var p = stepNodes[key];
    if (!p) {
      p = { li: el('li', 'step'), line: el('p', 'step-line'), did: el('p', 'did') };
      p.li.append(p.line, p.did);
      stepNodes[key] = p;
      parts.stepList.append(p.li);
      p.isNew = true;
    }
    var round = num(s.round);
    var sig = status + '|' + str(s.role, 60) + '|' + round;
    if (p.sig !== sig) {
      p.sig = sig;
      p.line.replaceChildren(el('span', 'mono', key + ' ' + str(s.role, 60)), chip(status || 'unknown', ik),
        el('span', 'muted', 'round ' + (round === null ? '?' : round)));
    }
    var summary = typeof s.summary === 'string' ? s.summary.slice(0, 300) : null;
    setText(p.did, summary === null ? 'Summary not recorded.' : summary);
    p.did.className = summary === null ? 'did muted' : 'did';
    return p;
  }

  function verdictChip(map, value, label) {
    var m = typeof value === 'string' && Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null;
    if (m) return chip(m[0], m[1]);
    return chip(label + ': verdict not recorded', 'unknown', 'not-recorded');
  }

  function renderRounds(rounds) {
    var sig = JSON.stringify(rounds);
    if (parts.roundsList.dataset.sig === sig) return;
    parts.roundsList.dataset.sig = sig;
    parts.roundsList.replaceChildren();
    rounds.forEach(function (r) {
      var li = el('li', 'round');
      var n = num(r && r.round);
      li.append(el('span', '', 'Round ' + (n === null ? '?' : n)), verdictChip(GATE_WORDS, r && r.gate, 'Gate'),
        verdictChip(REVIEW_WORDS, r && r.review, 'Review'));
      parts.roundsList.append(li);
    });
  }

  function table(caption, heads, rows) {
    var t = el('table', '');
    t.append(el('caption', '', caption));
    var tr = el('tr', '');
    heads.forEach(function (h) { var th = el('th', '', h); th.setAttribute('scope', 'col'); tr.append(th); });
    var thead = el('thead', ''); thead.append(tr);
    var tbody = el('tbody', '');
    rows.forEach(function (r) {
      var row = el('tr', '');
      r.forEach(function (c) { row.append(el('td', '', c)); });
      tbody.append(row);
    });
    t.append(thead, tbody);
    return t;
  }

  function renderActive(a) {
    var live = parts.live;
    if (!a || typeof a !== 'object') { live.hidden = true; live.dataset.sig = ''; live.replaceChildren(); return; }
    var sig = JSON.stringify(a);
    live.hidden = false;
    if (live.dataset.sig === sig) return;
    live.dataset.sig = sig;
    var gates = section('Gates');
    var gl = el('ul', 'plain');
    (Array.isArray(a.gates) ? a.gates : []).forEach(function (x) {
      var w = num(x && x.waitS);
      gl.append(el('li', '', str(x && x.gate, 40) + ': ' + str(x && x.result, 40) + (w === null ? '' : ', CEO wait ' + hms(w))));
    });
    gates.append(gl);
    var waves = section('Waves');
    var wl = el('ul', 'plain');
    (Array.isArray(a.waves) ? a.waves : []).forEach(function (x) {
      wl.append(el('li', '', 'Wave ' + str(String(x && x.wave), 20) + ' at ' + clock(x && x.at)));
    });
    waves.append(wl);
    var times = section('Role times');
    times.append(table('Time per Role', ['Role', 'Time', 'Steps'], (Array.isArray(a.roleTimes) ? a.roleTimes : []).map(function (x) {
      var ms = num(x && x.ms);
      return [str(x && x.role, 60), ms === null ? '-' : hms(ms / 1000), String(num(x && x.steps) === null ? '' : x.steps)];
    })));
    var cap = section('Over cap');
    var cl = el('ul', 'plain');
    var over = Array.isArray(a.overCap) ? a.overCap : [];
    over.forEach(function (x) {
      var li = el('li', 'status-row');
      var c = num(x && x.ctxEnd);
      li.append(chip('over cap', 'warn'), el('span', '', 'Step ' + str(String(x && x.step), 8) + ' ' + str(x && x.role, 60) +
        ' ctx ' + (c === null ? '?' : Math.round(c / 1000) + 'k')));
      cl.append(li);
    });
    if (!over.length) cl.append(el('li', 'muted', 'No Step over the cap'));
    cap.append(cl);
    var fix = section('Fix rounds');
    fix.append(el('p', '', String(num(a.fixRounds) === null ? 0 : a.fixRounds)));
    live.replaceChildren(gates, waves, times, cap, fix);
  }

  function onRun(run) {
    if (!openSlug || !root || root.hidden) return;
    if (!run || typeof run !== 'object' || !Array.isArray(run.steps)) {
      parts.error.hidden = false;
      if (!rendered) parts.body.hidden = true;
      return;
    }
    parts.error.hidden = true;
    parts.body.hidden = false;
    var wasRendered = rendered;
    var added = [];
    run.steps.forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var p = renderStep(s);
      if (p.isNew) { p.isNew = false; added.push(str(s.step, 8)); }
    });
    renderRounds(Array.isArray(run.rounds) ? run.rounds : []);
    setText(parts.routingText, Array.isArray(run.routing) && run.routing.length ? run.routing.map(function (r) { return str(r, 60); }).join(', ') : 'None yet');
    renderActive(run.active);
    rendered = true;
    if (wasRendered && added.length && g.aicoLive) g.aicoLive.announce('Step ' + added.join(', ') + ' added');
  }

  var api = { open: open, close: close };
  g.aicoDrawer = api;
  if (g.aicoBoard) g.aicoBoard.onOpen = open;
})(globalThis);
