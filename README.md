# SMART on FHIR Demo for the Epic Sandbox

A small Node.js app that signs in to Epic's public FHIR sandbox with a SMART on FHIR standalone launch and shows a patient's data. The repo also has a Salesforce (Apex and LWC) sample for the same Epic API.

**Status: demo code.**

- The Node.js app has automated tests that use a fake Epic server. The live login against the Epic sandbox has not been tested again after the latest changes.
- The Salesforce part has not been deployed to a Salesforce org. See [Salesforce part](#salesforce-part).
- Do not use this app with real patient data.

---

## What it shows

- **SMART standalone launch** against the Epic sandbox (`fhir.epic.com`). The user starts in this app and signs in to Epic as a test patient.
- **OAuth 2.0 authorization code flow with PKCE (S256).** The app uses PKCE, a one-time `state` value, and a new session after login.
- **FHIR R4 reads:** Patient, Observation (lab results and vital signs), Condition and MedicationRequest.
- **Token handling:** the app tracks when the access token expires. It uses the refresh token when Epic gives one. If not, it asks the user to sign in again.
- **Demo mode:** sample FHIR data without an Epic account.
- **Salesforce sample:** Apex classes and Lightning Web Components that read the Epic FHIR API and sync a patient to a Contact. This is a design sample only.

---

## How it works

1. The user clicks **Connect to Epic**. The server reads Epic's SMART configuration (`.well-known/smart-configuration`, or `/metadata` as a fallback) to find the authorize and token endpoints.
2. The server makes a PKCE code verifier, its S256 code challenge, and a random `state`. It keeps the verifier and the state in the user's session.
3. The server sends the browser to Epic's authorize endpoint with `client_id`, `redirect_uri`, `scope`, `state`, `aud` (the FHIR base URL) and the code challenge.
4. The user signs in to Epic and approves the app.
5. Epic sends the browser back to `/callback` with a `code` and the `state`. The server checks that the state is present and matches. It removes the state and the verifier from the session, so they work only once.
6. The server sends the `code` and the code verifier to Epic's token endpoint. Epic checks the verifier against the challenge and returns an access token, the patient ID, the expiry time, and sometimes a refresh token.
7. The server starts a new session (new session ID) and keeps the tokens there. The browser only gets an HttpOnly session cookie.
8. The dashboard calls the server's `/api/*` routes. The server calls the Epic FHIR API with the access token and returns the result.

Epic needs a category for Observation searches, and it checks app access per category. So the server runs one Observation search per category (default: `laboratory` and `vital-signs`).

---

## Quick start

You need Node.js 18 or newer.

### Demo mode (no Epic account needed)

```bash
cp .env.example .env        # on Windows: copy .env.example .env
# In .env, set DEMO_MODE=true
npm install
npm start
```

Open http://localhost:3000 and click **View demo**.

In demo mode, `SESSION_SECRET` is optional. Without it, the server uses a random secret, and sessions end when the server stops.

### With the Epic sandbox

1. Create a free account at https://fhir.epic.com and register an app under **Build Apps**:
   - Audience: patients.
   - Redirect URI: `http://localhost:3000/callback`
   - APIs: the FHIR R4 read APIs for Patient, Observation (labs and vital signs), Condition and MedicationRequest.
   - Copy the **non-production** client ID.

   The labels in Epic's portal can change over time.
2. Copy `.env.example` to `.env`. Set `CLIENT_ID` and `SESSION_SECRET`. To create a secret:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Install and start:

   ```bash
   npm install
   npm start
   ```
4. Open http://localhost:3000 and click **Connect to Epic**.
5. Sign in with one of Epic's published sandbox test patients, for example Jason Argonaut. The list of test users is here: https://fhir.epic.com/Documentation?docId=testpatients

---

## Configuration

All settings are environment variables. `.env.example` lists them.

| Variable | Default | What it does |
|----------|---------|--------------|
| `DEMO_MODE` | `false` | `true` turns on `/demo` (sample data, no Epic login). |
| `SESSION_SECRET` | none | Secret for the session cookie. At least 32 characters. Required when `DEMO_MODE` is not `true`. The server does not start without it. |
| `CLIENT_ID` | none | Non-production client ID of your Epic sandbox app. Needed for the Epic login. |
| `REDIRECT_URI` | none | Must match a redirect URI registered in Epic, for example `http://localhost:3000/callback`. |
| `FHIR_BASE_URL` | none | FHIR R4 base URL. For the Epic sandbox: `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4` |
| `SMART_SCOPES` | see `.env.example` | Scopes requested at login. They must match the APIs enabled for your Epic app. `launch/patient` asks Epic for the patient ID. |
| `OBSERVATION_CATEGORIES` | `laboratory,vital-signs` | Observation categories to search, separated by commas. |
| `PORT` | `3000` | Port of the local server. |
| `DEBUG` | `false` | `true` turns on the `/api/debug/*` routes. For local testing only. |
| `NODE_ENV` | not set | `production` sends the session cookie over HTTPS only and adds the CSP `upgrade-insecure-requests` rule. |
| `TRUST_PROXY` | not set | `1` tells Express to trust one reverse proxy (needed for secure cookies when a proxy ends HTTPS). |

### Routes

| Route | What it does |
|-------|--------------|
| `GET /` | Start page |
| `GET /launch` | Starts the Epic login |
| `GET /callback` | Epic redirects here after login |
| `GET /demo` | Demo session with sample data (only when `DEMO_MODE=true`) |
| `GET /dashboard` | Patient dashboard (needs a session) |
| `GET /api/session` | Session info: patient ID, FHIR server, granted scopes |
| `GET /api/patient`, `/api/observations`, `/api/conditions`, `/api/medications` | FHIR data for the dashboard |
| `GET /api/debug/*` | Debug data (only when `DEBUG=true`) |
| `POST /logout` | Ends the session |
| `GET /health`, `GET /api/mode` | Health check and current mode |

---

## Tests

```bash
npm test
```

The tests use Node's built-in test runner. They do not call Epic. A small fake Epic server stands in for it. The tests cover:

- the OAuth flow: PKCE challenge and verifier, `state` check, one-time use of the `state`, new session ID after login, token refresh, and a token without patient context
- demo mode, the debug switch, and logout by POST
- the Content Security Policy header, and that the pages have no inline scripts or styles
- HTML escaping of FHIR text
- that logs contain no tokens, authorization codes or patient IDs

---

## Security notes

This is a demo. Check these points before you reuse the code.

- **Session store:** the app uses the default express-session MemoryStore. It is for demos only: it loses sessions on restart and does not work with more than one server process. Use a real session store for anything else.
- **HTTPS:** run behind HTTPS and set `NODE_ENV=production`, so the session cookie is sent over HTTPS only. Set `TRUST_PROXY=1` when a reverse proxy ends HTTPS.
- **Session cookie:** HttpOnly and SameSite=Lax. There are no CSRF tokens. The app relies on SameSite=Lax, and logout is a POST.
- **Tokens:** they stay in the server-side session and are never sent to the browser. They are kept in memory and are not encrypted.
- **id_token:** Epic returns one for the `openid` scope. The app does not use it and does not validate it.
- **Debug routes:** off by default. Do not set `DEBUG=true` on a shared server. These routes show raw Epic data.
- **Browser side:** a strict Content Security Policy allows scripts and styles from this server only. All FHIR text is escaped before it is shown.
- **Logs and errors:** the server does not log tokens or patient IDs. The browser gets generic error messages. The details are in the server log.
- **Not included:** rate limiting, audit logging, and any compliance review (for example HIPAA).

---

## Salesforce part

The `salesforce/` folder has a Salesforce DX project with:

- Apex classes that read the Epic FHIR API through a Named Credential (`EpicFHIR`), and sync a patient to a Contact
- Apex unit tests with mock HTTP responses
- two Lightning Web Components: a connectivity check, and a patient search and sync card
- three custom Contact fields for the Epic patient ID, MRN and last sync time

**Status:** the Salesforce code has not been deployed to a Salesforce org yet, and the Apex tests have not been run.

**What is missing:** the connectivity check calls `/metadata`, which needs no login. Patient search and sync need an OAuth token from Epic Backend Services (a JWT signed by the client, with the client credentials grant). That OAuth setup is not built or tested here.

See [salesforce/README.md](salesforce/README.md) for the details.

---

## Project layout

| Path | What it is |
|------|------------|
| `server.js` | Express app: SMART launch, OAuth callback, token handling, FHIR API routes |
| `lib/demo-data.js` | Sample FHIR resources for demo mode |
| `public/index.html` | Start page |
| `public/dashboard.html` | Patient dashboard |
| `public/css/` | Styles for the two pages |
| `public/js/index.js` | Start page script (shows the demo button in demo mode) |
| `public/js/dashboard.js` | Dashboard script (loads and shows the FHIR data) |
| `public/js/escape-html.js` | HTML escaping helper |
| `test/server.test.js` | Tests (`npm test`) |
| `salesforce/` | Salesforce sample, see [salesforce/README.md](salesforce/README.md) |
| `.env.example` | Example settings |
| `LICENSE` | MIT license |

---

## Troubleshooting

| Problem | What to check |
|---------|---------------|
| The server does not start: "SESSION_SECRET must be ..." | Set `SESSION_SECRET` in `.env`, or set `DEMO_MODE=true`. |
| Epic says the client ID is invalid | Use the non-production client ID, with no extra spaces. |
| Epic says the redirect URI does not match | The `REDIRECT_URI` in `.env` must be exactly the one registered in Epic (check `http` and the trailing slash). |
| "Epic did not return a patient for this login" | Keep `launch/patient` in `SMART_SCOPES`, and allow it for your Epic app. |
| No observations or medications | Enable the matching APIs for your app in Epic (for example "Observation - Labs" and "Observation - Vital Signs"), then connect again. Run with `DEBUG=true` and open `/api/debug/epic` to see Epic's message. |

---

## Links

- [Epic on FHIR](https://fhir.epic.com): Epic's developer portal and sandbox
- [SMART App Launch](https://hl7.org/fhir/smart-app-launch/): the SMART on FHIR specification
- [FHIR R4](https://hl7.org/fhir/R4/): the FHIR specification

---

## License

MIT. See [LICENSE](LICENSE).

## Author

Hisham Alrashdan, InfoGleam

- Website: https://infogleam.com
- Email: hisham@infogleam.com
- GitHub: https://github.com/Hisham-InfoGleam
