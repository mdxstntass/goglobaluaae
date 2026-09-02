'use strict';

/**
 * Local dev server: serves the static site and runs the Netlify function
 * in-process, so `npm run dev` reproduces production without the Netlify CLI.
 *   node --env-file=.env test/local-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handler } = require('../netlify/functions/data');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8888);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/data' || url.pathname === '/.netlify/functions/data') {
    const body = await readBody(req);
    const result = await handler({
      httpMethod: req.method,
      headers: req.headers,
      body,
    });
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
    return;
  }

  // Mirror the netlify.toml rewrite for ambassador vanity links.
  let file = url.pathname === '/' ? '/ambassador.html' : url.pathname;
  if (file.startsWith('/ambassador/')) file = '/ambassador.html';

  const abs = path.join(ROOT, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(abs, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`Dev server: http://localhost:${PORT}`);
  console.log(`Ambassador link: http://localhost:${PORT}/ambassador/Sergey`);
});
