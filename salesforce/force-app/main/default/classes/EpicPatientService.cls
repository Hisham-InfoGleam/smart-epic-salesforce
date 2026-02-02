/**
 * EpicPatientService
 * 
 * Service class for fetching and syncing patient data from Epic FHIR R4 API
 * to Salesforce Health Cloud. Demonstrates enterprise integration patterns.
 * 
 * Integration Flow:
 * 1. Epic FHIR API → This Apex Service → Salesforce Account/Contact/Health Cloud Objects
 * 2. Supports both pull (on-demand) and scheduled sync patterns
 * 
 * Prerequisites:
 * 1. Named Credential 'EpicFHIR' configured
 * 2. Health Cloud package installed (or standard Account/Contact for POC)
 * 
 * @author Hisham Alrashdan (Infogleam)
 * @date 2026
 */
public with sharing class EpicPatientService {
    
    // FHIR resource endpoints
    private static final String PATIENT_ENDPOINT = 'callout:EpicFHIR/Patient';
    private static final String CONDITION_ENDPOINT = 'callout:EpicFHIR/Condition';
    
    /**
     * Wrapper class for patient data from Epic FHIR API
     */
    public class EpicPatient {
        @AuraEnabled public String epicId { get; set; }
        @AuraEnabled public String firstName { get; set; }
        @AuraEnabled public String lastName { get; set; }
        @AuraEnabled public String fullName { get; set; }
        @AuraEnabled public String gender { get; set; }
        @AuraEnabled public String birthDate { get; set; }
        @AuraEnabled public String phone { get; set; }
        @AuraEnabled public String email { get; set; }
        @AuraEnabled public String addressLine { get; set; }
        @AuraEnabled public String city { get; set; }
        @AuraEnabled public String state { get; set; }
        @AuraEnabled public String postalCode { get; set; }
        @AuraEnabled public String mrn { get; set; } // Medical Record Number
        @AuraEnabled public List<EpicCondition> conditions { get; set; }
    }
    
    /**
     * Wrapper class for condition/diagnosis data
     */
    public class EpicCondition {
        @AuraEnabled public String conditionId { get; set; }
        @AuraEnabled public String name { get; set; }
        @AuraEnabled public String status { get; set; }
        @AuraEnabled public String onsetDate { get; set; }
        @AuraEnabled public String category { get; set; }
        @AuraEnabled public String code { get; set; }
        @AuraEnabled public String codeSystem { get; set; }
    }
    
    /**
     * Search for patients in Epic by name or identifier
     * 
     * @param searchTerm - Patient name or MRN to search
     * @return List of matching patients
     */
    @AuraEnabled(cacheable=true)
    public static List<EpicPatient> searchPatients(String searchTerm) {
        List<EpicPatient> patients = new List<EpicPatient>();
        
        Http http = new Http();
        HttpRequest request = new HttpRequest();
        
        // Search by name (FHIR standard search parameter)
        String endpoint = PATIENT_ENDPOINT + '?name=' + EncodingUtil.urlEncode(searchTerm, 'UTF-8') + '&_count=10';
        request.setEndpoint(endpoint);
        request.setMethod('GET');
        request.setHeader('Accept', 'application/fhir+json');
        
        try {
            HttpResponse response = http.send(request);
            
            if (response.getStatusCode() == 200) {
                patients = parsePatientBundle(response.getBody());
            } else {
                System.debug('Epic search failed: ' + response.getStatusCode() + ' - ' + response.getBody());
            }
        } catch (Exception e) {
            System.debug('Epic search error: ' + e.getMessage());
            throw new AuraHandledException('Failed to search Epic: ' + e.getMessage());
        }
        
        return patients;
    }
    
    /**
     * Get a specific patient by Epic FHIR ID
     * 
     * @param epicPatientId - The Epic FHIR Patient ID
     * @return EpicPatient with full details
     */
    @AuraEnabled(cacheable=true)
    public static EpicPatient getPatientById(String epicPatientId) {
        Http http = new Http();
        HttpRequest request = new HttpRequest();
        
        request.setEndpoint(PATIENT_ENDPOINT + '/' + epicPatientId);
        request.setMethod('GET');
        request.setHeader('Accept', 'application/fhir+json');
        
        try {
            HttpResponse response = http.send(request);
            
            if (response.getStatusCode() == 200) {
                EpicPatient patient = parsePatientResource(response.getBody());
                // Also fetch conditions for this patient
                patient.conditions = getPatientConditions(epicPatientId);
                return patient;
            } else {
                throw new AuraHandledException('Patient not found: ' + response.getStatus());
            }
        } catch (Exception e) {
            throw new AuraHandledException('Failed to fetch patient: ' + e.getMessage());
        }
    }
    
    /**
     * Get conditions for a patient from Epic
     * 
     * @param epicPatientId - The Epic FHIR Patient ID
     * @return List of conditions/diagnoses
     */
    @AuraEnabled(cacheable=true)
    public static List<EpicCondition> getPatientConditions(String epicPatientId) {
        List<EpicCondition> conditions = new List<EpicCondition>();
        
        Http http = new Http();
        HttpRequest request = new HttpRequest();
        
        request.setEndpoint(CONDITION_ENDPOINT + '?patient=' + epicPatientId + '&_count=20');
        request.setMethod('GET');
        request.setHeader('Accept', 'application/fhir+json');
        
        try {
            HttpResponse response = http.send(request);
            
            if (response.getStatusCode() == 200) {
                conditions = parseConditionBundle(response.getBody());
            }
        } catch (Exception e) {
            System.debug('Condition fetch error: ' + e.getMessage());
        }
        
        return conditions;
    }
    
    /**
     * Sync an Epic patient to Salesforce as Account/Contact
     * In Health Cloud, this would create Person Account or HealthCloudGA__EhrPatient__c
     * 
     * @param epicPatientId - The Epic FHIR Patient ID to sync
     * @return The Salesforce record ID created/updated
     */
    @AuraEnabled
    public static String syncPatientToSalesforce(String epicPatientId) {
        EpicPatient epicPatient = getPatientById(epicPatientId);
        
        if (epicPatient == null) {
            throw new AuraHandledException('Could not find patient in Epic');
        }
        
        // Check if patient already exists in Salesforce (by Epic ID)
        List<Contact> existingContacts = [
            SELECT Id, Epic_Patient_Id__c 
            FROM Contact 
            WHERE Epic_Patient_Id__c = :epicPatientId 
            LIMIT 1
        ];
        
        Contact sfContact;
        Boolean isNew = existingContacts.isEmpty();
        
        if (isNew) {
            sfContact = new Contact();
        } else {
            sfContact = existingContacts[0];
        }
        
        // Map Epic FHIR data to Salesforce fields
        sfContact.FirstName = epicPatient.firstName;
        sfContact.LastName = epicPatient.lastName;
        sfContact.Phone = epicPatient.phone;
        sfContact.Email = epicPatient.email;
        sfContact.Birthdate = epicPatient.birthDate != null ? Date.valueOf(epicPatient.birthDate) : null;
        sfContact.MailingCity = epicPatient.city;
        sfContact.MailingState = epicPatient.state;
        sfContact.MailingPostalCode = epicPatient.postalCode;
        sfContact.MailingStreet = epicPatient.addressLine;
        
        // Custom field to link back to Epic
        sfContact.Epic_Patient_Id__c = epicPatientId;
        sfContact.Epic_MRN__c = epicPatient.mrn;
        sfContact.Epic_Last_Sync__c = DateTime.now();
        
        try {
            upsert sfContact;
            
            // Create a Task for care coordinator to review new patient
            if (isNew) {
                createPatientReviewTask(sfContact.Id, epicPatient.fullName);
            }
            
            return sfContact.Id;
        } catch (Exception e) {
            throw new AuraHandledException('Failed to sync to Salesforce: ' + e.getMessage());
        }
    }
    
    /**
     * Creates a Task for care team to review newly synced patient
     * This demonstrates workflow automation
     */
    private static void createPatientReviewTask(Id contactId, String patientName) {
        Task reviewTask = new Task(
            Subject = 'Review New Patient from Epic: ' + patientName,
            Description = 'A new patient has been synced from Epic EHR. Please review their information and conditions.',
            WhoId = contactId,
            Status = 'Not Started',
            Priority = 'Normal',
            ActivityDate = Date.today().addDays(1),
            Type = 'EHR Sync Review'
        );
        
        insert reviewTask;
    }
    
    // ============================================
    // Private Parser Methods
    // ============================================
    
    private static List<EpicPatient> parsePatientBundle(String jsonBody) {
        List<EpicPatient> patients = new List<EpicPatient>();
        
        Map<String, Object> bundle = (Map<String, Object>) JSON.deserializeUntyped(jsonBody);
        List<Object> entries = (List<Object>) bundle.get('entry');
        
        if (entries != null) {
            for (Object entry : entries) {
                Map<String, Object> entryMap = (Map<String, Object>) entry;
                Map<String, Object> resource = (Map<String, Object>) entryMap.get('resource');
                
                if (resource != null && 'Patient'.equals(resource.get('resourceType'))) {
                    patients.add(parsePatientMap(resource));
                }
            }
        }
        
        return patients;
    }
    
    private static EpicPatient parsePatientResource(String jsonBody) {
        Map<String, Object> resource = (Map<String, Object>) JSON.deserializeUntyped(jsonBody);
        return parsePatientMap(resource);
    }
    
    private static EpicPatient parsePatientMap(Map<String, Object> resource) {
        EpicPatient patient = new EpicPatient();
        
        patient.epicId = (String) resource.get('id');
        patient.gender = (String) resource.get('gender');
        patient.birthDate = (String) resource.get('birthDate');
        
        // Parse name
        List<Object> names = (List<Object>) resource.get('name');
        if (names != null && !names.isEmpty()) {
            Map<String, Object> name = (Map<String, Object>) names[0];
            patient.lastName = (String) name.get('family');
            
            List<Object> givenNames = (List<Object>) name.get('given');
            if (givenNames != null && !givenNames.isEmpty()) {
                patient.firstName = (String) givenNames[0];
            }
            
            patient.fullName = (patient.firstName != null ? patient.firstName + ' ' : '') + 
                              (patient.lastName != null ? patient.lastName : '');
        }
        
        // Parse telecom (phone, email)
        List<Object> telecoms = (List<Object>) resource.get('telecom');
        if (telecoms != null) {
            for (Object telecom : telecoms) {
                Map<String, Object> telecomMap = (Map<String, Object>) telecom;
                String system = (String) telecomMap.get('system');
                String value = (String) telecomMap.get('value');
                
                if ('phone'.equals(system)) {
                    patient.phone = value;
                } else if ('email'.equals(system)) {
                    patient.email = value;
                }
            }
        }
        
        // Parse address
        List<Object> addresses = (List<Object>) resource.get('address');
        if (addresses != null && !addresses.isEmpty()) {
            Map<String, Object> address = (Map<String, Object>) addresses[0];
            
            List<Object> lines = (List<Object>) address.get('line');
            if (lines != null && !lines.isEmpty()) {
                patient.addressLine = (String) lines[0];
            }
            
            patient.city = (String) address.get('city');
            patient.state = (String) address.get('state');
            patient.postalCode = (String) address.get('postalCode');
        }
        
        // Parse MRN from identifiers
        List<Object> identifiers = (List<Object>) resource.get('identifier');
        if (identifiers != null) {
            for (Object identifier : identifiers) {
                Map<String, Object> idMap = (Map<String, Object>) identifier;
                Map<String, Object> type = (Map<String, Object>) idMap.get('type');
                
                if (type != null) {
                    List<Object> codings = (List<Object>) type.get('coding');
                    if (codings != null) {
                        for (Object coding : codings) {
                            Map<String, Object> codingMap = (Map<String, Object>) coding;
                            if ('MR'.equals(codingMap.get('code'))) {
                                patient.mrn = (String) idMap.get('value');
                                break;
                            }
                        }
                    }
                }
            }
        }
        
        return patient;
    }
    
    private static List<EpicCondition> parseConditionBundle(String jsonBody) {
        List<EpicCondition> conditions = new List<EpicCondition>();
        
        Map<String, Object> bundle = (Map<String, Object>) JSON.deserializeUntyped(jsonBody);
        List<Object> entries = (List<Object>) bundle.get('entry');
        
        if (entries != null) {
            for (Object entry : entries) {
                Map<String, Object> entryMap = (Map<String, Object>) entry;
                Map<String, Object> resource = (Map<String, Object>) entryMap.get('resource');
                
                if (resource != null && 'Condition'.equals(resource.get('resourceType'))) {
                    EpicCondition condition = new EpicCondition();
                    condition.conditionId = (String) resource.get('id');
                    condition.onsetDate = (String) resource.get('onsetDateTime');
                    
                    // Parse code
                    Map<String, Object> code = (Map<String, Object>) resource.get('code');
                    if (code != null) {
                        condition.name = (String) code.get('text');
                        
                        List<Object> codings = (List<Object>) code.get('coding');
                        if (codings != null && !codings.isEmpty()) {
                            Map<String, Object> coding = (Map<String, Object>) codings[0];
                            if (condition.name == null) {
                                condition.name = (String) coding.get('display');
                            }
                            condition.code = (String) coding.get('code');
                            condition.codeSystem = (String) coding.get('system');
                        }
                    }
                    
                    // Parse clinical status
                    Map<String, Object> clinicalStatus = (Map<String, Object>) resource.get('clinicalStatus');
                    if (clinicalStatus != null) {
                        List<Object> statusCodings = (List<Object>) clinicalStatus.get('coding');
                        if (statusCodings != null && !statusCodings.isEmpty()) {
                            Map<String, Object> statusCoding = (Map<String, Object>) statusCodings[0];
                            condition.status = (String) statusCoding.get('code');
                        }
                    }
                    
                    // Parse category
                    List<Object> categories = (List<Object>) resource.get('category');
                    if (categories != null && !categories.isEmpty()) {
                        Map<String, Object> category = (Map<String, Object>) categories[0];
                        List<Object> catCodings = (List<Object>) category.get('coding');
                        if (catCodings != null && !catCodings.isEmpty()) {
                            Map<String, Object> catCoding = (Map<String, Object>) catCodings[0];
                            condition.category = (String) catCoding.get('display');
                        }
                    }
                    
                    conditions.add(condition);
                }
            }
        }
        
        return conditions;
    }
}
