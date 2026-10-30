'use strict';

// Tests for the Node.js app. Run with: npm test
// A small fake Epic server stands in for fhir.epic.com, so no network access is needed.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { describe, test, before, after } = require('node:test');

const { createApp, loadConfig, isValidState } = require('../server');
const { escapeHtml } = require('../public/js/escape-html');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TEST_SECRET = 'test-session-secret-'.padEnd(48, 'x');

// ---------- helpers ----------

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(done => {
          server.closeAllConnections();
          server.close(done);
        })
      });
    });
  });
}

function startApp(env) {
  return listen(createApp(loadConfig({ SESSION_SECRET: TEST_SECRET, ...env })));
}

function get(baseUrl, pathname, cookie) {
  return fetch(baseUrl + pathname, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
}

function cookieFrom(response) {
  const header = response.headers.get('set-cookie');
  return header ? header.split(';')[0] : null;
}

function captureLogs() {
  const lines = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const level of Object.keys(original)) {
    console[level] = (...args) => lines.push(args.map(String).join(' '));
  }
  return { lines, restore: () => Object.assign(console, original) };
}

// Fake Epic: SMART discovery, a token endpoint that checks PKCE, and Patient reads.
async function startFakeEpic() {
  const fake = {
    challenge: null,
    tokenResponse: null,
    tokenRequests: [],
    patientRequests: []
  };

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/fhir/.well-known/smart-configuration') {
      return send(res, 200, {
        authorization_endpoint: `${fake.baseUrl}/authorize`,
        token_endpoint: `${fake.baseUrl}/token`
      });
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        fake.tokenRequests.push(form);
        if (form.grant_type === 'authorization_code') {
          const challenge = crypto.createHash('sha256').update(form.code_verifier || '').digest('base64url');
          if (form.code !== 'good-code' || challenge !== fake.challenge) {
            return send(res, 400, { error: 'invalid_grant', error_description: 'code or PKCE check failed' });
          }
          return send(res, 200, fake.tokenResponse || {
            access_token: 'access-1',
            token_type: 'Bearer',
            // Less than the app's 60 second margin, so the next API call refreshes first.
            expires_in: 30,
            refresh_token: 'refresh-1',
            scope: 'launch/patient patient/Patient.read',
            patient: 'pat-123'
          });
        }
        if (form.grant_type === 'refresh_token' && form.refresh_token === 'refresh-1') {
          return send(res, 200, { access_token: 'access-2', token_type: 'Bearer', expires_in: 3600 });
        }
        return send(res, 400, { error: 'invalid_grant' });
      });
      return undefined;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/fhir/Patient/')) {
      fake.patientRequests.push({ authorization: req.headers.authorization });
      if (req.headers.authorization !== 'Bearer access-2') {
        return send(res, 401, { resourceType: 'OperationOutcome', issue: [{ code: 'login' }] });
      }
      return send(res, 200, { resourceType: 'Patient', id: 'pat-123', name: [{ family: 'Argonaut', given: ['Jason'] }] });
    }

    return send(res, 404, {});
  });

  return Object.assign(fake, server);
}

// ---------- unit tests ----------

describe('escapeHtml', () => {
  test('escapes HTML special characters', () => {
    assert.equal(
      escapeHtml('<img src=x onerror="alert(1)"> & \'quote\''),
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quote&#39;'
    );
  });

  test('turns null and undefined into an empty string', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(42), '42');
  });
});

describe('loadConfig', () => {
  test('requires SESSION_SECRET when demo mode is off', () => {
    assert.throws(() => loadConfig({ DEMO_MODE: 'false' }), /SESSION_SECRET/);
    assert.throws(() => loadConfig({ SESSION_SECRET: 'too-short' }), /SESSION_SECRET/);
    assert.throws(() => loadConfig({ SESSION_SECRET: 'change-this-to-random-secret-string' }), /SESSION_SECRET/);
  });

  test('uses a random secret in demo mode when none is set', () => {
    const config = loadConfig({ DEMO_MODE: 'true' });
    assert.equal(config.sessionSecretIsRandom, true);
    assert.ok(config.sessionSecret.length >= 32);
  });
});

describe('isValidState', () => {
  test('rejects missing, empty and different values', () => {
    assert.equal(isValidState(undefined, undefined), false);
    assert.equal(isValidState('', ''), false);
    assert.equal(isValidState('abc', undefined), false);
    assert.equal(isValidState(['abc'], 'abc'), false);
    assert.equal(isValidState('abc', 'abd'), false);
  });

  test('accepts the same non-empty value', () => {
    assert.equal(isValidState('abc123', 'abc123'), true);
  });
});

// ---------- HTTP tests ----------

describe('pages and Content Security Policy', () => {
  let app;
  before(async () => { app = await startApp({ DEMO_MODE: 'true' }); });
  after(() => app.close());

  test('sends a strict CSP header', async () => {
    const res = await get(app.baseUrl, '/');
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  });

  for (const page of ['index.html', 'dashboard.html']) {
    test(`${page} has no inline code and its files are served`, async () => {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, page), 'utf8');
      assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, 'no inline <script>');
      assert.doesNotMatch(html, /<style[\s>]/i, 'no <style> block');
      assert.doesNotMatch(html, /\sstyle\s*=/i, 'no style attribute');
      assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handler');

      const files = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"|<link[^>]*\shref="([^"]+)"/g)]
        .map(m => m[1] || m[2]);
      assert.ok(files.length > 0);
      for (const file of files) {
        assert.ok(file.startsWith('/'), `${file} is a same-origin path`);
        const res = await get(app.baseUrl, file);
        assert.equal(res.status, 200, `${file} is served`);
        assert.match(res.headers.get('content-type'), file.endsWith('.css') ? /text\/css/ : /javascript/);
      }
    });
  }

  test('dashboard script builds no inline style attributes', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'dashboard.js'), 'utf8');
    assert.doesNotMatch(js, /style\s*=/);
  });
});

describe('demo mode', () => {
  let app;
  let cookie;
  before(async () => {
    app = await startApp({ DEMO_MODE: 'true' });
    const res = await get(app.baseUrl, '/demo');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/dashboard');
    cookie = cookieFrom(res);
  });
  after(() => app.close());

  test('session cookie is HttpOnly and SameSite=Lax', async () => {
    const res = await get(app.baseUrl, '/demo');
    const header = res.headers.get('set-cookie');
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
  });

  test('dashboard and data endpoints return demo data', async () => {
    assert.equal((await get(app.baseUrl, '/dashboard', cookie)).status, 200);

    const patient = await (await get(app.baseUrl, '/api/patient', cookie)).json();
    assert.equal(patient.name[0].family, 'Argonaut');

    for (const [route, count] of [['/api/observations', 4], ['/api/conditions', 3], ['/api/medications', 3]]) {
      const res = await get(app.baseUrl, route, cookie);
      assert.equal(res.status, 200, route);
      assert.equal((await res.json()).entry.length, count, route);
    }
  });

  test('debug endpoints are off without DEBUG=true', async () => {
    for (const route of ['/api/debug/epic', '/api/debug/observations/sample', '/api/debug/medications/sample']) {
      assert.equal((await get(app.baseUrl, route, cookie)).status, 404, route);
    }
  });

  test('logout needs POST and ends the session', async () => {
    const res = await get(app.baseUrl, '/demo');
    const own = cookieFrom(res);
    assert.equal((await get(app.baseUrl, '/logout', own)).status, 404);

    const logout = await fetch(`${app.baseUrl}/logout`, { method: 'POST', redirect: 'manual', headers: { Cookie: own } });
    assert.equal(logout.status, 303);
    assert.equal((await get(app.baseUrl, '/api/session', own)).status, 401);
  });
});

describe('debug endpoints with DEBUG=true', () => {
  let app;
  let cookie;
  before(async () => {
    app = await startApp({ DEMO_MODE: 'true', DEBUG: 'true' });
    cookie = cookieFrom(await get(app.baseUrl, '/demo'));
  });
  after(() => app.close());

  test('work in demo mode', async () => {
    for (const [route, count] of [
      ['/api/debug/observations/sample', 4],
      ['/api/debug/medications/sample', 3],
      ['/api/debug/conditions/sample', 3]
    ]) {
      const res = await get(app.baseUrl, route, cookie);
      assert.equal(res.status, 200, route);
      const body = await res.json();
      assert.equal(body.mode, 'demo', route);
      assert.equal(body.count, count, route);
    }
  });

  test('still need a session', async () => {
    assert.equal((await get(app.baseUrl, '/api/debug/epic')).status, 401);
  });
});

describe('live mode (DEMO_MODE=false)', () => {
  let app;
  before(async () => { app = await startApp({ DEMO_MODE: 'false' }); });
  after(() => app.close());

  test('/demo is not available', async () => {
    assert.equal((await get(app.baseUrl, '/demo')).status, 404);
  });

  test('API routes need a session', async () => {
    const res = await get(app.baseUrl, '/api/patient');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'not_signed_in');
  });

  test('callback without a state is rejected', async () => {
    assert.equal((await get(app.baseUrl, '/callback?code=abc')).status, 400);
    assert.equal((await get(app.baseUrl, '/callback?code=abc&state=guess')).status, 400);
  });
});

describe('SMART standalone launch against a fake Epic server', () => {
  let epic;
  let app;
  let logs;

  before(async () => {
    logs = captureLogs();
    epic = await startFakeEpic();
    app = await startApp({
      DEMO_MODE: 'false',
      CLIENT_ID: 'test-client-id-1234',
      REDIRECT_URI: 'http://localhost:3000/callback',
      FHIR_BASE_URL: `${epic.baseUrl}/fhir`
    });
  });

  after(async () => {
    logs.restore();
    await app.close();
    await epic.close();
  });

  async function startLogin() {
    const res = await get(app.baseUrl, '/launch');
    assert.equal(res.status, 302);
    const authorizeUrl = new URL(res.headers.get('location'));
    epic.challenge = authorizeUrl.searchParams.get('code_challenge');
    return { authorizeUrl, state: authorizeUrl.searchParams.get('state'), cookie: cookieFrom(res) };
  }

  test('launch redirects to Epic with PKCE and state', async () => {
    const { authorizeUrl, state, cookie } = await startLogin();
    assert.equal(`${authorizeUrl.origin}${authorizeUrl.pathname}`, `${epic.baseUrl}/authorize`);
    const q = authorizeUrl.searchParams;
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('client_id'), 'test-client-id-1234');
    assert.equal(q.get('redirect_uri'), 'http://localhost:3000/callback');
    assert.equal(q.get('aud'), `${epic.baseUrl}/fhir`);
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.match(q.get('scope'), /launch\/patient/);
    assert.ok(state);
    assert.ok(cookie);
  });

  test('callback checks state, sends the PKCE verifier, starts a new session and refreshes the token', async () => {
    epic.tokenRequests.length = 0;
    const { state, cookie: launchCookie } = await startLogin();

    const callback = await get(app.baseUrl, `/callback?code=good-code&state=${state}`, launchCookie);
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/dashboard');
    const cookie = cookieFrom(callback);
    assert.ok(cookie);
    assert.notEqual(cookie, launchCookie, 'the session ID changes after login');

    // The first token is about to expire, so the app uses the refresh token first.
    const patient = await get(app.baseUrl, '/api/patient', cookie);
    assert.equal(patient.status, 200);
    assert.equal((await patient.json()).id, 'pat-123');
    assert.deepEqual(epic.tokenRequests.map(r => r.grant_type), ['authorization_code', 'refresh_token']);
    assert.equal(epic.patientRequests.at(-1).authorization, 'Bearer access-2');

    // The state can be used only once, with the old or the new session.
    assert.equal((await get(app.baseUrl, `/callback?code=good-code&state=${state}`, launchCookie)).status, 400);
    assert.equal((await get(app.baseUrl, `/callback?code=good-code&state=${state}`, cookie)).status, 400);
  });

  test('asks the user to log in again when the refresh fails', async () => {
    epic.tokenResponse = { access_token: 'access-x', expires_in: 30, refresh_token: 'refresh-bad', patient: 'pat-123' };
    try {
      const { state, cookie: launchCookie } = await startLogin();
      const cookie = cookieFrom(await get(app.baseUrl, `/callback?code=good-code&state=${state}`, launchCookie));

      const res = await get(app.baseUrl, '/api/patient', cookie);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'session_expired');
      assert.equal((await get(app.baseUrl, '/api/patient', cookie)).status, 401);
    } finally {
      epic.tokenResponse = null;
    }
  });

  test('rejects a token without patient context', async () => {
    epic.tokenResponse = { access_token: 'access-np', expires_in: 3600 };
    try {
      const { state, cookie } = await startLogin();
      const res = await get(app.baseUrl, `/callback?code=good-code&state=${state}`, cookie);
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /patient/);
    } finally {
      epic.tokenResponse = null;
    }
  });

  test('a failed token exchange gives a generic error and uses up the state', async () => {
    const { state, cookie } = await startLogin();
    const res = await get(app.baseUrl, `/callback?code=wrong-code&state=${state}`, cookie);
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.doesNotMatch(text, /invalid_grant|PKCE/);

    // Same session, same state: rejected before any new call to Epic.
    const before = epic.tokenRequests.length;
    assert.equal((await get(app.baseUrl, `/callback?code=good-code&state=${state}`, cookie)).status, 400);
    assert.equal(epic.tokenRequests.length, before);
  });

  test('an error from Epic is reported without the description', async () => {
    const { state, cookie } = await startLogin();
    const res = await get(app.baseUrl, `/callback?error=access_denied&error_description=<b>x</b>&state=${state}`, cookie);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.reason, 'access_denied');
    assert.doesNotMatch(JSON.stringify(body), /<b>/);
  });

  test('logs contain no tokens, codes or patient IDs', () => {
    const output = logs.lines.join('\n');
    for (const secret of ['access-1', 'access-2', 'refresh-1', 'good-code', 'pat-123']) {
      assert.ok(!output.includes(secret), `log must not contain ${secret}`);
    }
  });
});
