/**
 * Test class for EpicConnectionController
 * Uses mock HTTP callouts to test without hitting real Epic servers
 */
@isTest
private class EpicConnectionControllerTest {
    
    /**
     * Mock class for successful metadata response
     */
    private class MockEpicMetadataSuccess implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/fhir+json');
            res.setStatusCode(200);
            res.setBody('{' +
                '"resourceType": "CapabilityStatement",' +
                '"fhirVersion": "4.0.1",' +
                '"publisher": "Epic",' +
                '"rest": [{' +
                    '"mode": "server",' +
                    '"resource": [{' +
                        '"type": "Patient",' +
                        '"interaction": [{"code": "read"}, {"code": "search-type"}]' +
                    '}, {' +
                        '"type": "Observation",' +
                        '"interaction": [{"code": "read"}, {"code": "search-type"}]' +
                    '}]' +
                '}]' +
            '}');
            return res;
        }
    }
    
    /**
     * Mock class for failed response
     */
    private class MockEpicMetadataFailure implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(500);
            res.setStatus('Internal Server Error');
            return res;
        }
    }
    
    @isTest
    static void testGetEpicMetadata_Success() {
        Test.setMock(HttpCalloutMock.class, new MockEpicMetadataSuccess());
        
        Test.startTest();
        String result = EpicConnectionController.getEpicMetadata();
        Test.stopTest();
        
        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.contains('CapabilityStatement'), 'Should contain CapabilityStatement');
    }
    
    @isTest
    static void testGetEpicMetadata_Failure() {
        Test.setMock(HttpCalloutMock.class, new MockEpicMetadataFailure());
        
        Test.startTest();
        String result = EpicConnectionController.getEpicMetadata();
        Test.stopTest();
        
        System.assert(result.contains('error'), 'Should contain error indication');
    }
    
    @isTest
    static void testGetSupportedResources() {
        Test.setMock(HttpCalloutMock.class, new MockEpicMetadataSuccess());
        
        Test.startTest();
        List<Map<String, Object>> resources = EpicConnectionController.getSupportedResources();
        Test.stopTest();
        
        System.assertEquals(2, resources.size(), 'Should have 2 resources');
    }
    
    @isTest
    static void testGetServerInfo() {
        Test.setMock(HttpCalloutMock.class, new MockEpicMetadataSuccess());
        
        Test.startTest();
        Map<String, Object> serverInfo = EpicConnectionController.getServerInfo();
        Test.stopTest();
        
        System.assertEquals('4.0.1', serverInfo.get('fhirVersion'), 'FHIR version should be 4.0.1');
    }
}
