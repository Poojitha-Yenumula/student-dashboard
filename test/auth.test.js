'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createStudySyncServer } = require('../server');

const SECRET = 'a-test-session-secret-with-more-than-thirty-two-characters';

async function startServer(t, options = {}) {
  const server = createStudySyncServer({
    env: { SESSION_SECRET: SECRET, NODE_ENV: 'development' },
    ...options
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(origin, path, body) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('email OTP creates a session only after verification and logout clears it', async t => {
  let deliveredCode = '';
  const origin = await startServer(t, {
    randomCode: () => '004281',
    sendOtpEmail: async (email, code) => {
      assert.equal(email, 'student@example.edu');
      deliveredCode = code;
    }
  });

  const protectedPage = await fetch(`${origin}/Dashboard/dashboard.html`, { redirect: 'manual' });
  assert.equal(protectedPage.status, 302);
  assert.equal(protectedPage.headers.get('location'), '/index.html');

  const request = await post(origin, '/api/auth/request-otp', { email: 'Student@example.edu', name: 'Student One' });
  assert.equal(request.status, 200);
  assert.equal(deliveredCode, '004281');
  assert.doesNotMatch(await request.text(), /004281/);

  const invalid = await post(origin, '/api/auth/verify-otp', { email: 'student@example.edu', code: '000000' });
  assert.equal(invalid.status, 400);

  const verified = await post(origin, '/api/auth/verify-otp', { email: 'student@example.edu', code: deliveredCode });
  assert.equal(verified.status, 200);
  const sessionBody = await verified.json();
  assert.equal(sessionBody.email, 'student@example.edu');
  assert.equal(sessionBody.name, 'Student One');
  assert.equal(typeof sessionBody.expiresAt, 'number');
  const cookie = verified.headers.get('set-cookie').split(';')[0];

  const session = await fetch(`${origin}/api/auth/session`, { headers: { cookie } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).email, 'student@example.edu');
  const dashboard = await fetch(`${origin}/Dashboard/dashboard.html`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(dashboard.status, 200);

  const logout = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(logout.status, 204);
  const expired = await fetch(`${origin}/api/auth/session`, { headers: { cookie } });
  assert.equal(expired.status, 401);
});

test('OTP requests are throttled and codes expire', async t => {
  let clock = Date.now();
  const origin = await startServer(t, {
    now: () => clock,
    randomCode: () => '123456',
    sendOtpEmail: async () => {}
  });

  const request = await post(origin, '/api/auth/request-otp', { email: 'student@example.edu' });
  assert.equal(request.status, 200);
  const throttled = await post(origin, '/api/auth/request-otp', { email: 'student@example.edu' });
  assert.equal(throttled.status, 429);

  clock += 10 * 60 * 1000 + 1;
  const expired = await post(origin, '/api/auth/verify-otp', { email: 'student@example.edu', code: '123456' });
  assert.equal(expired.status, 400);
});

test('unconfigured email delivery reports setup requirements and private files are not served', async t => {
  const server = createStudySyncServer({
    env: { SESSION_SECRET: SECRET, NODE_ENV: 'development' }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const request = await post(origin, '/api/auth/request-otp', { email: 'student@example.edu' });
  assert.equal(request.status, 503);
  assert.match((await request.json()).error, /Gmail API/);

  const privateFile = await fetch(`${origin}/server.js`);
  assert.equal(privateFile.status, 404);
  const traversal = await fetch(`${origin}/Dashboard/../server.js`);
  assert.equal(traversal.status, 404);
  const page = await fetch(`${origin}/index.html`);
  assert.equal(page.status, 200);
});
