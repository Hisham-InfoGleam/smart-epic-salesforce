/**
 * SMART on FHIR App for Epic Sandbox
 * 
 * This app demonstrates:
 * - Standalone Launch flow (patient logs in directly)
 * - OAuth2 with PKCE (required by Epic for public clients)
 * - FHIR R4 API queries
 * - Token management
 * - Demo mode for portfolio showcase
 * 
 * Epic Sandbox: https://fhir.epic.com
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const DEMO_MODE = process.env.DEMO_MODE === 'true';

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable for development
}));
app.use(cors());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true in production with HTTPS
}));

app.use(express.static('public', {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use(express.json());

// ============================================
// Demo Data (For Portfolio Showcase)
// ============================================

const DEMO_DATA = {
  patient: {
    resourceType: 'Patient',
    id: 'demo-patient-001',
    name: [{ given: ['Jason', 'A'], family: 'Argonaut' }],
    gender: 'male',
    birthDate: '1985-08-01',
    telecom: [{ system: 'phone', value: '(555) 555-1234' }],
    address: [{ city: 'Madison', state: 'WI', postalCode: '53703' }]
  },
  observations: {
    resourceType: 'Bundle',
    entry: [
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-1',
          code: { coding: [{ display: 'Blood Pressure' }] },
          valueQuantity: { value: 120, unit: 'mmHg' },
          effectiveDateTime: '2026-01-28T10:30:00Z',
          status: 'final'
        }
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-2',
          code: { coding: [{ display: 'Heart Rate' }] },
          valueQuantity: { value: 72, unit: 'bpm' },
          effectiveDateTime: '2026-01-28T10:30:00Z',
          status: 'final'
        }
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-3',
          code: { coding: [{ display: 'Body Temperature' }] },
          valueQuantity: { value: 98.6, unit: '°F' },
          effectiveDateTime: '2026-01-25T09:15:00Z',
          status: 'final'
        }
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-4',
          code: { coding: [{ display: 'Oxygen Saturation' }] },
          valueQuantity: { value: 98, unit: '%' },
          effectiveDateTime: '2026-01-28T10:30:00Z',
          status: 'final'
        }
      }
    ]
  },
  conditions: {
    resourceType: 'Bundle',
    entry: [
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-1',
          code: { coding: [{ display: 'Essential Hypertension' }] },
          clinicalStatus: { coding: [{ code: 'active' }] },
          onsetDateTime: '2020-03-15',
          category: [{ coding: [{ display: 'Encounter Diagnosis' }] }]
        }
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-2',
          code: { coding: [{ display: 'Type 2 Diabetes Mellitus' }] },
          clinicalStatus: { coding: [{ code: 'active' }] },
          onsetDateTime: '2019-06-20',
          category: [{ coding: [{ display: 'Problem List Item' }] }]
        }
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-3',
          code: { coding: [{ display: 'Seasonal Allergies' }] },
          clinicalStatus: { coding: [{ code: 'resolved' }] },
          onsetDateTime: '2023-04-01',
          category: [{ coding: [{ display: 'Problem List Item' }] }]
        }
      }
    ]
  },
  medications: {
    resourceType: 'Bundle',
    entry: [
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-1',
          medicationCodeableConcept: { coding: [{ display: 'Lisinopril 10mg Tablet' }] },
          status: 'active',
          dosageInstruction: [{ text: 'Take 1 tablet by mouth daily' }],
          authoredOn: '2024-01-15'
        }
      },
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-2',
          medicationCodeableConcept: { coding: [{ display: 'Metformin 500mg Tablet' }] },
          status: 'active',
          dosageInstruction: [{ text: 'Take 1 tablet by mouth twice daily with meals' }],
          authoredOn: '2023-09-01'
        }
      },
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-3',
          medicationCodeableConcept: { coding: [{ display: 'Atorvastatin 20mg Tablet' }] },
          status: 'active',
          dosageInstruction: [{ text: 'Take 1 tablet by mouth at bedtime' }],
          authoredOn: '2024-02-20'
        }
      }
    ]
  }
};

// ============================================
// PKCE Helper Functions (Required by Cerner)
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

function extractOperationOutcomeDiagnostics(operationOutcome) {
  try {
    if (!operationOutcome || operationOutcome.resourceType !== 'OperationOutcome') {
      return null;
    }
    const issues = Array.isArray(operationOutcome.issue) ? operationOutcome.issue : [];
    const diags = issues
      .map(i => i?.diagnostics || i?.details?.text)
      .filter(Boolean);
    return diags.length ? diags : null;
  } catch {
    return null;
  }
}

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

function setLastEpicTrace(req, key, trace) {
  req.session.lastEpicTrace = {
    ...(req.session.lastEpicTrace || {}),
    [key]: {
      at: new Date().toISOString(),
      ...trace
    }
  };
}

// ============================================
// SMART Configuration Discovery
// ============================================

async function getSmartConfiguration(fhirBaseUrl) {
  try {
    // Try .well-known endpoint first (SMART STU2)
    const response = await axios.get(`${fhirBaseUrl}/.well-known/smart-configuration`);
    return response.data;
  } catch (error) {
    // Fallback to metadata endpoint
    const metadataResponse = await axios.get(`${fhirBaseUrl}/metadata`);
    const security = metadataResponse.data.rest?.[0]?.security;
    const oauthExtension = security?.extension?.find(
      ext => ext.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
    );
    
    if (oauthExtension) {
      const authorize = oauthExtension.extension.find(e => e.url === 'authorize')?.valueUri;
      const token = oauthExtension.extension.find(e => e.url === 'token')?.valueUri;
      return {
        authorization_endpoint: authorize,
        token_endpoint: token
      };
    }
    throw new Error('Could not find SMART configuration');
  }
}

// ============================================
// Routes
// ============================================

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint (for deployment platforms)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: DEMO_MODE ? 'demo' : 'live', timestamp: new Date().toISOString() });
});

// API: Get current mode
app.get('/api/mode', (req, res) => {
  res.json({ demoMode: DEMO_MODE });
});

// Demo mode: Skip OAuth and go straight to dashboard
app.get('/demo', (req, res) => {
  req.session.accessToken = 'demo-token';
  req.session.patientId = 'demo-patient-001';
  req.session.fhirBaseUrl = 'https://fhir.epic.com (Demo Mode)';
  req.session.demoMode = true;
  res.redirect('/dashboard');
});

// Step 1: Start the authorization flow
app.get('/launch', async (req, res) => {
  try {
    const fhirBaseUrl = process.env.FHIR_BASE_URL;
    
    // Discover SMART endpoints
    const smartConfig = await getSmartConfiguration(fhirBaseUrl);
    
    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const nonce = generateState();
    
    // Store in session for later verification
    req.session.codeVerifier = codeVerifier;
    req.session.state = state;
    req.session.nonce = nonce;
    req.session.fhirBaseUrl = fhirBaseUrl;
    req.session.tokenEndpoint = smartConfig.token_endpoint;
    
    // Build authorization URL
    const authUrl = new URL(smartConfig.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', process.env.CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', process.env.REDIRECT_URI);
    // Epic-compatible scopes - must match what you registered in Epic portal.
    // Note: `launch/patient` is typically required to receive `patient` context in the token response.
    const smartScopes = process.env.SMART_SCOPES ||
      'launch/patient openid fhirUser patient/Patient.read patient/Observation.read patient/Condition.read patient/MedicationRequest.read';
    authUrl.searchParams.set('scope', smartScopes);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('aud', fhirBaseUrl);
    
    // PKCE parameters (required for public clients)
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    
    console.log('Redirecting to:', authUrl.toString());
    res.redirect(authUrl.toString());
    
  } catch (error) {
    console.error('Launch error:', error.message);
    res.status(500).json({ error: 'Failed to start authorization', details: error.message });
  }
});

// Step 2: Handle the callback from Cerner
app.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    // Check for errors from authorization server
    if (error) {
      return res.status(400).json({ 
        error, 
        error_description,
        hint: 'Authorization was denied or failed'
      });
    }
    
    // Verify state to prevent CSRF
    if (state !== req.session.state) {
      return res.status(400).json({ error: 'State mismatch - possible CSRF attack' });
    }
    
    // Exchange authorization code for tokens
    const tokenResponse = await axios.post(
      req.session.tokenEndpoint,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.REDIRECT_URI,
        client_id: process.env.CLIENT_ID,
        code_verifier: req.session.codeVerifier // PKCE verification
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    // Store tokens in session
    req.session.accessToken = tokenResponse.data.access_token;
    req.session.refreshToken = tokenResponse.data.refresh_token;
    req.session.patientId = tokenResponse.data.patient; // Patient context from launch
    req.session.expiresIn = tokenResponse.data.expires_in;
    req.session.tokenType = tokenResponse.data.token_type;
    req.session.grantedScope = tokenResponse.data.scope;
    req.session.lastEpicErrors = null;
    req.session.lastEpicTrace = null;
    
    console.log('Token received! Patient ID:', req.session.patientId);
    
    // Redirect to dashboard
    res.redirect('/dashboard');
    
  } catch (error) {
    console.error('Callback error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Token exchange failed', 
      details: error.response?.data || error.message 
    });
  }
});

// Dashboard page
app.get('/dashboard', (req, res) => {
  if (!req.session.accessToken) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API: Get current session info
app.get('/api/session', (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    patientId: req.session.patientId,
    fhirBaseUrl: req.session.fhirBaseUrl,
    expiresIn: req.session.expiresIn,
    authenticated: true,
    demoMode: req.session.demoMode || false,
    grantedScope: req.session.grantedScope || null
  });
});

// Debug: Show last Epic API errors (safe: does not include tokens)
app.get('/api/debug/epic', (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    patientId: req.session.patientId,
    fhirBaseUrl: req.session.fhirBaseUrl,
    grantedScope: req.session.grantedScope || null,
    clientId: maskClientId(process.env.CLIENT_ID),
    lastEpicErrors: req.session.lastEpicErrors || null,
    lastEpicTrace: req.session.lastEpicTrace || null
  });
});

// Debug: return a sanitized snapshot of Observation resources so UI parsing can be fixed.
// Safe: no access tokens, no patient identifiers beyond the resource content Epic returns.
app.get('/api/debug/observations/sample', async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.session.demoMode) {
      const entries = DEMO_DATA.observations?.entry || [];
      return res.json({
        mode: 'demo',
        count: entries.length,
        samples: entries.slice(0, 5).map(e => e.resource)
      });
    }

    const categories = (process.env.OBSERVATION_CATEGORIES || 'laboratory,vital-signs')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const samples = [];
    for (const category of categories) {
      try {
        const response = await axios.get(`${req.session.fhirBaseUrl}/Observation`, {
          params: {
            patient: req.session.patientId,
            category,
            _count: 5
          },
          headers: {
            'Authorization': `Bearer ${req.session.accessToken}`,
            'Accept': 'application/fhir+json'
          }
        });

        const entries = response.data?.entry || [];
        for (let i = 0; i < Math.min(entries.length, 5); i++) {
          const entry = entries[i];
          const obs = entry?.resource;
          
          samples.push({
            category,
            bundleIndex: i,
            entryKeys: entry ? Object.keys(entry) : [],
            entryFullUrl: entry?.fullUrl || null,
            resourceType: obs?.resourceType || null,
            resourceKeys: obs ? Object.keys(obs) : [],
            resourceIsEmpty: obs ? Object.keys(obs).length === 0 : true,
            // Standard fields
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
            // Full resource snippet for debugging (first 500 chars)
            resourceSnippet: obs ? JSON.stringify(obs).slice(0, 500) : null
          });
        }
      } catch (e) {
        samples.push({
          category,
          errorStatus: e?.response?.status || null,
          operationOutcome: e?.response?.data?.resourceType === 'OperationOutcome' ? e.response.data : null
        });
      }
    }

    res.json({
      mode: 'live',
      fhirBaseUrl: req.session.fhirBaseUrl,
      patientId: req.session.patientId,
      count: samples.length,
      samples
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to build observation sample', details: error.message });
  }
});

// API: Get Patient resource
app.get('/api/patient', async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Demo mode returns sample data
    if (req.session.demoMode) {
      return res.json(DEMO_DATA.patient);
    }
    
    const response = await axios.get(
      `${req.session.fhirBaseUrl}/Patient/${req.session.patientId}`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`,
          'Accept': 'application/fhir+json'
        }
      }
    );
    
    res.json(response.data);
    
  } catch (error) {
    console.error('Patient fetch error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch patient',
      details: error.response?.data || error.message
    });
  }
});

// API: Get Observations (Lab Results, Vitals)
app.get('/api/observations', async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Demo mode returns sample data
    if (req.session.demoMode) {
      return res.json(DEMO_DATA.observations);
    }
    
    // Try to fetch observations - Epic requires category parameter.
    // Note: Epic also enforces per-app API entitlement by "Observation - <type>".
    const categories = (process.env.OBSERVATION_CATEGORIES || 'laboratory,vital-signs')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    let observations = [];
    const categoryErrors = [];
    
    for (const category of categories) {
      try {
        const url = `${req.session.fhirBaseUrl}/Observation`;
        const params = {
          patient: req.session.patientId,
          category: category,
          _count: 10
        };
        const response = await axios.get(url, {
          params,
          headers: {
            'Authorization': `Bearer ${req.session.accessToken}`,
            'Accept': 'application/fhir+json'
          }
        });
        
        // Filter out OperationOutcome entries (Epic warnings) and only keep real Observations
        if (response.data.entry) {
          const realObservations = response.data.entry.filter(e => e.resource?.resourceType === 'Observation');
          observations = observations.concat(realObservations);
          
          // Track OperationOutcome warnings for better error reporting
          const outcomeWarnings = response.data.entry
            .filter(e => e.resource?.resourceType === 'OperationOutcome')
            .flatMap(e => extractOperationOutcomeDiagnostics(e.resource) || []);
          
          if (outcomeWarnings.length) {
            categoryErrors.push({
              category,
              status: 200,
              diagnostics: outcomeWarnings
            });
          }
        }

        setLastEpicTrace(req, `observations:${category}`, {
          request: { method: 'GET', url, params },
          response: {
            status: response.status,
            headers: pickSafeResponseHeaders(response.headers),
            bundleTotal: response.data?.total ?? null,
            entryCount: Array.isArray(response.data?.entry) ? response.data.entry.length : 0
          }
        });
      } catch (catError) {
        const status = catError?.response?.status || null;
        const data = catError?.response?.data;
        const diags = extractOperationOutcomeDiagnostics(data);
        categoryErrors.push({
          category,
          status,
          diagnostics: diags
        });

        setLastEpicTrace(req, `observations:${category}`, {
          request: {
            method: 'GET',
            url: `${req.session.fhirBaseUrl}/Observation`,
            params: {
              patient: req.session.patientId,
              category: category,
              _count: 10
            }
          },
          response: {
            status,
            headers: pickSafeResponseHeaders(catError?.response?.headers),
            operationOutcome: data?.resourceType === 'OperationOutcome' ? data : null
          }
        });
      }
    }

    // Store debug info in session (safe: no secrets)
    req.session.lastEpicErrors = {
      ...(req.session.lastEpicErrors || {}),
      observations: {
        attemptedCategories: categories,
        categoryErrors
      }
    };
    
    // Return as a bundle
    let note = null;
    if (observations.length === 0) {
      const allDiagnostics = categoryErrors.flatMap(e => (Array.isArray(e.diagnostics) ? e.diagnostics : []));
      const missingTargets = extractNotAuthorizedTargets(allDiagnostics);

      if (missingTargets.length) {
        note = `No observations available. Epic app is not authorized for: ${missingTargets.join(', ')}. Go to https://fhir.epic.com/Developer/Apps, edit your app (client ID: ${maskClientId(process.env.CLIENT_ID)}), enable these APIs under "Application APIs", save, then re-launch here.`;
      } else {
        const denied = categoryErrors
          .filter(e => e.status === 401 || e.status === 403 || e.status === 400 || e.status === 200)
          .map(e => {
            const firstDiag = Array.isArray(e.diagnostics) ? e.diagnostics[0] : null;
            return firstDiag ? `${e.category}: ${firstDiag}` : `${e.category}: not authorized`;
          });

        note = denied.length
          ? `No observations available. Epic is blocking specific sub-resources even though you have patient/Observation.read scope. Enable "Observation - Labs" and "Observation - Vital Signs" APIs in your Epic app registration at https://fhir.epic.com/Developer/Apps (client ID: ${maskClientId(process.env.CLIENT_ID)}), save, then re-launch.`
          : 'No observations available. Your Epic app may need additional API permissions enabled.';
      }
    }
    res.json({
      resourceType: 'Bundle',
      type: 'searchset',
      entry: observations,
      total: observations.length,
      note
    });
    
  } catch (error) {
    console.error('Observations fetch error:', error.response?.data || error.message);
    req.session.lastEpicErrors = {
      ...(req.session.lastEpicErrors || {}),
      observations: {
        errorStatus: error?.response?.status || null,
        diagnostics: extractOperationOutcomeDiagnostics(error?.response?.data)
      }
    };
    // Return empty bundle instead of error for better UX
    res.json({
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
      total: 0,
      note: 'Observations not available. Check /api/debug/epic for the exact Epic denial message, then enable the matching Observation APIs in your Epic app registration.'
    });
  }
});

// Debug: Show raw medication and condition samples to diagnose Unknown entries
app.get('/api/debug/medications/sample', async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const response = await axios.get(`${req.session.fhirBaseUrl}/MedicationRequest`, {
      params: { patient: req.session.patientId, _count: 20 },
      headers: { 'Authorization': `Bearer ${req.session.accessToken}`, 'Accept': 'application/fhir+json' }
    });
    const entries = response.data?.entry || [];
    const samples = entries.map((e, i) => {
      const med = e.resource;
      return {
        index: i,
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
    });
    res.json({ count: samples.length, samples });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/debug/conditions/sample', async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const response = await axios.get(`${req.session.fhirBaseUrl}/Condition`, {
      params: { patient: req.session.patientId, _count: 20 },
      headers: { 'Authorization': `Bearer ${req.session.accessToken}`, 'Accept': 'application/fhir+json' }
    });
    const entries = response.data?.entry || [];
    const samples = entries.map((e, i) => {
      const cond = e.resource;
      return {
        index: i,
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
    });
    res.json({ count: samples.length, samples });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get Conditions (Diagnoses)
app.get('/api/conditions', async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Demo mode returns sample data
    if (req.session.demoMode) {
      return res.json(DEMO_DATA.conditions);
    }
    
    const response = await axios.get(
      `${req.session.fhirBaseUrl}/Condition`,
      {
        params: {
          patient: req.session.patientId,
          _count: 20
        },
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`,
          'Accept': 'application/fhir+json'
        }
      }
    );
    
    // Filter out OperationOutcome entries (warnings) like we do for observations
    const entries = response.data?.entry || [];
    const realConditions = entries.filter(e => e.resource?.resourceType === 'Condition');
    
    res.json({
      ...response.data,
      entry: realConditions,
      total: realConditions.length
    });
    
  } catch (error) {
    console.error('Conditions fetch error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch conditions',
      details: error.response?.data || error.message
    });
  }
});

// API: Get Medications
app.get('/api/medications', async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Demo mode returns sample data
    if (req.session.demoMode) {
      return res.json(DEMO_DATA.medications);
    }

    const url = `${req.session.fhirBaseUrl}/MedicationRequest`;
    const params = {
      patient: req.session.patientId,
      _count: 20
    };
    const response = await axios.get(url, {
      params,
      headers: {
        'Authorization': `Bearer ${req.session.accessToken}`,
        'Accept': 'application/fhir+json'
      }
    });
    
    // Filter out OperationOutcome entries (warnings) like we do for observations/conditions
    const entries = response.data?.entry || [];
    const realMedications = entries.filter(e => e.resource?.resourceType === 'MedicationRequest');
    
    req.session.lastEpicErrors = {
      ...(req.session.lastEpicErrors || {}),
      medications: null
    };

    setLastEpicTrace(req, 'medications', {
      request: { method: 'GET', url, params },
      response: {
        status: response.status,
        headers: pickSafeResponseHeaders(response.headers),
        bundleTotal: response.data?.total ?? null,
        entryCount: realMedications.length
      }
    });
    
    res.json({
      ...response.data,
      entry: realMedications,
      total: realMedications.length
    });
    
  } catch (error) {
    console.error('Medications fetch error:', error.response?.data || error.message);
    const diagnostics = extractOperationOutcomeDiagnostics(error?.response?.data);
    const missingTargets = extractNotAuthorizedTargets(diagnostics || []);
    setLastEpicTrace(req, 'medications', {
      request: {
        method: 'GET',
        url: `${req.session.fhirBaseUrl}/MedicationRequest`,
        params: {
          patient: req.session.patientId,
          _count: 20
        }
      },
      response: {
        status: error?.response?.status || null,
        headers: pickSafeResponseHeaders(error?.response?.headers),
        operationOutcome: error?.response?.data?.resourceType === 'OperationOutcome' ? error.response.data : null
      }
    });
    req.session.lastEpicErrors = {
      ...(req.session.lastEpicErrors || {}),
      medications: {
        errorStatus: error?.response?.status || null,
        diagnostics
      }
    };
    // Return empty bundle instead of error
    res.json({
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [],
      total: 0,
      note: missingTargets.length
        ? `Medications not available. Epic app is not authorized for: ${missingTargets.join(', ')}. Enable those APIs in the Epic developer portal, then re-launch to get a fresh token.`
        : 'Medications not available. Check /api/debug/epic for the exact Epic denial message, then enable the matching MedicationRequest APIs in your Epic app registration.'
    });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           SMART on FHIR App for Epic Sandbox                  ║
╠═══════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                     ║
║                                                               ║
║  Before using:                                                ║
║  1. Register app at https://fhir.epic.com                     ║
║  2. Copy .env.example to .env                                 ║
║  3. Add your CLIENT_ID to .env                                ║
║                                                               ║
║  Redirect URI to register: http://localhost:${PORT}/callback     ║
║                                                               ║
║  Test credentials:                                            ║
║  - Username: fhirjason  Password: epicepic1                   ║
║  - Username: fhircamila Password: epicepic1                   ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
