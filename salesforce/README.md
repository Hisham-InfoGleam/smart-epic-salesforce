# Salesforce Sample: Epic FHIR to Salesforce

Apex classes and Lightning Web Components (LWC) that read Epic's FHIR R4 API and sync a patient to a Salesforce Contact.

**Status: demo code.**

- The Salesforce code has not been deployed to a Salesforce org yet.
- The Apex tests have not been run, so the code coverage is not known.
- The code was checked by reading it only. It has not been compiled.
- Patient search and sync need Epic Backend Services OAuth. That is not set up in this repo (see [Authentication](#authentication)).

---

## What is here

| Item | Type | What it does |
|------|------|--------------|
| `EpicConnectionController` | Apex | Reads Epic's `/metadata` (CapabilityStatement): FHIR version, supported resources, OAuth endpoints |
| `EpicPatientService` | Apex | Searches patients by name, reads one patient and their conditions, syncs a patient to a Contact, creates a review Task for a new patient |
| `EpicConnectionControllerTest`, `EpicPatientServiceTest` | Apex tests | Unit tests with mock HTTP responses (no call to Epic) |
| `epicConnectivityCheck` | LWC | Card that shows the connection status and the supported FHIR resources |
| `epicPatientSync` | LWC | Card to search Epic patients, view one patient, and sync the patient to Salesforce |
| `Epic_Patient_Id__c`, `Epic_MRN__c`, `Epic_Last_Sync__c` | Contact fields | Epic patient ID (unique external ID), medical record number, last sync time |

How the parts connect:

1. The LWC calls an Apex method.
2. Apex calls the Epic FHIR API through the Named Credential `EpicFHIR` (`callout:EpicFHIR/...`). No URL or secret is stored in the code.
3. On sync, Apex creates or updates a Contact (matched by `Epic_Patient_Id__c`). For a new Contact, it also creates a Task so the care team reviews the patient.

---

## Authentication

| Call | Needs a login? | State in this repo |
|------|----------------|--------------------|
| `GET /metadata` (connectivity check) | No | A Named Credential with no authentication is enough. |
| `GET /Patient`, `GET /Patient/{id}`, `GET /Condition` (search and sync) | Yes, an OAuth access token | **Not set up.** Without it, Epic answers HTTP 401. The search then shows no results. |

For a server-to-server call like this one, Epic offers **Backend Services**: the client signs a JWT with its private key and gets an access token with the OAuth client credentials grant. A possible setup (not built and not tested here):

1. Register a backend app at https://fhir.epic.com, add its public key, and enable the Patient and Condition APIs.
2. In Salesforce, create an External Credential that gets the token with a signed JWT (client credentials with a JWT assertion). Give users access to it with a permission set.
3. Link the `EpicFHIR` Named Credential to that External Credential.
4. Check that Epic accepts the JWT that Salesforce builds (signing algorithm and claims). If it does not, the JWT can be built and signed in Apex instead.

Check the current Epic and Salesforce documentation for the exact steps.

---

## Setup outline

These steps are for a Salesforce developer org. They have not been run for this repo yet.

1. Install the Salesforce CLI (`sf`) and log in:

   ```bash
   sf org login web --alias my-dev-org
   ```
2. Deploy the source. Run the command in the `salesforce` folder, because `sfdx-project.json` is there:

   ```bash
   cd salesforce
   sf project deploy start --source-dir force-app --target-org my-dev-org
   ```
3. In Setup, create a Named Credential called `EpicFHIR` with the URL `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`. For the connectivity check alone, it needs no authentication. All callouts use this Named Credential, so no Remote Site Setting is needed.
4. Add **Epic FHIR Connectivity Check** and **Epic Patient Search and Sync** to a page with Lightning App Builder. On App, Record and Home pages, you can set the card title of the patient search card.
5. Run the Apex tests:

   ```bash
   sf apex run test --test-level RunLocalTests --code-coverage --result-format human --wait 10 --target-org my-dev-org
   ```

---

## Field mapping (FHIR Patient to Contact)

| FHIR Patient | Contact field | Notes |
|--------------|---------------|-------|
| `id` | `Epic_Patient_Id__c` | Unique external ID, used to find an existing Contact |
| `name[0].given[0]` | `FirstName` | |
| `name[0].family` | `LastName` | |
| `birthDate` | `Birthdate` | Full dates only. A partial date (`YYYY` or `YYYY-MM`) leaves the field empty. |
| `telecom` (system `phone`) | `Phone` | |
| `telecom` (system `email`) | `Email` | |
| `address[0].line[0]` | `MailingStreet` | |
| `address[0].city` | `MailingCity` | |
| `address[0].state` | `MailingState` | See the known gaps |
| `address[0].postalCode` | `MailingPostalCode` | |
| `identifier` with type code `MR` | `Epic_MRN__c` | Medical record number |
| time of the sync | `Epic_Last_Sync__c` | |

---

## Known gaps

- Epic Backend Services OAuth is not built (see [Authentication](#authentication)).
- Not deployed, not compiled, and the tests have not been run.
- The country is not mapped. Orgs with State and Country/Territory Picklists turned on may reject a state without a country.
- Some error messages are not clear yet. For example, an HTTP error during patient search gives an empty result instead of an error.
- It uses the standard Contact and Task objects, not Health Cloud objects.
- Sync is one patient at a time, started from the UI. There is no bulk or scheduled sync.

---

## License and author

MIT, see [LICENSE](../LICENSE). Hisham Alrashdan, InfoGleam (https://infogleam.com, hisham@infogleam.com).
