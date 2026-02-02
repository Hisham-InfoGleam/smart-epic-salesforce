import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Apex methods
import getServerInfo from '@salesforce/apex/EpicConnectionController.getServerInfo';
import searchPatients from '@salesforce/apex/EpicPatientService.searchPatients';
import getPatientById from '@salesforce/apex/EpicPatientService.getPatientById';
import syncPatientToSalesforce from '@salesforce/apex/EpicPatientService.syncPatientToSalesforce';

/**
 * Epic Patient Search & Sync Lightning Web Component
 * 
 * Demonstrates a complete Epic → Salesforce workflow:
 * 1. Search patients in Epic FHIR API
 * 2. View patient details and conditions
 * 3. Sync patient to Salesforce Contact/Health Cloud
 * 4. Automatic Task creation for care coordination
 * 
 * @author Hisham Alrashdan (Infogleam)
 */
export default class EpicPatientSync extends NavigationMixin(LightningElement) {
    @track isLoading = false;
    @track loadingMessage = 'Loading...';
    @track error = null;
    
    // Connection status
    @track connectionStatus = 'Checking...';
    @track connectionStatusClass = 'slds-text-color_weak';
    @track connectionIcon = 'utility:spinner';
    @track fhirVersion = 'N/A';
    @track isConnected = false;
    
    // Search
    @track searchTerm = '';
    @track searchResults = [];
    
    // Selected patient
    @track selectedPatient = null;
    
    // Sync status
    @track syncSuccess = false;
    @track syncedRecordId = null;

    connectedCallback() {
        this.checkConnection();
    }

    async checkConnection() {
        this.isLoading = true;
        this.loadingMessage = 'Connecting to Epic FHIR Server...';
        this.error = null;

        try {
            const serverInfo = await getServerInfo();
            
            if (serverInfo.error) {
                this.setConnectionError(serverInfo.message || 'Connection failed');
                return;
            }

            this.connectionStatus = 'Connected';
            this.connectionStatusClass = 'slds-text-color_success';
            this.connectionIcon = 'utility:success';
            this.fhirVersion = serverInfo.fhirVersion || 'R4';
            this.isConnected = true;
            
        } catch (err) {
            this.setConnectionError(err.body?.message || err.message || 'Unknown error');
        } finally {
            this.isLoading = false;
        }
    }

    setConnectionError(message) {
        this.connectionStatus = 'Disconnected';
        this.connectionStatusClass = 'slds-text-color_error';
        this.connectionIcon = 'utility:error';
        this.isConnected = false;
        this.error = message;
    }

    refreshConnection() {
        this.searchResults = [];
        this.selectedPatient = null;
        this.syncSuccess = false;
        this.checkConnection();
    }

    handleSearchTermChange(event) {
        this.searchTerm = event.target.value;
    }

    get isSearchDisabled() {
        return this.isLoading || !this.isConnected || !this.searchTerm || this.searchTerm.length < 2;
    }

    get hasSearchResults() {
        return this.searchResults && this.searchResults.length > 0;
    }

    async searchPatients() {
        if (this.isSearchDisabled) return;
        
        this.isLoading = true;
        this.loadingMessage = `Searching Epic for "${this.searchTerm}"...`;
        this.error = null;
        this.selectedPatient = null;
        this.syncSuccess = false;

        try {
            const results = await searchPatients({ searchTerm: this.searchTerm });
            
            // Add computed properties for display
            this.searchResults = results.map(patient => ({
                ...patient,
                initials: this.getInitials(patient.firstName, patient.lastName),
                fullName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown'
            }));
            
            if (this.searchResults.length === 0) {
                this.showToast('No Results', `No patients found matching "${this.searchTerm}"`, 'info');
            }
            
        } catch (err) {
            this.error = err.body?.message || err.message || 'Search failed';
            this.searchResults = [];
        } finally {
            this.isLoading = false;
        }
    }

    async handleViewPatient(event) {
        const patientId = event.currentTarget.dataset.patientId;
        
        this.isLoading = true;
        this.loadingMessage = 'Loading patient details...';
        this.error = null;

        try {
            const patient = await getPatientById({ epicPatientId: patientId });
            
            // Process patient data for display
            this.selectedPatient = {
                ...patient,
                fullName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown',
                fullAddress: this.formatAddress(patient),
                conditions: patient.conditions ? patient.conditions.map(c => ({
                    ...c,
                    statusClass: c.status === 'active' ? 'slds-badge slds-badge_error' : 'slds-badge slds-badge_success'
                })) : []
            };
            
        } catch (err) {
            this.error = err.body?.message || err.message || 'Failed to load patient';
        } finally {
            this.isLoading = false;
        }
    }

    async handleSyncPatient(event) {
        const patientId = event.currentTarget.dataset.patientId;
        
        this.isLoading = true;
        this.loadingMessage = 'Syncing patient to Salesforce...';
        this.error = null;
        this.syncSuccess = false;

        try {
            const recordId = await syncPatientToSalesforce({ epicPatientId: patientId });
            
            this.syncedRecordId = recordId;
            this.syncSuccess = true;
            
            this.showToast(
                'Success!', 
                'Patient synced to Salesforce. A review task has been created.',
                'success'
            );
            
        } catch (err) {
            this.error = err.body?.message || err.message || 'Sync failed';
            this.showToast('Sync Failed', this.error, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    clearSelectedPatient() {
        this.selectedPatient = null;
    }

    navigateToSyncedRecord() {
        if (this.syncedRecordId) {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: {
                    recordId: this.syncedRecordId,
                    actionName: 'view'
                }
            });
        }
    }

    // Helper methods
    getInitials(firstName, lastName) {
        const first = firstName ? firstName.charAt(0).toUpperCase() : '';
        const last = lastName ? lastName.charAt(0).toUpperCase() : '';
        return first + last || '?';
    }

    formatAddress(patient) {
        const parts = [
            patient.addressLine,
            patient.city,
            patient.state,
            patient.postalCode
        ].filter(Boolean);
        return parts.join(', ') || 'N/A';
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({
            title,
            message,
            variant
        }));
    }
}
