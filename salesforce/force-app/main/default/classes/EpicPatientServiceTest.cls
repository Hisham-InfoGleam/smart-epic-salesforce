/**
 * Test class for EpicPatientService
 * 
 * Demonstrates proper testing patterns for FHIR integration code
 * Uses mock HTTP responses to simulate Epic API
 * 
 * @author Hisham Alrashdan (Infogleam)
 * @date 2026
 */
@isTest
private class EpicPatientServiceTest {
    
    /**
     * Mock HTTP callout for successful patient search
     */
    private class PatientSearchMock implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/fhir+json');
            res.setStatusCode(200);
            
            // Mock FHIR Bundle with one patient
            String mockBundle = '{"resourceType":"Bundle","type":"searchset","entry":[' +
                '{"resource":{"resourceType":"Patient","id":"test-patient-001",' +
                '"name":[{"family":"Argonaut","given":["Jason"]}],' +
                '"gender":"male","birthDate":"1985-08-01",' +
                '"telecom":[{"system":"phone","value":"555-1234"}],' +
                '"address":[{"city":"Madison","state":"WI","postalCode":"53703"}]}}]}';
            
            res.setBody(mockBundle);
            return res;
        }
    }
    
    /**
     * Mock HTTP callout for patient not found
     */
    private class PatientNotFoundMock implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/fhir+json');
            res.setStatusCode(404);
            res.setStatus('Not Found');
            res.setBody('{"resourceType":"OperationOutcome","issue":[{"severity":"error","code":"not-found"}]}');
            return res;
        }
    }
    
    /**
     * Mock for conditions endpoint
     */
    private class ConditionsMock implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/fhir+json');
            res.setStatusCode(200);
            
            String mockBundle = '{"resourceType":"Bundle","type":"searchset","entry":[' +
                '{"resource":{"resourceType":"Condition","id":"cond-001",' +
                '"code":{"coding":[{"display":"Essential Hypertension","code":"59621000"}]},' +
                '"clinicalStatus":{"coding":[{"code":"active"}]},' +
                '"onsetDateTime":"2020-03-15"}}]}';
            
            res.setBody(mockBundle);
            return res;
        }
    }
    
    @isTest
    static void testSearchPatients() {
        Test.setMock(HttpCalloutMock.class, new PatientSearchMock());
        
        Test.startTest();
        List<EpicPatientService.EpicPatient> patients = EpicPatientService.searchPatients('Argonaut');
        Test.stopTest();
        
        System.assertEquals(1, patients.size(), 'Should return one patient');
        System.assertEquals('Jason', patients[0].firstName, 'First name should match');
        System.assertEquals('Argonaut', patients[0].lastName, 'Last name should match');
        System.assertEquals('male', patients[0].gender, 'Gender should match');
    }
    
    @isTest
    static void testGetPatientConditions() {
        Test.setMock(HttpCalloutMock.class, new ConditionsMock());
        
        Test.startTest();
        List<EpicPatientService.EpicCondition> conditions = EpicPatientService.getPatientConditions('test-patient-001');
        Test.stopTest();
        
        System.assertEquals(1, conditions.size(), 'Should return one condition');
        System.assertEquals('Essential Hypertension', conditions[0].name, 'Condition name should match');
        System.assertEquals('active', conditions[0].status, 'Status should be active');
    }
    
    @isTest
    static void testSearchPatientsEmpty() {
        // Mock that returns empty bundle
        Test.setMock(HttpCalloutMock.class, new HttpCalloutMock() {
            public HTTPResponse respond(HTTPRequest req) {
                HttpResponse res = new HttpResponse();
                res.setStatusCode(200);
                res.setBody('{"resourceType":"Bundle","type":"searchset","total":0}');
                return res;
            }
        });
        
        Test.startTest();
        List<EpicPatientService.EpicPatient> patients = EpicPatientService.searchPatients('NonexistentPatient');
        Test.stopTest();
        
        System.assertEquals(0, patients.size(), 'Should return empty list');
    }
}
