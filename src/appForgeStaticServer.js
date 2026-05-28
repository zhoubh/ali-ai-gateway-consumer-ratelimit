'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function createStaticServer(options = {}) {
  const publicDir = options.publicDir || path.join(__dirname, '..', 'public');

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.normalize(path.join(publicDir, requestedPath));

    if (!filePath.startsWith(path.normalize(publicDir))) {
      return writeText(res, 403, 'forbidden');
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        return writeText(res, 404, 'not found');
      }

      const type = contentTypes[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(content);
    });
  });
}

function writeText(res, statusCode, message) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(message);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 5173);
  createStaticServer().listen(port, '127.0.0.1', () => {
    console.log(`AI App Forge listening on http://127.0.0.1:${port}`);
  });
}

module.exports = {
  createStaticServer
};
