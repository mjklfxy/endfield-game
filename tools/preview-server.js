'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist');
const projectPrefix = '/endfield-game';
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wav': 'audio/wav',
  '.png': 'image/png',
};

/** Serves the built site at both / and its Pages prefix to catch repository-relative asset errors locally. */
function serve(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400).end('Invalid path');
    return;
  }
  if (pathname === projectPrefix) {
    response.writeHead(308, { Location: `${projectPrefix}/` }).end();
    return;
  }
  if (pathname.startsWith(`${projectPrefix}/`)) pathname = pathname.slice(projectPrefix.length);
  if (pathname === '/') pathname = '/index.html';
  const filename = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, filename);
  const contentType = mimeTypes[path.extname(filename)];
  if (relative.startsWith('..') || path.isAbsolute(relative) || !contentType) {
    response.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(filename, (error, contents) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('File unavailable');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(contents);
  });
}

const port = Number(process.env.CIRCUIT_PREVIEW_PORT || 4174);
const server = http.createServer(serve);
server.on('error', (error) => {
  console.error(`Preview server failed: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Preview: http://127.0.0.1:${port}${projectPrefix}/`);
});
