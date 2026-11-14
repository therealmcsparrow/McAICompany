// Pure path helpers shared by scripts and hook rules. No import: safe to load anywhere.

const DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const MAX_PATH_CHARS = 4096;

export function trimAlias(segment) {
  let end = segment.length;
  while (end > 0 && (segment[end - 1] === '.' || segment[end - 1] === ' ')) end--;
  return end === 0 ? segment : segment.slice(0, end);
}

export function isDeviceName(segment) {
  const name = trimAlias(segment);
  const dot = name.indexOf('.');
  return DEVICE_RE.test((dot === -1 ? name : name.slice(0, dot)).replace(/ +$/, '').toLowerCase());
}

function cleanSegment(segment, last) {
  let s = segment;
  if (last) {
    const colon = s.indexOf(':');
    if (colon !== -1) s = s.slice(0, colon);
  }
  s = trimAlias(s);
  if (s === '.' || s === '..') return s;
  return /^[. ]*$/.test(s) ? '' : s;
}

export function normalizePath(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_PATH_CHARS) return '';
  let s = raw.replaceAll('\\', '/');
  let rooted = '';
  const device = /^\/\/[?.]\//.exec(s);
  if (device) {
    s = s.slice(device[0].length);
    if (/^unc\//i.test(s)) s = `//${s.slice(4)}`;
  }
  let rest = s;
  let fixed = 0;
  let parts;
  if (/^\/\/[^/]/.test(s)) {
    const segs = s.slice(2).split('/').filter(Boolean);
    const head = segs.slice(0, 2).map(p => p.toLowerCase());
    rooted = `//${head.join('/')}`;
    fixed = 1;
    parts = segs.slice(2);
  } else if (/^[A-Za-z]:/.test(s)) {
    rooted = `${s[0].toLowerCase()}:`;
    rest = s.slice(2);
    fixed = 2;
    parts = rest.split('/');
  } else {
    parts = s.split('/');
  }
  const absolute = fixed === 1 || (fixed === 2 ? rest.startsWith('/') : s.startsWith('/'));
  const raws = parts.filter(p => p !== '');
  const out = [];
  raws.forEach((p, i) => {
    const seg = cleanSegment(p, i === raws.length - 1).toLowerCase();
    if (seg === '' || seg === '.') return;
    if (seg === '..') {
      if (out.length > 0 && out.at(-1) !== '..') out.pop();
      else if (!absolute) out.push('..');
      return;
    }
    out.push(seg);
  });
  const body = out.join('/');
  if (fixed === 1) return body ? `${rooted}/${body}` : rooted;
  if (fixed === 2) return absolute ? `${rooted}/${body}` : `${rooted}${body}`;
  if (absolute) return `/${body}`;
  return body;
}
