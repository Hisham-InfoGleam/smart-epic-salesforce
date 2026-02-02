# Salesforce + Epic FHIR Integration

This directory contains Salesforce components for integrating with Epic's FHIR R4 API.

## 🏗️ Architecture

```
┌─────────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│  Salesforce LWC     │      │  Apex Services       │      │  Epic FHIR API  │
│  - Connectivity     │─────▶│  - Connection Check  │─────▶│  /metadata      │
│  - Patient Search   │      │  - Patient Service   │      │  /Patient       │
│  - Sync to CRM      │      │  (Named Credential)  │      │  /Condition     │
└─────────────────────┘      └──────────────────────┘      └─────────────────┘
                                      │
                                      ▼
                             ┌──────────────────────┐
                             │  Salesforce CRM      │
                             │  - Contact records   │
                             │  - Tasks (workflow)  │
                             │  - Health Cloud*     │
                             └──────────────────────┘
```

## 📁 Project Structure

```
salesforce/
├── force-app/main/default/
│   ├── classes/
│   │   ├── EpicConnectionController.cls        # FHIR metadata/connectivity
│   │   ├── EpicConnectionControllerTest.cls
│   │   ├── EpicPatientService.cls              # Patient search & sync
│   │   └── EpicPatientServiceTest.cls
│   ├── lwc/
│   │   ├── epicConnectivityCheck/              # Connection status UI
│   │   │   ├── epicConnectivityCheck.html
│   │   │   ├── epicConnectivityCheck.js
│   │   │   └── epicConnectivityCheck.js-meta.xml
│   │   └── epicPatientSync/                    # Patient search & sync UI
│   │       ├── epicPatientSync.html
│   │       ├── epicPatientSync.js
│   │       └── epicPatientSync.js-meta.xml
│   └── objects/Contact/fields/                 # Custom fields for Epic data
│       ├── Epic_Patient_Id__c.field-meta.xml
│       ├── Epic_MRN__c.field-meta.xml
│       └── Epic_Last_Sync__c.field-meta.xml
└── README.md
```

## 🚀 Setup Instructions

### 1. Salesforce Developer Org

1. Sign up at [Salesforce Developer Edition](https://developer.salesforce.com/signup)
2. Enable Health Cloud (if available) or use standard org

### 2. Remote Site Settings

1. Go to **Setup** → **Security** → **Remote Site Settings**
2. Add new Remote Site:
   - **Name:** `EpicFHIR`
   - **URL:** `https://fhir.epic.com`

### 3. Named Credential

1. Go to **Setup** → **Security** → **Named Credentials**
2. Create new Named Credential:
   - **Label:** `EpicFHIR`
   - **Name:** `EpicFHIR`
   - **URL:** `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`
   - **Identity Type:** Anonymous (for /metadata endpoint)
   - **Authentication Protocol:** No Authentication

### 4. Deploy to Org

Using Salesforce CLI:
```bash
cd salesforce
sfdx force:source:deploy -p force-app -u YourOrgAlias
```

### 5. Add Components to Page

1. Open **Lightning App Builder**
2. Create or edit a page
3. Add these components:
   - **Epic FHIR Connectivity Check** - Shows connection status
   - **Epic Patient Search & Sync** - Search and sync patients
4. Save and activate

## 🔄 Integration Workflow

The complete Epic → Salesforce workflow:

1. **Search** - User searches for patients in Epic by name
2. **View** - View patient details including conditions
3. **Sync** - Click "Sync to Salesforce" to create/update Contact
4. **Workflow** - Automatic Task created for care team review

```
User searches "Argonaut"
         │
         ▼
Epic FHIR API returns patient list
         │
         ▼
User clicks "Sync to Salesforce"
         │
         ▼
┌────────────────────────────────────┐
│ Apex: EpicPatientService           │
│   - Creates/updates Contact        │
│   - Maps FHIR → Salesforce fields  │
│   - Creates review Task            │
└────────────────────────────────────┘
         │
         ▼
Care coordinator sees new Task
```

## 🧪 Testing

Run Apex tests:
```bash
sfdx force:apex:test:run -c -r human -u YourOrgAlias
```

## 📊 Field Mapping

| FHIR Field | Salesforce Field | Notes |
|------------|------------------|-------|
| `Patient.id` | `Contact.Epic_Patient_Id__c` | External ID |
| `Patient.name.given` | `Contact.FirstName` | |
| `Patient.name.family` | `Contact.LastName` | |
| `Patient.birthDate` | `Contact.Birthdate` | |
| `Patient.telecom[phone]` | `Contact.Phone` | |
| `Patient.telecom[email]` | `Contact.Email` | |
| `Patient.address` | `Contact.MailingAddress` | |
| `identifier[MRN]` | `Contact.Epic_MRN__c` | Medical Record # |
| Sync timestamp | `Contact.Epic_Last_Sync__c` | Auto-populated |

## 📈 Features Complete

| Feature | Status | Description |
|---------|--------|-------------|
| Metadata endpoint check | ✅ Complete | Verify Epic connectivity |
| FHIR resource discovery | ✅ Complete | List supported resources |
| Patient search | ✅ Complete | Search by name |
| Patient details | ✅ Complete | View demographics + conditions |
| Sync to Salesforce | ✅ Complete | Create/update Contact |
| Workflow automation | ✅ Complete | Auto-create review Task |
| Custom fields | ✅ Complete | Epic ID, MRN, Last Sync |

