'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createStaticServer } = require('../src/appForgeStaticServer');

test('AI App Forge static server serves the prompt experience', async () => {
  const server = createStaticServer();
  await listen(server);

  try {
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseURL}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /一句话应用工厂/);
    assert.match(html, /promptForm/);
    assert.match(html, /progressView/);
    assert.match(html, /previewView/);
  } finally {
    await close(server);
  }
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
