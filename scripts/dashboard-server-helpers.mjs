// Raw HTTP helper for the dashboard server tests (fetch cannot set Host).
import http from 'node:http';

export function raw(port, { method = 'GET', target = '/', host, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method, path: target, setHost: false,
      headers: { Host: host ?? `127.0.0.1:${port}`, ...headers }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

export const emptyBoard = { v: 1, generated: 'x', active: null, inflight: 0, columns: [], roadmap: [] };
