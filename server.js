/**
 * SMART on FHIR demo app for the Epic sandbox (https://fhir.epic.com)
 *
 * - Standalone launch: the user starts in this app and signs in to Epic.
 * - OAuth 2.0 authorization code flow with PKCE (S256).
 * - Reads FHIR R4 Patient, Observation, Condition and MedicationRequest resources.
 * - Demo mode (DEMO_MODE=true) shows sample data without an Epic login.
 *
 * This is demo code. See "Security notes" in README.md before you reuse it.
 */

const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const DEMO_DATA = require('./lib/demo-data');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'sid';
const DEFAULT_SCOPES =
  'launch/patient openid fhirUser patient/Patient.read patient/Observation.read ' +
  'patient/Condition.read patient/MedicationRequest.read';
const DEFAULT_OBSERVATION_CATEGORIES = 'laboratory,vital-signs';
const MIN_SESSION_SECRET_LENGTH = 32;
// Values from older example files. They are public, so they are never accepted.
const PLACEHOLDER_SECRETS = new Set([
  'change-this-to-random-secret-string',
  'dev-secret-change-in-production'
]);
// Treat the access token as expired one minute early, so a request does not fail half way.
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;
const HTTP_TIMEOUT_MS = 15 * 1000;

// ============================================
// Configuration
// ============================================

/**
 * Reads the settings from environment variables (see .env.example).
 * Throws an Error with a clear message when a required setting is missing.
 */
function loadConfig(env = process.env) {
  const demoMode = env.DEMO_MODE === 'true';
  let sessionSecret = env.SESSION_SECRET || '';
  let sessionSecretIsRandom = false;

  const secretIsWeak =
    sessionSecret.length < MIN_SESSION_SECRET_LENGTH || PLACEHOLDER_SECRETS.has(sessionSecret);

  if (secretIsWeak) {
    if (!demoMode) {
      throw new Error(
        `SESSION_SECRET must be a random string of at least ${MIN_SESSION_SECRET_LENGTH} characters. ` +
          'Create one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    // Demo mode only: use a random secret for this run. Sessions end when the server stops.
    sessionSecret = crypto.randomBytes(32).toString('hex');
    sessionSecretIsRandom = true;
  }

  return {
    port: Number(env.PORT) || 3000,
    demoMode,
    debug: env.DEBUG === 'true',
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === '1',
    sessionSecret,
    sessionSecretIsRandom,
    clientId: env.CLIENT_ID || '',
    redirectUri: env.REDIRECT_URI || '',
    fhirBaseUrl: env.FHIR_BASE_URL || '',
    smartScopes: env.SMART_SCOPES || DEFAULT_SCOPES,
    observationCategories: (env.OBSERVATION_CATEGORIES || DEFAULT_OBSERVATION_CATEGORIES)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  };
}

// ============================================
// PKCE and state helpers
// ============================================

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * True only when both values are non-empty strings and they are equal.
 * A state that is missing in the session or in the callback URL never passes.
 */
function isValidState(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ============================================
// Helpers for Epic responses
// ============================================

function extractOperationOutcomeDiagnostics(operationOutcome) {
  if (!operationOutcome || operationOutcome.resourceType !== 'OperationOutcome') {
    return null;
  }
  const issues = Array.isArray(operationOutcome.issue) ? operationOutcome.issue : [];
  const diagnostics = issues.map(i => i?.diagnostics || i?.details?.text).filter(Boolean);
  return diagnostics.length ? diagnostics : null;
}

/**
 * Epic answers "Client not authorized for Observation - Labs." when an API is not
 * enabled for the app. This returns the API names from such messages.
 */
function extractNotAuthorizedTargets(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  const targets = new Set();
  for (const msg of diagnostics) {
    if (typeof msg !== 'string') continue;
    const match = msg.match(/Client not authorized for ([^.]+)\./i);
    if (match && match[1]) targets.add(match[1].trim());
  }
  return Array.from(targets);
}

function maskClientId(clientId) {
  if (!clientId || typeof clientId !== 'string') return null;
  if (clientId.length <= 8) return '********';
  return `${clientId.slice(0, 4)}...${clientId.slice(-4)}`;
}

function pickSafeResponseHeaders(headers) {
  const safe = {};
  if (!headers || typeof headers !== 'object') return safe;
  const denyList = new Set(['set-cookie', 'cookie', 'authorization']);
  const allowList = new Set([
    'content-type',
    'date',
    'server',
    'etag',
    'last-modified',
    'cache-control',
    'expires',
    'pragma',
    'vary',
    'content-location',
    'location',
    'content-encoding'
  ]);
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = String(key).toLowerCase();
    if (denyList.has(lowerKey)) continue;
    if (allowList.has(lowerKey)) {
      safe[lowerKey] = value;
      continue;
    }
    if (
      lowerKey.includes('request') ||
      lowerKey.includes('trace') ||
      lowerKey.includes('correlation') ||
      lowerKey.includes('epic') ||
      lowerKey.startsWith('x-')
    ) {
      safe[lowerKey] = value;
    }
  }
  return safe;
}

/**
 * Short summary of a failed HTTP call, for the server log.
 * It has status and error codes only. No tokens, no URLs, no patient IDs.
 */
function describeUpstreamError(error) {
  const summary = { status: error?.response?.status ?? null };
  if (error?.code) summary.code = error.code;
  const data = error?.response?.data;
  if (data && typeof data === 'object') {
    // OAuth errors from the token endpoint, for example "invalid_grant".
    if (typeof data.error === 'string') summary.oauthError = data.error;
    if (typeof data.error_description === 'string') {
      summary.oauthErrorDescription = data.error_description.slice(0, 200);
    }
    if (data.resourceType === 'OperationOutcome' && Array.isArray(data.issue)) {
      summary.issueCodes = data.issue.map(issue => issue?.code).filter(Boolean);
      const notAuthorized = extractNotAuthorizedTargets(extractOperationOutcomeDiagnostics(data));
      if (notAuthorized.length) summary.notAuthorizedFor = notAuthorized;
    }
  }
  if (!error?.response && error?.message) summary.message = error.message;
  return JSON.stringify(summary);
}

function observationsNote(categoryErrors, clientId) {
  const allDiagnostics = categoryErrors.flatMap(e => (Array.isArray(e.diagnostics) ? e.diagnostics : []));
  const missingTargets = extractNotAuthorizedTargets(allDiagnostics);

  if (missingTargets.length) {
    return (
      `No observations available. The Epic app is not authorized for: ${missingTargets.join(', ')}. ` +
      `Go to https://fhir.epic.com/Developer/Apps, edit your app (client ID: ${maskClientId(clientId)}), ` +
      'enable these APIs, save, then connect again.'
    );
  }
  if (categoryErrors.some(e => [200, 400, 401, 403].includes(e.status))) {
    return (
      'No observations available. Epic blocked the Observation searches, even with the ' +
      'patient/Observation.read scope. Enable the "Observation - Labs" and "Observation - Vital Signs" ' +
      `APIs for your app at https://fhir.epic.com/Developer/Apps (client ID: ${maskClientId(clientId)}), ` +
      'save, then connect again.'
    );
  }
  if (categoryErrors.length) {
    return 'No observations available. Epic returned an error for the Observation search. See the server log.';
  }
  return 'No observations found for this patient.';
}

// Summaries used by the debug endpoints.

function summarizeObservation(entry, category, index) {
  const obs = entry?.resource;
  return {
    category,
    bundleIndex: index,
    entryKeys: entry ? Object.keys(entry) : [],
    entryFullUrl: entry?.fullUrl || null,
    resourceType: obs?.resourceType || null,
    resourceKeys: obs ? Object.keys(obs) : [],
    resourceIsEmpty: obs ? Object.keys(obs).length === 0 : true,
    id: obs?.id || null,
    status: obs?.status || null,
    code: obs?.code || null,
    categoryField: obs?.category || null,
    effectiveDateTime: obs?.effectiveDateTime || null,
    effectivePeriod: obs?.effectivePeriod || null,
    issued: obs?.issued || null,
    valueQuantity: obs?.valueQuantity || null,
    valueCodeableConcept: obs?.valueCodeableConcept || null,
    valueString: obs?.valueString || null,
    hasMemberCount: Array.isArray(obs?.hasMember) ? obs.hasMember.length : 0,
    component: Array.isArray(obs?.component)
      ? obs.component.slice(0, 10).map(c => ({
          code: c.code || null,
          valueQuantity: c.valueQuantity || null,
          valueCodeableConcept: c.valueCodeableConcept || null,
          valueString: c.valueString || null
        }))
      : [],
    resourceSnippet: obs ? JSON.stringify(obs).slice(0, 500) : null
  };
}

function summarizeMedicationRequest(med, index) {
  return {
    index,
    resourceType: med?.resourceType,
    resourceKeys: med ? Object.keys(med) : [],
    id: med?.id,
    status: med?.status,
    medicationCodeableConcept: med?.medicationCodeableConcept || null,
    medicationReference: med?.medicationReference || null,
    containedCount: Array.isArray(med?.contained) ? med.contained.length : 0,
    authoredOn: med?.authoredOn || null,
    dosageInstruction: med?.dosageInstruction?.[0]?.text || null,
    category: med?.category || null,
    reasonCode: med?.reasonCode || null,
    identifier: med?.identifier?.[0] || null,
    snippet: med ? JSON.stringify(med).slice(0, 600) : null
  };
}

function summarizeCondition(cond, index) {
  return {
    index,
    resourceType: cond?.resourceType,
    resourceKeys: cond ? Object.keys(cond) : [],
    id: cond?.id,
    code: cond?.code || null,
    clinicalStatus: cond?.clinicalStatus || null,
    verificationStatus: cond?.verificationStatus || null,
    category: cond?.category || null,
    severity: cond?.severity || null,
    bodySite: cond?.bodySite || null,
    onsetDateTime: cond?.onsetDateTime || null,
    onsetPeriod: cond?.onsetPeriod || null,
    snippet: cond ? JSON.stringify(cond).slice(0, 600) : null
  };
}

// ============================================
// SMART configuration discovery
// ============================================

/**
 * Finds the authorize and token endpoints of the FHIR server.
 * Tries .well-known/smart-configuration first, then the CapabilityStatement (/metadata).
 */
async function getSmartConfiguration(http, fhirBaseUrl) {
  let smartConfig;
  try {
    const response = await http.get(`${fhirBaseUrl}/.well-known/smart-configuration`, {
      headers: { Accept: 'application/json' }
    });
    smartConfig = response.data;
  } catch (error) {
    const metadataResponse = await http.get(`${fhirBaseUrl}/metadata`, {
      headers: { Accept: 'application/fhir+json' }
    });
    const security = metadataResponse.data?.rest?.[0]?.security;
    const oauthExtension = security?.extension?.find(
      ext => ext.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
    );
    smartConfig = {
      authorization_endpoint: oauthExtension?.extension?.find(e => e.url === 'authorize')?.valueUri,
      token_endpoint: oauthExtension?.extension?.find(e => e.url === 'token')?.valueUri
    };
  }

  if (
    typeof smartConfig?.authorization_endpoint !== 'string' ||
    typeof smartConfig?.token_endpoint !== 'string'
  ) {
    throw new Error('Could not find the SMART authorize and token endpoints');
  }
  return smartConfig;
}

// Express 4 does not catch errors from async route handlers. This passes them to next().
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// ============================================
// App
// ============================================

function createApp(config) {
  const app = express();
  const http = axios.create({ timeout: HTTP_TIMEOUT_MS });
  // Token refresh calls that are running now, one per session ID.
  const refreshCalls = new Map();

  if (config.trustProxy) {
    // Needed behind a reverse proxy that ends HTTPS (for example nginx).
    // Express then reads X-Forwarded-Proto and can send the secure cookie.
    app.set('trust proxy', 1);
  }

  // Content Security Policy: scripts and styles load from this server only.
  // The pages have no inline scripts, inline styles or inline event handlers.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        // Ask browsers to upgrade to HTTPS only when the app runs behind HTTPS.
        'upgrade-insecure-requests': config.production ? [] : null
      }
    },
    xFrameOptions: { action: 'deny' }
  }));

  app.use(session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    // No store is set, so express-session uses its MemoryStore. That is fine for this
    // demo only: it loses all sessions on restart and does not work with more than one
    // server process. Use a real session store for anything else.
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production
    }
  }));

  app.use(express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));

  // ------------------------------------------
  // Session and token helpers
  // ------------------------------------------

  function isSignedIn(sess) {
    return Boolean(sess.demoMode || sess.accessToken);
  }

  // Epic errors and request traces are only kept when the debug endpoints are on.
  function recordEpicErrors(req, key, value) {
    if (!config.debug) return;
    req.session.lastEpicErrors = { ...(req.session.lastEpicErrors || {}), [key]: value };
  }

  function recordTrace(req, key, trace) {
    if (!config.debug) return;
    req.session.lastEpicTrace = {
      ...(req.session.lastEpicTrace || {}),
      [key]: { at: new Date().toISOString(), ...trace }
    };
  }

  function storeToken(sess, token) {
    sess.accessToken = token.access_token;
    if (token.refresh_token) sess.refreshToken = token.refresh_token;
    if (token.scope) sess.grantedScope = token.scope;
    const expiresIn = Number(token.expires_in);
    sess.tokenExpiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;
  }

  function clearSignIn(sess) {
    delete sess.accessToken;
    delete sess.refreshToken;
    delete sess.tokenExpiresAt;
  }

  function postToTokenEndpoint(tokenEndpoint, fields) {
    return http.post(tokenEndpoint, new URLSearchParams(fields).toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      }
    });
  }

  /**
   * Makes sure the session has an access token that has not expired.
   * Uses the refresh token when Epic gave one. Returns false when the user
   * has to sign in again.
   */
  async function ensureFreshToken(req) {
    const sess = req.session;
    if (!sess.tokenExpiresAt || Date.now() < sess.tokenExpiresAt - TOKEN_EXPIRY_MARGIN_MS) {
      return true;
    }
    if (!sess.refreshToken || !sess.tokenEndpoint) {
      return false;
    }

    // The dashboard sends several requests at the same time. They share one refresh call.
    let refreshCall = refreshCalls.get(req.sessionID);
    if (!refreshCall) {
      refreshCall = postToTokenEndpoint(sess.tokenEndpoint, {
        grant_type: 'refresh_token',
        refresh_token: sess.refreshToken,
        client_id: config.clientId
      })
        .then(response => (response.data?.access_token ? response.data : null))
        .catch(error => {
          console.error('Token refresh failed:', describeUpstreamError(error));
          return null;
        })
        .finally(() => refreshCalls.delete(req.sessionID));
      refreshCalls.set(req.sessionID, refreshCall);
    }

    const token = await refreshCall;
    if (!token) return false;
    storeToken(sess, token);
    return true;
  }

  // Protects the /api routes. Demo sessions pass without a token.
  async function requireSignIn(req, res, next) {
    try {
      if (req.session.demoMode) return next();
      if (!req.session.accessToken || !req.session.patientId) {
        return res.status(401).json({ error: 'not_signed_in', message: 'Please connect to Epic first.' });
      }
      if (!(await ensureFreshToken(req))) {
        clearSignIn(req.session);
        return res.status(401).json({
          error: 'session_expired',
          message: 'Your Epic session has ended. Please connect to Epic again.'
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function fhirGet(req, resourcePath, params) {
    return http.get(`${req.session.fhirBaseUrl}/${resourcePath}`, {
      params,
      headers: {
        Authorization: `Bearer ${req.session.accessToken}`,
        Accept: 'application/fhir+json'
      }
    });
  }

  // Logs the details on the server and sends a generic message to the browser.
  function sendUpstreamError(res, error, label) {
    console.error(`Epic ${label} request failed:`, describeUpstreamError(error));
    if (error?.response?.status === 401) {
      return res.status(401).json({
        error: 'session_expired',
        message: 'Epic did not accept the access token. Please connect to Epic again.'
      });
    }
    return res.status(502).json({ error: 'upstream_error', message: `Could not load ${label} data from Epic.` });
  }

  /**
   * Runs one Observation search per configured category.
   * Epic needs a category for Observation searches, and it checks app access per
   * category ("Observation - Labs", "Observation - Vital Signs", and so on).
   * Returns one result per category: { category, status, entries } or { category, status, error }.
   */
  async function fetchObservations(req, count) {
    const results = [];
    for (const category of config.observationCategories) {
      const params = { patient: req.session.patientId, category, _count: count };
      try {
        const response = await fhirGet(req, 'Observation', params);
        const entries = Array.isArray(response.data?.entry) ? response.data.entry : [];
        results.push({ category, status: response.status, entries });
        recordTrace(req, `observations:${category}`, {
          request: { method: 'GET', resource: 'Observation', params },
          response: {
            status: response.status,
            headers: pickSafeResponseHeaders(response.headers),
            bundleTotal: response.data?.total ?? null,
            entryCount: entries.length
          }
        });
      } catch (error) {
        const status = error?.response?.status ?? null;
        const data = error?.response?.data;
        console.warn(`Epic Observation search failed (category ${category}):`, describeUpstreamError(error));
        results.push({ category, status, error });
        recordTrace(req, `observations:${category}`, {
          request: { method: 'GET', resource: 'Observation', params },
          response: {
            status,
            headers: pickSafeResponseHeaders(error?.response?.headers),
            operationOutcome: data?.resourceType === 'OperationOutcome' ? data : null
          }
        });
      }
    }
    return results;
  }

  // ------------------------------------------
  // Pages and status
  // ------------------------------------------

  app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', mode: config.demoMode ? 'demo' : 'live', timestamp: new Date().toISOString() });
  });

  app.get('/api/mode', (req, res) => {
    res.json({ demoMode: config.demoMode });
  });

  // Demo mode: skip OAuth and show sample data. Only available when DEMO_MODE=true.
  app.get('/demo', (req, res, next) => {
    if (!config.demoMode) {
      return res.status(404).send('Demo mode is turned off on this server.');
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.demoMode = true;
      req.session.patientId = DEMO_DATA.patient.id;
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.redirect('/dashboard');
      });
    });
  });

  app.get('/dashboard', (req, res) => {
    if (!isSignedIn(req.session)) {
      return res.redirect('/');
    }
    res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
  });

  // ------------------------------------------
  // SMART standalone launch
  // ------------------------------------------

  // Step 1: send the browser to Epic's authorize endpoint.
  app.get('/launch', asyncRoute(async (req, res) => {
    if (!config.clientId || !config.redirectUri || !config.fhirBaseUrl) {
      console.error('Launch error: CLIENT_ID, REDIRECT_URI and FHIR_BASE_URL must be set.');
      return res.status(500).json({ error: 'The Epic connection is not set up on this server.' });
    }

    let smartConfig;
    try {
      smartConfig = await getSmartConfiguration(http, config.fhirBaseUrl);
    } catch (error) {
      console.error('Launch error (SMART discovery):', describeUpstreamError(error));
      return res.status(502).json({ error: 'Could not start the Epic login. See the server log.' });
    }

    const codeVerifier = generateCodeVerifier();
    const state = generateState();

    // One-time values for the callback. They are removed when the callback arrives.
    req.session.oauth = {
      state,
      codeVerifier,
      tokenEndpoint: smartConfig.token_endpoint
    };

    const authUrl = new URL(smartConfig.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', config.redirectUri);
    // The scopes must match the APIs enabled for the app in the Epic portal.
    // launch/patient asks Epic to return the patient ID with the token.
    authUrl.searchParams.set('scope', config.smartScopes);
    authUrl.searchParams.set('state', state);
    // Epic returns an id_token for the openid scope. This demo does not use the
    // id_token, so the nonce is sent but not checked.
    authUrl.searchParams.set('nonce', generateState());
    authUrl.searchParams.set('aud', config.fhirBaseUrl);
    // PKCE (S256): Epic checks the code_verifier against this challenge at the token step.
    authUrl.searchParams.set('code_challenge', generateCodeChallenge(codeVerifier));
    authUrl.searchParams.set('code_challenge_method', 'S256');

    res.redirect(authUrl.toString());
  }));

  // Step 2: Epic sends the browser back here with an authorization code.
  app.get('/callback', asyncRoute(async (req, res, next) => {
    const { code, state, error } = req.query;
    const pending = req.session.oauth;
    // Remove the one-time values now, so the same callback cannot be used twice.
    delete req.session.oauth;

    if (error) {
      const reason = /^[a-z_]{1,64}$/.test(String(error)) ? String(error) : 'unknown_error';
      console.warn(`Epic returned an authorization error: ${reason}`);
      return res.status(400).json({ error: 'Epic sign-in was cancelled or failed.', reason });
    }

    if (!pending || !isValidState(state, pending.state)) {
      return res.status(400).json({ error: 'Missing or wrong state. Please start the login again.' });
    }

    if (typeof code !== 'string' || !code) {
      return res.status(400).json({ error: 'Missing authorization code. Please start the login again.' });
    }

    let token;
    try {
      const tokenResponse = await postToTokenEndpoint(pending.tokenEndpoint, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: pending.codeVerifier
      });
      token = tokenResponse.data;
    } catch (tokenError) {
      console.error('Token exchange failed:', describeUpstreamError(tokenError));
      return res.status(502).json({ error: 'Could not get an access token from Epic. See the server log.' });
    }

    if (!token || typeof token.access_token !== 'string') {
      console.error('Token exchange failed: the response has no access_token.');
      return res.status(502).json({ error: 'Could not get an access token from Epic. See the server log.' });
    }

    if (!token.patient) {
      console.warn('Token exchange: the token response has no patient context.');
      return res.status(400).json({
        error:
          'Epic did not return a patient for this login. Make sure the launch/patient scope ' +
          'is in SMART_SCOPES and is allowed for your Epic app, then try again.'
      });
    }

    // New session ID after sign-in, so an old session ID cannot be reused.
    req.session.regenerate(regenerateError => {
      if (regenerateError) return next(regenerateError);
      storeToken(req.session, token);
      req.session.patientId = String(token.patient);
      req.session.fhirBaseUrl = config.fhirBaseUrl;
      req.session.tokenEndpoint = pending.tokenEndpoint;
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        console.log('Epic sign-in completed.');
        res.redirect('/dashboard');
      });
    });
  }));

  // ------------------------------------------
  // FHIR data API (used by the dashboard)
  // ------------------------------------------

  app.get('/api/session', requireSignIn, (req, res) => {
    const sess = req.session;
    res.json({
      authenticated: true,
      demoMode: Boolean(sess.demoMode),
      patientId: sess.patientId,
      fhirBaseUrl: sess.demoMode ? 'Demo data (no Epic connection)' : sess.fhirBaseUrl,
      grantedScope: sess.grantedScope || null,
      tokenExpiresAt: sess.tokenExpiresAt ? new Date(sess.tokenExpiresAt).toISOString() : null
    });
  });

  app.get('/api/patient', requireSignIn, asyncRoute(async (req, res) => {
    if (req.session.demoMode) {
      return res.json(DEMO_DATA.patient);
    }
    try {
      const response = await fhirGet(req, `Patient/${encodeURIComponent(req.session.patientId)}`);
      return res.json(response.data);
    } catch (error) {
      return sendUpstreamError(res, error, 'patient');
    }
  }));

  app.get('/api/observations', requireSignIn, asyncRoute(async (req, res) => {
    if (req.session.demoMode) {
      return res.json(DEMO_DATA.observations);
    }

    const results = await fetchObservations(req, 10);
    let observations = [];
    const categoryErrors = [];

    for (const result of results) {
      if (result.error) {
        categoryErrors.push({
          category: result.category,
          status: result.status,
          diagnostics: extractOperationOutcomeDiagnostics(result.error?.response?.data)
        });
        continue;
      }
      // Epic can add OperationOutcome entries (warnings) to a search Bundle. Keep only Observations.
      observations = observations.concat(
        result.entries.filter(e => e.resource?.resourceType === 'Observation')
      );
      const warnings = result.entries
        .filter(e => e.resource?.resourceType === 'OperationOutcome')
        .flatMap(e => extractOperationOutcomeDiagnostics(e.resource) || []);
      if (warnings.length) {
        categoryErrors.push({ category: result.category, status: result.status, diagnostics: warnings });
      }
    }

    recordEpicErrors(req, 'observations', {
      attemptedCategories: config.observationCategories,
      categoryErrors
    });

    return res.json({
      resourceType: 'Bundle',
      type: 'searchset',
      entry: observations,
      total: observations.length,
      note: observations.length ? null : observationsNote(categoryErrors, config.clientId)
    });
  }));

  app.get('/api/conditions', requireSignIn, asyncRoute(async (req, res) => {
    if (req.session.demoMode) {
      return res.json(DEMO_DATA.conditions);
    }
    let response;
    try {
      response = await fhirGet(req, 'Condition', { patient: req.session.patientId, _count: 20 });
    } catch (error) {
      return sendUpstreamError(res, error, 'condition');
    }
    // Keep only Condition entries (Epic can add OperationOutcome warnings).
    const entries = Array.isArray(response.data?.entry) ? response.data.entry : [];
    const conditions = entries.filter(e => e.resource?.resourceType === 'Condition');
    return res.json({ ...response.data, entry: conditions, total: conditions.length });
  }));

  app.get('/api/medications', requireSignIn, asyncRoute(async (req, res) => {
    if (req.session.demoMode) {
      return res.json(DEMO_DATA.medications);
    }

    const params = { patient: req.session.patientId, _count: 20 };
    try {
      const response = await fhirGet(req, 'MedicationRequest', params);
      // Keep only MedicationRequest entries (Epic can add OperationOutcome warnings).
      const entries = Array.isArray(response.data?.entry) ? response.data.entry : [];
      const medications = entries.filter(e => e.resource?.resourceType === 'MedicationRequest');
      recordEpicErrors(req, 'medications', null);
      recordTrace(req, 'medications', {
        request: { method: 'GET', resource: 'MedicationRequest', params },
        response: {
          status: response.status,
          headers: pickSafeResponseHeaders(response.headers),
          bundleTotal: response.data?.total ?? null,
          entryCount: medications.length
        }
      });
      return res.json({ ...response.data, entry: medications, total: medications.length });
    } catch (error) {
      const status = error?.response?.status ?? null;
      if (status === 401) {
        return sendUpstreamError(res, error, 'medication');
      }
      console.error('Epic MedicationRequest search failed:', describeUpstreamError(error));
      const diagnostics = extractOperationOutcomeDiagnostics(error?.response?.data);
      const missingTargets = extractNotAuthorizedTargets(diagnostics || []);
      recordEpicErrors(req, 'medications', { errorStatus: status, diagnostics });
      recordTrace(req, 'medications', {
        request: { method: 'GET', resource: 'MedicationRequest', params },
        response: {
          status,
          headers: pickSafeResponseHeaders(error?.response?.headers),
          operationOutcome: error?.response?.data?.resourceType === 'OperationOutcome' ? error.response.data : null
        }
      });
      // Send an empty Bundle with a note, so the dashboard can explain what to enable in Epic.
      return res.json({
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [],
        total: 0,
        note: missingTargets.length
          ? `Medications not available. The Epic app is not authorized for: ${missingTargets.join(', ')}. ` +
            'Enable those APIs in the Epic developer portal, then connect again to get a new token.'
          : 'Medications not available. Epic returned an error. Check the MedicationRequest APIs enabled ' +
            'for your app in the Epic developer portal.'
      });
    }
  }));

  // ------------------------------------------
  // Debug endpoints (only when DEBUG=true)
  // ------------------------------------------

  if (config.debug) {
    // Tools for checking what Epic returns. Turn them on for local testing only.
    app.get('/api/debug/epic', requireSignIn, (req, res) => {
      res.json({
        demoMode: Boolean(req.session.demoMode),
        patientId: req.session.patientId,
        fhirBaseUrl: req.session.fhirBaseUrl || null,
        grantedScope: req.session.grantedScope || null,
        clientId: maskClientId(config.clientId),
        lastEpicErrors: req.session.lastEpicErrors || null,
        lastEpicTrace: req.session.lastEpicTrace || null
      });
    });

    app.get('/api/debug/observations/sample', requireSignIn, asyncRoute(async (req, res) => {
      if (req.session.demoMode) {
        const samples = DEMO_DATA.observations.entry
          .slice(0, 5)
          .map((entry, index) => summarizeObservation(entry, 'demo', index));
        return res.json({ mode: 'demo', count: samples.length, samples });
      }
      const results = await fetchObservations(req, 5);
      const samples = results.flatMap(result => {
        if (result.error) {
          const data = result.error?.response?.data;
          return [{
            category: result.category,
            errorStatus: result.status,
            operationOutcome: data?.resourceType === 'OperationOutcome' ? data : null
          }];
        }
        return result.entries.slice(0, 5).map((entry, index) => summarizeObservation(entry, result.category, index));
      });
      return res.json({ mode: 'live', count: samples.length, samples });
    }));

    const sendSamples = async (req, res, resourceType, demoBundle, summarize) => {
      let entries;
      if (req.session.demoMode) {
        entries = demoBundle.entry;
      } else {
        try {
          const response = await fhirGet(req, resourceType, { patient: req.session.patientId, _count: 20 });
          entries = Array.isArray(response.data?.entry) ? response.data.entry : [];
        } catch (error) {
          return sendUpstreamError(res, error, resourceType);
        }
      }
      const samples = entries.map((entry, index) => summarize(entry?.resource, index));
      return res.json({ mode: req.session.demoMode ? 'demo' : 'live', count: samples.length, samples });
    };

    app.get('/api/debug/medications/sample', requireSignIn, asyncRoute((req, res) =>
      sendSamples(req, res, 'MedicationRequest', DEMO_DATA.medications, summarizeMedicationRequest)
    ));

    app.get('/api/debug/conditions/sample', requireSignIn, asyncRoute((req, res) =>
      sendSamples(req, res, 'Condition', DEMO_DATA.conditions, summarizeCondition)
    ));
  }

  // ------------------------------------------
  // Logout and errors
  // ------------------------------------------

  // POST only, so a link or an image on another site cannot log the user out.
  app.post('/logout', (req, res, next) => {
    req.session.destroy(err => {
      if (err) return next(err);
      res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.production });
      res.redirect(303, '/');
    });
  });

  // Last error handler: log a short message and send a generic answer.
  app.use((err, req, res, next) => {
    console.error('Unexpected error:', err?.message || err);
    if (res.headersSent) return next(err);
    return res.status(500).json({ error: 'internal_error', message: 'Something went wrong. See the server log.' });
  });

  return app;
}

// ============================================
// Start
// ============================================

function start() {
  require('dotenv').config();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`Configuration error: ${error.message}`);
    process.exit(1);
  }

  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`SMART on FHIR demo running at http://localhost:${config.port}`);
    console.log(config.demoMode
      ? 'Demo mode is on: /demo shows sample data without an Epic login.'
      : 'Demo mode is off: sign in through Epic only.');
    if (config.redirectUri) {
      console.log(`Epic redirect URI: ${config.redirectUri}`);
    }
    if (config.sessionSecretIsRandom) {
      console.log('SESSION_SECRET is not set. Using a random secret for this run (demo mode only).');
    }
    if (config.production) {
      console.log('NODE_ENV=production: the session cookie is sent over HTTPS only.');
    }
    if (config.debug) {
      console.warn('DEBUG=true: the /api/debug endpoints are on. Use this for local testing only.');
    }
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  createApp,
  loadConfig,
  isValidState,
  generateCodeChallenge,
  extractNotAuthorizedTargets,
  describeUpstreamError
};
