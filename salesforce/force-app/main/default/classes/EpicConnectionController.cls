/**
 * EpicConnectionController
 * 
 * Apex controller for Salesforce Health Cloud integration with Epic FHIR R4 API.
 * Uses Named Credentials for secure endpoint management (no secrets in code).
 * 
 * Prerequisites:
 * 1. Create Named Credential 'EpicFHIR' pointing to:
 *    https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
 * 2. Configure Remote Site Settings for Epic's domain
 * 
 * @author Infogleam
 * @date 2026
 */
public with sharing class EpicConnectionController {
    
    /**
     * Fetches the FHIR Capability Statement (metadata) from Epic.
     * This endpoint is publicly accessible and proves connectivity.
     * 
     * @return JSON string containing Epic's FHIR server capabilities
     */
    @AuraEnabled(cacheable=true)
    public static String getEpicMetadata() {
        Http http = new Http();
        HttpRequest request = new HttpRequest();
        
        // Named Credential handles the base URL securely
        request.setEndpoint('callout:EpicFHIR/metadata');
        request.setMethod('GET');
        request.setHeader('Accept', 'application/fhir+json');
        
        try {
            HttpResponse response = http.send(request);
            if (response.getStatusCode() == 200) {
                return response.getBody();
            } else {
                return JSON.serialize(new Map<String, Object>{
                    'error' => true,
                    'statusCode' => response.getStatusCode(),
                    'status' => response.getStatus(),
                    'message' => 'Failed to connect to Epic FHIR server'
                });
            }
        } catch (Exception e) {
            return JSON.serialize(new Map<String, Object>{
                'error' => true,
                'exceptionType' => e.getTypeName(),
                'message' => e.getMessage()
            });
        }
    }
    
    /**
     * Parses the Capability Statement to extract supported FHIR resources.
     * Useful for dynamic UI generation based on EHR capabilities.
     * 
     * @return List of supported resource types with their interactions
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getSupportedResources() {
        String metadataJson = getEpicMetadata();
        List<Map<String, Object>> resources = new List<Map<String, Object>>();
        
        try {
            Map<String, Object> metadata = (Map<String, Object>) JSON.deserializeUntyped(metadataJson);
            
            // Check for error response
            if (metadata.containsKey('error') && (Boolean) metadata.get('error')) {
                return resources;
            }
            
            // Navigate to rest[0].resource[]
            List<Object> restList = (List<Object>) metadata.get('rest');
            if (restList != null && !restList.isEmpty()) {
                Map<String, Object> rest = (Map<String, Object>) restList[0];
                List<Object> resourceList = (List<Object>) rest.get('resource');
                
                if (resourceList != null) {
                    for (Object res : resourceList) {
                        Map<String, Object> resource = (Map<String, Object>) res;
                        Map<String, Object> summary = new Map<String, Object>();
                        summary.put('type', resource.get('type'));
                        summary.put('profile', resource.get('profile'));
                        
                        // Extract supported interactions (read, search, etc.)
                        List<Object> interactions = (List<Object>) resource.get('interaction');
                        List<String> interactionCodes = new List<String>();
                        if (interactions != null) {
                            for (Object interaction : interactions) {
                                Map<String, Object> interactionMap = (Map<String, Object>) interaction;
                                interactionCodes.add((String) interactionMap.get('code'));
                            }
                        }
                        summary.put('interactions', interactionCodes);
                        resources.add(summary);
                    }
                }
            }
        } catch (Exception e) {
            System.debug('Error parsing metadata: ' + e.getMessage());
        }
        
        return resources;
    }
    
    /**
     * Gets the FHIR server version and security information.
     * Phase 2: Useful for determining OAuth endpoints for SMART launch.
     * 
     * @return Map containing server info and security endpoints
     */
    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getServerInfo() {
        String metadataJson = getEpicMetadata();
        Map<String, Object> serverInfo = new Map<String, Object>();
        
        try {
            Map<String, Object> metadata = (Map<String, Object>) JSON.deserializeUntyped(metadataJson);
            
            if (metadata.containsKey('error')) {
                return metadata;
            }
            
            serverInfo.put('fhirVersion', metadata.get('fhirVersion'));
            serverInfo.put('software', metadata.get('software'));
            serverInfo.put('publisher', metadata.get('publisher'));
            
            // Extract OAuth endpoints from security extension
            List<Object> restList = (List<Object>) metadata.get('rest');
            if (restList != null && !restList.isEmpty()) {
                Map<String, Object> rest = (Map<String, Object>) restList[0];
                Map<String, Object> security = (Map<String, Object>) rest.get('security');
                
                if (security != null) {
                    List<Object> extensions = (List<Object>) security.get('extension');
                    if (extensions != null) {
                        for (Object ext : extensions) {
                            Map<String, Object> extension = (Map<String, Object>) ext;
                            if ('http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'.equals(extension.get('url'))) {
                                List<Object> oauthExts = (List<Object>) extension.get('extension');
                                Map<String, String> oauthEndpoints = new Map<String, String>();
                                for (Object oauthExt : oauthExts) {
                                    Map<String, Object> oauthExtMap = (Map<String, Object>) oauthExt;
                                    oauthEndpoints.put((String) oauthExtMap.get('url'), (String) oauthExtMap.get('valueUri'));
                                }
                                serverInfo.put('oauthEndpoints', oauthEndpoints);
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            serverInfo.put('error', e.getMessage());
        }
        
        return serverInfo;
    }
}
