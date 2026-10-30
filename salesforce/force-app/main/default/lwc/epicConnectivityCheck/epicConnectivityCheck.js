import { LightningElement, track } from 'lwc';
import getEpicMetadata from '@salesforce/apex/EpicConnectionController.getEpicMetadata';
import getSupportedResources from '@salesforce/apex/EpicConnectionController.getSupportedResources';
import getServerInfo from '@salesforce/apex/EpicConnectionController.getServerInfo';

/**
 * Lightning Web Component for Epic FHIR Connectivity Check
 * 
 * Shows:
 * - Connection status to Epic's FHIR server
 * - Server capabilities (supported FHIR resources)
 * - The raw CapabilityStatement JSON
 *
 * Status: not deployed to a Salesforce org yet.
 *
 * @author Hisham Alrashdan (InfoGleam)
 */
export default class EpicConnectivityCheck extends LightningElement {
    @track isLoading = false;
    @track connectionStatus = '';
    @track statusClass = '';
    @track serverInfo = null;
    @track resources = [];
    @track rawMetadata = '';
    @track showRawJson = false;
    @track error = null;

    connectedCallback() {
        this.checkConnection();
    }

    async checkConnection() {
        this.isLoading = true;
        this.error = null;

        try {
            // Get server info
            const info = await getServerInfo();
            if (info.error) {
                this.handleError(info);
                return;
            }

            this.serverInfo = info;
            this.connectionStatus = 'Connected';
            this.statusClass = 'slds-text-color_success';

            // Get supported resources
            const resourceList = await getSupportedResources();
            this.resources = resourceList.map(r => ({
                ...r,
                interactionList: r.interactions ? r.interactions.join(', ') : 'N/A'
            }));

            // Get raw metadata for JSON view
            const metadata = await getEpicMetadata();
            this.rawMetadata = JSON.stringify(JSON.parse(metadata), null, 2);

        } catch (err) {
            this.handleError({ message: err.body?.message || err.message });
        } finally {
            this.isLoading = false;
        }
    }

    handleError(errorInfo) {
        this.connectionStatus = 'Connection Failed';
        this.statusClass = 'slds-text-color_error';
        this.error = errorInfo.message || 'Unknown error occurred';
    }

    toggleRawJson() {
        this.showRawJson = !this.showRawJson;
    }

    // LWC templates cannot hold expressions, so the icon name comes from a getter.
    get statusIconName() {
        return this.connectionStatus === 'Connected' ? 'utility:success' : 'utility:error';
    }

    get toggleButtonLabel() {
        return this.showRawJson ? 'Hide Raw JSON' : 'Show Raw JSON';
    }

    get hasResources() {
        return this.resources && this.resources.length > 0;
    }

    get fhirVersion() {
        return this.serverInfo?.fhirVersion || 'N/A';
    }

    get publisher() {
        return this.serverInfo?.publisher || 'N/A';
    }

    get resourceCount() {
        return this.resources.length;
    }
}
