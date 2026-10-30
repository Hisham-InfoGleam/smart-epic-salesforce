/**
 * Unit tests for EpicPatientService.
 *
 * HTTP callouts are replaced by mock responses (HttpCalloutMock), so no Epic
 * server is called. The test data uses Epic's public sandbox test patient name.
 *
 * Status: written by hand, not run in a Salesforce org yet.
 *
 * @author Hisham Alrashdan (InfoGleam)
 * @date 2026
 */
@isTest
private class EpicPatientServiceTest {

    private static final String PATIENT_ID = 'test-patient-001';

    // The test address has no state. Orgs with State and Country/Territory Picklists
    // turned on reject a Contact state without a country, and these tests must run in any org.
    private static final String PATIENT_JSON =
        '{"resourceType":"Patient","id":"' + PATIENT_ID + '",' +
        '"identifier":[{"type":{"coding":[{"code":"MR"}]},"value":"MRN-12345"}],' +
        '"name":[{"family":"Argonaut","given":["Jason"]}],' +
        '"gender":"male","birthDate":"1985-08-01",' +
        '"telecom":[{"system":"phone","value":"555-555-1234"},' +
        '{"system":"email","value":"jason.argonaut@example.com"}],' +
        '"address":[{"line":["123 Main St"],"city":"Madison","postalCode":"53703"}]}';

    private static final String PATIENT_BUNDLE_JSON =
        '{"resourceType":"Bundle","type":"searchset","entry":[{"resource":' + PATIENT_JSON + '}]}';

    private static final String CONDITION_BUNDLE_JSON =
        '{"resourceType":"Bundle","type":"searchset","entry":[' +
        '{"resource":{"resourceType":"Condition","id":"cond-001",' +
        '"code":{"coding":[{"system":"http://snomed.info/sct","code":"59621000","display":"Essential Hypertension"}]},' +
        '"clinicalStatus":{"coding":[{"code":"active"}]},' +
        '"category":[{"coding":[{"display":"Problem List Item"}]}],' +
        '"onsetDateTime":"2020-03-15"}}]}';

    private static final String EMPTY_BUNDLE_JSON =
        '{"resourceType":"Bundle","type":"searchset","total":0}';

    private static final String NOT_FOUND_JSON =
        '{"resourceType":"OperationOutcome","issue":[{"severity":"error","code":"not-found"}]}';

    /**
     * Returns the same status code and body for every request.
     */
    private class StaticResponseMock implements HttpCalloutMock {
        private Integer statusCode;
        private String body;

        public StaticResponseMock(Integer statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body;
        }

        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/fhir+json');
            res.setStatusCode(statusCode);
            res.setStatus(statusCode == 200 ? 'OK' : 'Error');
            res.setBody(body);
            return res;
        }
    }

    /**
     * Acts like the Epic FHIR server for a Patient read and a Condition search.
     */
    private class EpicFhirMock implements HttpCalloutMock {
        private String patientBody;
        private String conditionBody;

        public EpicFhirMock(String patientBody, String conditionBody) {
            this.patientBody = patientBody;
            this.conditionBody = conditionBody;
        }

        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/fhir+json');
            res.setStatusCode(200);
            res.setStatus('OK');
            if (req.getEndpoint().contains('/Condition')) {
                res.setBody(conditionBody);
            } else {
                res.setBody(patientBody);
            }
            return res;
        }
    }

    @isTest
    static void searchPatientsParsesTheBundle() {
        Test.setMock(HttpCalloutMock.class, new StaticResponseMock(200, PATIENT_BUNDLE_JSON));

        Test.startTest();
        List<EpicPatientService.EpicPatient> patients = EpicPatientService.searchPatients('Argonaut');
        Test.stopTest();

        System.assertEquals(1, patients.size(), 'Should return one patient');
        EpicPatientService.EpicPatient patient = patients[0];
        System.assertEquals(PATIENT_ID, patient.epicId, 'Epic ID should match');
        System.assertEquals('Jason', patient.firstName, 'First name should match');
        System.assertEquals('Argonaut', patient.lastName, 'Last name should match');
        System.assertEquals('male', patient.gender, 'Gender should match');
        System.assertEquals('555-555-1234', patient.phone, 'Phone should come from telecom');
        System.assertEquals('jason.argonaut@example.com', patient.email, 'Email should come from telecom');
        System.assertEquals('123 Main St', patient.addressLine, 'Address line should match');
        System.assertEquals('Madison', patient.city, 'City should match');
        System.assertEquals('MRN-12345', patient.mrn, 'MRN should come from the MR identifier');
    }

    @isTest
    static void searchPatientsReturnsEmptyListForEmptyBundle() {
        Test.setMock(HttpCalloutMock.class, new StaticResponseMock(200, EMPTY_BUNDLE_JSON));

        Test.startTest();
        List<EpicPatientService.EpicPatient> patients = EpicPatientService.searchPatients('NonexistentPatient');
        Test.stopTest();

        System.assertEquals(0, patients.size(), 'Should return an empty list');
    }

    @isTest
    static void searchPatientsReturnsEmptyListOnHttpError() {
        Test.setMock(HttpCalloutMock.class, new StaticResponseMock(401, NOT_FOUND_JSON));

        Test.startTest();
        List<EpicPatientService.EpicPatient> patients = EpicPatientService.searchPatients('Argonaut');
        Test.stopTest();

        System.assertEquals(0, patients.size(), 'An HTTP error should give an empty list');
    }

    @isTest
    static void getPatientConditionsParsesTheBundle() {
        Test.setMock(HttpCalloutMock.class, new StaticResponseMock(200, CONDITION_BUNDLE_JSON));

        Test.startTest();
        List<EpicPatientService.EpicCondition> conditions = EpicPatientService.getPatientConditions(PATIENT_ID);
        Test.stopTest();

        System.assertEquals(1, conditions.size(), 'Should return one condition');
        EpicPatientService.EpicCondition condition = conditions[0];
        System.assertEquals('Essential Hypertension', condition.name, 'Condition name should match');
        System.assertEquals('active', condition.status, 'Status should be active');
        System.assertEquals('59621000', condition.code, 'Code should match');
        System.assertEquals('http://snomed.info/sct', condition.codeSystem, 'Code system should match');
        System.assertEquals('Problem List Item', condition.category, 'Category should match');
        System.assertEquals('2020-03-15', condition.onsetDate, 'Onset date should match');
    }

    @isTest
    static void getPatientConditionsReturnsEmptyListForBlankId() {
        Test.startTest();
        List<EpicPatientService.EpicCondition> conditions = EpicPatientService.getPatientConditions('');
        Test.stopTest();

        System.assertEquals(0, conditions.size(), 'A blank ID should give an empty list');
    }

    @isTest
    static void getPatientByIdIncludesConditions() {
        Test.setMock(HttpCalloutMock.class, new EpicFhirMock(PATIENT_JSON, CONDITION_BUNDLE_JSON));

        Test.startTest();
        EpicPatientService.EpicPatient patient = EpicPatientService.getPatientById(PATIENT_ID);
        Test.stopTest();

        System.assertEquals(PATIENT_ID, patient.epicId, 'Epic ID should match');
        System.assertEquals('Jason Argonaut', patient.fullName, 'Full name should be built from the name parts');
        System.assertEquals(1, patient.conditions.size(), 'Conditions should be loaded with the patient');
    }

    @isTest
    static void getPatientByIdThrowsWhenPatientIsNotFound() {
        Test.setMock(HttpCalloutMock.class, new StaticResponseMock(404, NOT_FOUND_JSON));

        Boolean thrown = false;
        Test.startTest();
        try {
            EpicPatientService.getPatientById('missing-patient');
        } catch (AuraHandledException e) {
            thrown = true;
        }
        Test.stopTest();

        System.assert(thrown, 'A missing patient should throw an AuraHandledException');
    }

    @isTest
    static void getPatientByIdThrowsForBlankId() {
        Boolean thrown = false;
        Test.startTest();
        try {
            EpicPatientService.getPatientById(null);
        } catch (AuraHandledException e) {
            thrown = true;
        }
        Test.stopTest();

        System.assert(thrown, 'A blank ID should throw an AuraHandledException');
    }

    @isTest
    static void syncCreatesContactAndReviewTask() {
        Test.setMock(HttpCalloutMock.class, new EpicFhirMock(PATIENT_JSON, CONDITION_BUNDLE_JSON));

        Test.startTest();
        String contactId = EpicPatientService.syncPatientToSalesforce(PATIENT_ID);
        Test.stopTest();

        Contact synced = [
            SELECT FirstName, LastName, Birthdate, Phone, Email, MailingStreet, MailingCity,
                   MailingState, MailingPostalCode, Epic_Patient_Id__c, Epic_MRN__c, Epic_Last_Sync__c
            FROM Contact
            WHERE Id = :contactId
        ];
        System.assertEquals('Jason', synced.FirstName, 'First name should be copied');
        System.assertEquals('Argonaut', synced.LastName, 'Last name should be copied');
        System.assertEquals(Date.newInstance(1985, 8, 1), synced.Birthdate, 'Birthdate should be copied');
        System.assertEquals('555-555-1234', synced.Phone, 'Phone should be copied');
        System.assertEquals('jason.argonaut@example.com', synced.Email, 'Email should be copied');
        System.assertEquals('Madison', synced.MailingCity, 'City should be copied');
        System.assertEquals(PATIENT_ID, synced.Epic_Patient_Id__c, 'Epic ID should be stored');
        System.assertEquals('MRN-12345', synced.Epic_MRN__c, 'MRN should be stored');
        System.assertNotEquals(null, synced.Epic_Last_Sync__c, 'Sync time should be set');

        List<Task> tasks = [SELECT Subject, Status, Priority FROM Task WHERE WhoId = :contactId];
        System.assertEquals(1, tasks.size(), 'A review task should be created for a new patient');
        System.assert(tasks[0].Subject.contains('Jason Argonaut'), 'Task subject should name the patient');
        System.assertEquals('Not Started', tasks[0].Status, 'Task should start as Not Started');
    }

    @isTest
    static void syncUpdatesExistingContactWithoutNewTask() {
        Contact existing = new Contact(LastName = 'Old Name', Epic_Patient_Id__c = PATIENT_ID);
        insert existing;

        // The insert above is DML, so Test.startTest() must come before Test.setMock()
        // and the callouts. Otherwise the test fails with "uncommitted work pending".
        Test.startTest();
        Test.setMock(HttpCalloutMock.class, new EpicFhirMock(PATIENT_JSON, CONDITION_BUNDLE_JSON));
        String contactId = EpicPatientService.syncPatientToSalesforce(PATIENT_ID);
        Test.stopTest();

        System.assertEquals(String.valueOf(existing.Id), contactId, 'The existing Contact should be updated');
        Contact updated = [SELECT FirstName, LastName FROM Contact WHERE Id = :existing.Id];
        System.assertEquals('Jason', updated.FirstName, 'First name should be updated');
        System.assertEquals('Argonaut', updated.LastName, 'Last name should be updated');
        System.assertEquals(0, [SELECT COUNT() FROM Task WHERE WhoId = :existing.Id],
            'No review task should be created for an existing patient');
    }

    @isTest
    static void syncDoesNotSetBirthdateForPartialDate() {
        String yearOnlyPatient = PATIENT_JSON.replace('"birthDate":"1985-08-01"', '"birthDate":"1985"');
        Test.setMock(HttpCalloutMock.class, new EpicFhirMock(yearOnlyPatient, EMPTY_BUNDLE_JSON));

        Test.startTest();
        String contactId = EpicPatientService.syncPatientToSalesforce(PATIENT_ID);
        Test.stopTest();

        Contact synced = [SELECT Birthdate FROM Contact WHERE Id = :contactId];
        System.assertEquals(null, synced.Birthdate, 'A year-only FHIR date should not become a Birthdate');
    }

    @isTest
    static void syncThrowsWhenPatientIsNotFound() {
        Test.setMock(HttpCalloutMock.class, new StaticResponseMock(404, NOT_FOUND_JSON));

        Boolean thrown = false;
        Test.startTest();
        try {
            EpicPatientService.syncPatientToSalesforce('missing-patient');
        } catch (AuraHandledException e) {
            thrown = true;
        }
        Test.stopTest();

        System.assert(thrown, 'Sync should throw when Epic has no such patient');
        System.assertEquals(0, [SELECT COUNT() FROM Contact WHERE Epic_Patient_Id__c = 'missing-patient'],
            'No Contact should be created');
    }

    @isTest
    static void parseFhirDateHandlesFullAndPartialDates() {
        System.assertEquals(Date.newInstance(1985, 8, 1), EpicPatientService.parseFhirDate('1985-08-01'),
            'A full date should be converted');
        System.assertEquals(null, EpicPatientService.parseFhirDate('1985'), 'Year only should give null');
        System.assertEquals(null, EpicPatientService.parseFhirDate('1985-08'), 'Year and month should give null');
        System.assertEquals(null, EpicPatientService.parseFhirDate(''), 'Empty should give null');
        System.assertEquals(null, EpicPatientService.parseFhirDate(null), 'Null should give null');
    }
}
