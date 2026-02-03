# 🏥 Epic FHIR Integration POC

A comprehensive Proof of Concept demonstrating **two integration patterns** with Epic's FHIR R4 API:

1. **Node.js SMART on FHIR App** - Patient-facing portal with OAuth2 + PKCE
2. **Salesforce Health Cloud Integration** - Enterprise EHR connectivity via LWC + Apex

> 🎯 **Portfolio Project** showcasing HealthTech interoperability skills for enterprise clients

---

## 🏗️ Architecture Overview

```
                              ┌─────────────────────────────────────┐
                              │         Epic FHIR R4 API            │
                              │   fhir.epic.com/interconnect-...    │
                              └──────────────┬──────────────────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
                    ▼                        ▼                        ▼
        ┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
        │   /metadata       │    │   OAuth2 + PKCE   │    │   FHIR Resources  │
        │   (No Auth)       │    │   Authorization   │    │   Patient, Obs... │
        └─────────┬─────────┘    └─────────┬─────────┘    └─────────┬─────────┘
                  │                        │                        │
    ┌─────────────┴─────────────┐          │                        │
    │                           │          │                        │
    ▼                           ▼          ▼                        ▼
┌─────────┐              ┌─────────────────────────────────────────────┐
│Salesforce│              │         Node.js SMART App                  │
│Health   │              │         (server.js + public/)              │
│Cloud    │              └─────────────────────────────────────────────┘
└─────────┘
```

---

## 📂 Project Structure

```
smart-epic-salesforce/
├── server.js                    # Node.js SMART on FHIR backend
├── public/
│   ├── index.html               # Launch page
│   └── dashboard.html           # Patient data display
├── salesforce/                  # Salesforce integration
│   ├── README.md                # Salesforce-specific setup
│   └── force-app/main/default/
│       ├── classes/
│       │   ├── EpicConnectionController.cls
│       │   └── EpicConnectionControllerTest.cls
│       └── lwc/epicConnectivityCheck/
│           ├── epicConnectivityCheck.html
│           ├── epicConnectivityCheck.js
│           └── epicConnectivityCheck.js-meta.xml
└── .env                         # Configuration (not in repo)
```

---

## 🚀 Part 1: Node.js SMART on FHIR App

### Features

- **OAuth 2.0 with PKCE** - Secure authentication required by Epic
- **Standalone Launch** - Patient portal style login
- **FHIR R4 API** - Query patient data using standard FHIR resources
- **Beautiful Dashboard** - Display patient health information

### Quick Start

### Step 1: Register Your App on Epic (5 minutes)

1. Go to **https://fhir.epic.com**
2. Click **"Sign Up"** and create a free developer account
3. After login, click **"Build Apps"** → **"Create"**
4. Fill in the application details:

| Field | Value |
|-------|-------|
| **Application Name** | Patient Health Viewer |
| **Application Audience** | Patients |
| **Incoming APIs** | Select all Patient-related APIs |

5. Under **"Redirect URIs"**, add:
   ```
   http://localhost:3000/callback
   ```

6. Under **"SMART on FHIR Version"**, select:
   - **SMART on FHIR version**: R4
   - **Can use PKCE**: Yes (required)

7. Click **"Save & Ready for Sandbox"**

8. Copy your **Non-Production Client ID** (NOT Production)

---

### Step 2: Configure the App

```bash
# Navigate to app folder
cd smart-epic-salesforce

# Edit .env file and add your Client ID
notepad .env
```

Update the `CLIENT_ID` line:
```env
CLIENT_ID=paste-your-non-production-client-id-here
```

---

### Step 3: Install and Run

```bash
# Install dependencies
npm install

# Start the server
npm start
```

---

### Step 4: Test the App

1. Open **http://localhost:3000** in your browser
2. Click **"Connect to Epic"**
3. You'll see Epic's MyChart login screen
4. Login with Epic sandbox test credentials:

| Username | Password | Patient Type |
|----------|----------|--------------|
| `fhirjason` | `epicepic1` | Adult male with conditions |
| `fhircamila` | `epicepic1` | Adult female |
| `fhirderrick` | `epicepic1` | Adult with medications |
| `fhiremma` | `epicepic1` | Pediatric patient |

5. Authorize the app when prompted
6. View the patient dashboard with real Epic test data!

---

## 📁 Project Structure

See **Architecture Overview** section at the top for the full project structure.

---

## 📦 Part 2: Salesforce Health Cloud Integration

> ⚠️ **Development Status: Work in Progress**
>
> The Salesforce integration is currently in early development and has **not been tested** in a live Salesforce environment. This code is provided as a reference implementation only and is **not suitable for production use**. Full testing, validation, and additional features are planned for future releases.

This demonstrates **enterprise-grade** connectivity between Salesforce and Epic using Named Credentials (no secrets in code).

### Why This Approach?

| Aspect | Benefit |
|--------|---------|
| **Named Credentials** | Secrets managed by Salesforce, not in code |
| **`/metadata` Endpoint** | Proves connectivity without PHI |
| **Capability Discovery** | Shows understanding of FHIR architecture |

### Quick Start

1. **Get Salesforce Dev Org**: [developer.salesforce.com/signup](https://developer.salesforce.com/signup)

2. **Configure Remote Site Settings**:
   - Setup → Security → Remote Site Settings
   - Add `https://fhir.epic.com`

3. **Create Named Credential**:
   - Setup → Security → Named Credentials
   - URL: `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`

4. **Deploy Code**:
   ```bash
   cd salesforce
   sfdx force:source:deploy -p force-app -u YourOrgAlias
   ```

5. **Add LWC to Page**: Use Lightning App Builder to add the component

See [salesforce/README.md](salesforce/README.md) for detailed setup.

---

## �🔐 OAuth + PKCE Flow (Required by Epic)

```
┌──────────────┐     ┌─────────────────┐     ┌───────────────┐
│  Your App    │     │  Epic Auth      │     │  Epic FHIR    │
│  (localhost) │     │  Server         │     │  Server       │
└──────┬───────┘     └────────┬────────┘     └───────┬───────┘
       │                      │                      │
       │ 1. Generate PKCE:    │                      │
       │    code_verifier     │                      │
       │    code_challenge    │                      │
       │                      │                      │
       │ 2. Authorization request + code_challenge   │
       │──────────────────────>                      │
       │                      │                      │
       │ 3. Epic MyChart      │                      │
       │    Login Screen      │                      │
       │<──────────────────────                      │
       │                      │                      │
       │ 4. User logs in      │                      │
       │──────────────────────>                      │
       │                      │                      │
       │ 5. Authorization code│                      │
       │<──────────────────────                      │
       │                      │                      │
       │ 6. Token request     │                      │
       │    + code_verifier   │ (Epic verifies PKCE) │
       │──────────────────────>                      │
       │                      │                      │
       │ 7. Access token      │                      │
       │<──────────────────────                      │
       │                      │                      │
       │ 8. FHIR API requests (with Bearer token)    │
       │─────────────────────────────────────────────>
       │                      │                      │
       │ 9. Patient data                             │
       │<─────────────────────────────────────────────
```

### Why PKCE?

Epic requires PKCE (Proof Key for Code Exchange) since **August 2020** for all public clients. It prevents authorization code interception attacks:

```javascript
// 1. Generate random code_verifier (keep secret)
const codeVerifier = crypto.randomBytes(32).toString('base64url');

// 2. Hash it to create code_challenge (send to Epic)
const codeChallenge = crypto.createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// 3. Epic verifies: SHA256(code_verifier) === code_challenge
```

---

## 📊 FHIR Resources Demonstrated

| Resource | Description | Epic Endpoint |
|----------|-------------|---------------|
| **Patient** | Demographics, identifiers | `/Patient/{id}` |
| **Observation** | Lab results, vitals | `/Observation?patient={id}` |
| **Condition** | Diagnoses, problems | `/Condition?patient={id}` |
| **MedicationRequest** | Active prescriptions | `/MedicationRequest?patient={id}` |

---

## 🔗 Resources

- [Epic on FHIR](https://fhir.epic.com) - Official Epic developer portal
- [Epic Sandbox Docs](https://fhir.epic.com/Documentation) - API documentation
- [SMART App Launch IG](http://hl7.org/fhir/smart-app-launch/) - SMART specification
- [FHIR R4](https://hl7.org/fhir/R4/) - FHIR specification

---

## 🐛 Troubleshooting

### "Invalid client_id"
- Make sure you're using the **Non-Production Client ID** (not Production)
- Verify the Client ID is copied correctly with no extra spaces

### "Redirect URI mismatch"
- Ensure `http://localhost:3000/callback` is added in Epic's app settings
- Check there's no trailing slash difference

### "PKCE verification failed"
- This shouldn't happen with this code, but ensure you're not modifying the PKCE logic

### "Access denied" after login
- Make sure you selected the correct FHIR scopes when registering
- Try re-creating the app with all Patient-related scopes

---

## 🚧 Known Limitations & Roadmap

> **This is a Proof of Concept (POC)** demonstrating integration patterns. Review the status of each component below before use.

### Node.js App — Ready for Testing
| Feature | Status | Notes |
|---------|--------|-------|
| Demo Mode | ✅ Complete | Works out of the box with sample data |
| OAuth + PKCE Flow | ✅ Complete | Requires Epic app registration to test live |
| FHIR R4 Queries | ✅ Complete | Patient, Observations, Conditions, Medications |
| Session Management | ✅ Complete | Express sessions with secure cookies |

### Salesforce Integration — In Development
| Feature | Status | Notes |
|---------|--------|-------|
| Apex Classes | 🔶 Code Written | Not yet deployed or tested in a Salesforce org |
| LWC Components | 🔶 Code Written | Not yet deployed or tested in a Salesforce org |
| Unit Tests | 🔶 Code Written | Includes mocks, but not executed against live org |
| Named Credentials | ⚠️ Not Configured | Requires manual setup in target org |
| End-to-End Testing | ❌ Not Started | Planned for future development phase |

> **Important:** The Salesforce components are provided as reference code only. They have not been validated in a production or sandbox environment and should not be deployed to production systems without thorough testing.

### Planned for Future Releases
- Deploy and validate Salesforce components in a Developer org
- Execute Apex unit tests and achieve code coverage requirements
- Add error handling and retry logic for production resilience
- Document Named Credential setup with OAuth2 client credentials flow

---

## �📄 License

MIT License - Use freely for learning and portfolio.
