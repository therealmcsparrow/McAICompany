(function (g) {
  'use strict';
  var doc = g.document;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var LAN_TEXT = 'LAN mode is on. Anyone on your network who has this link can read these runs, including names in Handoffs. Stop the server to end access.';
  var DONE_CAP = 10;
  var COLUMNS = [
    ['intake', 'Intake'], ['brief', 'Brief'], ['plan', 'Plan'], ['build', 'Build'],
    ['review', 'Review'], ['ship-gate', 'Ship Gate'], ['needs-ceo', 'Needs CEO'], ['done', 'Done']
  ];
  var LABEL = {};
  COLUMNS.forEach(function (c) { LABEL[c[0]] = c[1]; });
  var LANES = [['roadmap', 'Roadmap'], ['not-now', 'Not now'], ['to-check', 'To check']];

  var ICONS = {
    ok: [['circle', { cx: 8, cy: 8, r: 6.25 }], ['path', { d: 'M5 8.3l2 2 4-4.6' }]],
    warn: [['path', { d: 'M8 1.9L14.6 13.5H1.4z' }], ['path', { d: 'M8 6.2v3.3' }], ['path', { d: 'M8 11.6v.1' }]],
    error: [['circle', { cx: 8, cy: 8, r: 6.25 }], ['path', { d: 'M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8' }]],
    info: [['rect', { x: 1.75, y: 1.75, width: 12.5, height: 12.5, rx: 2.5 }], ['path', { d: 'M8 7.2v4' }], ['path', { d: 'M8 4.8v.1' }]],
    pending: [['circle', { cx: 8, cy: 8, r: 6.25, 'stroke-dasharray': '2.4 2.4' }]],
    unknown: [['circle', { cx: 8, cy: 8, r: 6.25 }], ['path', { d: 'M6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3' }], ['path', { d: 'M8 11.6v.1' }]],
    skipped: [['circle', { cx: 8, cy: 8, r: 6.25 }], ['path', { d: 'M5 8h6' }]]
  };
  // status key -> [visible word, icon key]
  var STATUS = {
    needs: ['Needs you', 'warn'], live: ['Live', 'info'], stale: ['Stale', 'warn'], done: ['Done', 'ok'],
    none: ['Not recorded', 'unknown'], unreadable: ['Unreadable', 'error'],
    info: ['Needs info', 'info'], declined: ['Declined', 'skipped']
  };
  var TIERS = { low: 1, medium: 1, high: 1 };

  var cols = null;
  var cards = {};
  var desired = {};
  var first = true;
  var doneOpen = false;
  var seq = 0;
  var api = { onOpen: null };

  function $(id) { return doc.getElementById(id); }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 300) : ''; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
  function setShown(node, on) { if (node.hidden !== !on) node.hidden = !on; }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function within(root, node) {
    for (var n = node; n; n = n.parentNode) if (n === root) return true;
    return false;
  }
  function lang() { return (doc.documentElement && doc.documentElement.lang) || 'en'; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function clock(iso) {
    var d = new g.Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function hms(s) {
    s = Math.max(0, Math.floor(s));
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  }
  function compact(n) {
    if (n >= 1e6) return (Math.round(n / 1e5) / 10) + 'M';
    if (n >= 1e3) return (Math.round(n / 1e2) / 10) + 'k';
    return String(n);
  }
  function full(n) { return new g.Intl.NumberFormat(lang()).format(n); }

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
  function setChip(holder, statusKey) {
    if (holder.dataset.status === statusKey) return;
    holder.dataset.status = statusKey;
    var s = STATUS[statusKey];
    var wrap = el('span', 'status s-' + s[1]);
    wrap.append(icon(s[1]), el('span', '', s[0]));
    holder.replaceChildren(wrap);
  }

  function buildColumns() {
    var host = $('columns');
    cols = {};
    COLUMNS.forEach(function (c) {
      var sec = el('section', 'col');
      var h = el('h3', '', c[1]);
      h.id = 'col-' + c[0];
      h.tabIndex = -1;
      sec.setAttribute('aria-labelledby', h.id);
      var ul = el('ul');
      var empty = el('li', 'empty', c[0] === 'intake' ? 'Nothing waiting' : 'No runs');
      var more = el('button', 'more');
      more.type = 'button';
      more.hidden = true;
      sec.append(h, ul, more);
      host.append(sec);
      cols[c[0]] = { h: h, ul: ul, empty: empty, more: more };
    });
    cols.done.more.addEventListener('click', function () {
      doneOpen = !doneOpen;
      layout();
      if (g.aicoLive) g.aicoLive.announce(doneOpen ? 'All done runs shown' : 'Newest done runs shown');
    });
  }

  function makeRunCard(slug) {
    var p = { li: el('li', 'card'), btn: el('button', 'title'), slug: el('p', 'slug mono'), chip: el('p'),
      time: el('p', 'num'), tokens: el('p', 'num'), usd: el('p', 'num'), stage: el('p', 'note'), note: el('p', 'note') };
    p.btn.type = 'button';
    p.btn.setAttribute('aria-haspopup', 'dialog');
    p.chip.id = 'chip-' + (++seq);
    p.btn.setAttribute('aria-describedby', p.chip.id);
    p.btn.addEventListener('click', function () { if (api.onOpen) api.onOpen(slug, p.btn); });
    p.li.append(p.btn, p.slug, p.chip, p.time, p.tokens, p.usd, p.stage, p.note);
    return p;
  }

  function makeIntakeCard() {
    var p = { li: el('li', 'card'), btn: el('p', 'title'), chip: el('p'), time: el('p', 'num') };
    p.li.append(p.btn, p.chip, p.time);
    return p;
  }

  function fillTokens(p, t) {
    var node = p.tokens;
    if (!t || num(t.spend) === null) {
      if (node.dataset.sig === 'none') return;
      node.dataset.sig = 'none';
      node.replaceChildren(el('span', '', 'Tokens: not recorded'));
      return;
    }
    var spend = num(t.spend);
    var cache = num(t.cacheRead) === null ? 0 : num(t.cacheRead);
    var sig = spend + '/' + cache;
    if (node.dataset.sig === sig) return;
    node.dataset.sig = sig;
    var vis = el('span', '', 'Tokens ' + compact(spend) + ', cache read ' + compact(cache) + ' ');
    vis.setAttribute('aria-hidden', 'true');
    var lab = el('span', 'muted', '(tokens, not cost)');
    lab.setAttribute('aria-hidden', 'true');
    var sr = el('span', 'sr-only', 'Tokens ' + full(spend) + ', cache read ' + full(cache) + ', tokens, not cost');
    node.replaceChildren(vis, lab, sr);
  }

  function fillRun(p, c) {
    var state = str(c.state, 12);
    setText(p.btn, str(c.title, 200) || str(c.slug, 200));
    setText(p.slug, str(c.slug, 300));
    var unreadable = c.readable === false || state === 'unreadable';
    var key = unreadable ? 'unreadable' : c.needsCeo === true ? 'needs' : state === 'ended' ? 'done' :
      state === 'stale' ? 'stale' : state === 'none' || c.readable === 'not recorded' ? 'none' : 'live';
    setChip(p.chip, key);
    var meta = [];
    if (TIERS[c.tier] === 1) meta.push('risk ' + c.tier);
    if (num(c.round) !== null) meta.push('round ' + num(c.round));
    var elapsed = num(c.elapsedS);
    var time = '';
    if (state === 'ended') time = 'Ended' + (c.ended ? ' ' + clock(str(c.ended, 40)) : '') + (elapsed !== null ? ', took ' + hms(elapsed) : '');
    else if (elapsed !== null && state === 'running') time = 'Running ' + hms(elapsed);
    setText(p.time, meta.concat(time ? [time] : []).join(' · '));
    setShown(p.time, !unreadable && !!p.time.textContent);
    setShown(p.tokens, !unreadable);
    if (!unreadable) fillTokens(p, c.tokens);
    var usd = num(c.usd);
    var usdOn = usd !== null && !unreadable;
    setText(p.usd, usdOn ? new g.Intl.NumberFormat(lang(), { style: 'currency', currency: 'USD' }).format(usd) : '');
    setShown(p.usd, usdOn);
    var sn = unreadable ? '' : str(c.stageNote, 60);
    setText(p.stage, sn);
    setShown(p.stage, !!sn);
    setText(p.note, unreadable ? "This run's files could not be read. Other runs are fine." : '');
    setShown(p.note, unreadable);
  }

  function fillIntake(p, c) {
    setText(p.btn, str(c.topic, 200));
    setChip(p.chip, c.outcome === 'rejected' ? 'declined' : 'info');
    setText(p.time, clock(str(c.at, 40)));
    setShown(p.time, !!p.time.textContent);
  }

  function layout() {
    var lostFocus = null, lostCol = '';
    COLUMNS.forEach(function (c) {
      var col = cols[c[0]];
      var list = desired[c[0]] || [];
      var shown = c[0] === 'done' && !doneOpen ? list.slice(0, DONE_CAP) : list;
      var want = shown.map(function (p) { return p.li; });
      if (!want.length) want = [col.empty];
      want.forEach(function (node, i) {
        if (col.ul.children[i] === node) return;
        var focused = doc.activeElement;
        col.ul.insertBefore(node, col.ul.children[i] || null);
        if (focused && within(node, focused)) focused.focus();
      });
      while (col.ul.children.length > want.length) {
        var gone = col.ul.children[col.ul.children.length - 1];
        if (doc.activeElement && within(gone, doc.activeElement)) { lostFocus = doc.activeElement; lostCol = c[0]; }
        gone.remove();
      }
      setText(col.h, c[1] + ', ' + list.length + (list.length === 1 ? ' run' : ' runs'));
      if (c[0] === 'done') {
        var extra = list.length - DONE_CAP;
        setShown(col.more, extra > 0);
        setText(col.more, doneOpen ? 'Show fewer' : 'Show ' + extra + ' more');
        col.more.setAttribute('aria-expanded', String(doneOpen));
      }
    });
    // a focused card that left the view (Done keeps ten) hands focus to the column's button or heading
    if (lostFocus && doc.activeElement !== lostFocus) {
      var lc = cols[lostCol];
      if (within(doc.getElementById('columns'), lostFocus)) lostFocus.focus();
      else (lostCol === 'done' && lc.more && !lc.more.hidden ? lc.more : lc.h).focus();
    }
  }

  function renderRoadmap(items) {
    var host = $('roadmap');
    var sig = JSON.stringify(items);
    if (host.dataset.sig === sig) return;
    host.dataset.sig = sig;
    var parts = [];
    LANES.forEach(function (lane) {
      var mine = items.filter(function (i) { return i && i.lane === lane[0]; });
      var ul = el('ul');
      if (!mine.length) ul.append(el('li', 'muted', 'No roadmap items'));
      mine.forEach(function (i) {
        ul.append(el('li', '', str(i.topic, 200) + (typeof i.started === 'string' ? ' (' + str(i.started, 40) + ')' : '')));
      });
      parts.push(el('h3', '', lane[1]), ul);
    });
    host.replaceChildren.apply(host, parts);
  }

  function renderSummary(runCount, live, needs) {
    var sum = $('summary');
    var sig = runCount + '/' + live + '/' + needs;
    if (sum.dataset.sig === sig) return;
    sum.dataset.sig = sig;
    var parts = [runCount + (runCount === 1 ? ' run' : ' runs') + ' · ' + live + ' live · '];
    if (needs > 0) {
      var a = el('a', '', needs + ' needs you');
      a.setAttribute('href', '#col-needs-ceo');
      a.addEventListener('click', function () { cols['needs-ceo'].h.focus(); });
      parts.push(a);
    } else {
      parts.push('0 need you');
    }
    sum.replaceChildren.apply(sum, parts);
  }

  function render(board) {
    if (!board || board.v !== 1 || !Array.isArray(board.columns)) return null;
    if (!cols) buildColumns();
    var changes = [];
    var seen = {};
    var runCount = 0;
    var live = 0;
    desired = {};
    board.columns.forEach(function (col) {
      if (!col || typeof col.id !== 'string' || !LABEL.hasOwnProperty(col.id) || !Array.isArray(col.cards)) return;
      var intake = col.id === 'intake';
      var list = desired[col.id] = desired[col.id] || [];
      col.cards.forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        var raw = intake ? str(c.id, 100) : str(c.slug, 300);
        if (!raw) return;
        var id = (intake ? 'i:' : 'r:') + raw;
        if (seen[id]) return;
        seen[id] = true;
        var p = cards[id];
        var isNew = !p;
        if (isNew) p = cards[id] = intake ? makeIntakeCard() : makeRunCard(raw);
        if (intake) {
          fillIntake(p, c);
        } else {
          fillRun(p, c);
          runCount++;
          if (c.live === true) live++;
          if (!first && (isNew || p.column !== col.id)) {
            changes.push({ kind: isNew ? 'new' : 'moved', title: p.btn.textContent, to: LABEL[col.id] });
          }
        }
        p.column = col.id;
        list.push(p);
      });
    });
    Object.keys(cards).forEach(function (id) {
      if (seen[id]) return;
      var p = cards[id];
      var focused = doc.activeElement && within(p.li, doc.activeElement);
      if (id.charAt(0) === 'r') changes.push({ kind: 'removed', title: p.btn.textContent });
      p.li.remove();
      delete cards[id];
      if (focused) cols[p.column].h.focus();
    });
    layout();
    renderSummary(runCount, live, (desired['needs-ceo'] || []).length);
    var needs = (desired['needs-ceo'] || []).length;
    doc.title = (needs > 0 ? '(' + needs + ') ' : '') + 'aico dashboard';

    var lan = $('lan');
    var on = board.lan === true;
    if (on && lan.dataset.on !== '1') {
      lan.dataset.on = '1';
      lan.replaceChildren(icon('warn'), el('span', '', LAN_TEXT));
    }
    setShown(lan, on);
    setShown($('empty'), runCount === 0);
    renderRoadmap(Array.isArray(board.roadmap) ? board.roadmap : []);
    $('board').removeAttribute('aria-busy');
    var out = { changes: first ? [] : changes, generated: str(board.generated, 40) };
    first = false;
    return out;
  }

  function describe(changes) {
    function one(c) {
      if (c.kind === 'moved') return c.title + ' moved to ' + c.to;
      if (c.kind === 'new') return 'New run ' + c.title + ' in ' + c.to;
      return 'Run removed';
    }
    if (!changes.length) return '';
    if (changes.length === 1) return one(changes[0]) + '.';
    return changes.length + ' runs changed: ' + changes.map(one).join('; ') + '.';
  }

  api.render = render;
  api.describe = describe;
  api.clock = clock;
  g.aicoBoard = api;
})(globalThis);
