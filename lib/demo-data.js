/**
 * Sample FHIR R4 resources for demo mode (DEMO_MODE=true).
 * The values are made up. The name follows Epic's public sandbox test patient
 * (Jason Argonaut). No real patient data is used.
 */

module.exports = {
  patient: {
    resourceType: 'Patient',
    id: 'demo-patient-001',
    name: [{ given: ['Jason', 'A'], family: 'Argonaut' }],
    gender: 'male',
    birthDate: '1985-08-01',
    telecom: [{ system: 'phone', value: '(555) 555-1234' }],
    address: [{ city: 'Madison', state: 'WI', postalCode: '53703' }]
  },
  observations: {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: [
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-1',
          code: { coding: [{ display: 'Blood Pressure' }] },
          valueQuantity: { value: 120, unit: 'mmHg' },
          effectiveDateTime: '2026-01-28T10:30:00Z',
          status: 'final'
        }
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-2',
          code: { coding: [{ display: 'Heart Rate' }] },
          valueQuantity: { value: 72, unit: 'bpm' },
          effectiveDateTime: '2026-01-28T10:30:00Z',
          status: 'final'
        }
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-3',
          code: { coding: [{ display: 'Body Temperature' }] },
          valueQuantity: { value: 98.6, unit: '°F' },
          effectiveDateTime: '2026-01-25T09:15:00Z',
          status: 'final'
        }
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-4',
          code: { coding: [{ display: 'Oxygen Saturation' }] },
          valueQuantity: { value: 98, unit: '%' },
          effectiveDateTime: '2026-01-28T10:30:00Z',
          status: 'final'
        }
      }
    ]
  },
  conditions: {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: [
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-1',
          code: { coding: [{ display: 'Essential Hypertension' }] },
          clinicalStatus: { coding: [{ code: 'active' }] },
          onsetDateTime: '2020-03-15',
          category: [{ coding: [{ display: 'Encounter Diagnosis' }] }]
        }
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-2',
          code: { coding: [{ display: 'Type 2 Diabetes Mellitus' }] },
          clinicalStatus: { coding: [{ code: 'active' }] },
          onsetDateTime: '2019-06-20',
          category: [{ coding: [{ display: 'Problem List Item' }] }]
        }
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-3',
          code: { coding: [{ display: 'Seasonal Allergies' }] },
          clinicalStatus: { coding: [{ code: 'resolved' }] },
          onsetDateTime: '2023-04-01',
          category: [{ coding: [{ display: 'Problem List Item' }] }]
        }
      }
    ]
  },
  medications: {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: [
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-1',
          medicationCodeableConcept: { coding: [{ display: 'Lisinopril 10mg Tablet' }] },
          status: 'active',
          dosageInstruction: [{ text: 'Take 1 tablet by mouth daily' }],
          authoredOn: '2024-01-15'
        }
      },
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-2',
          medicationCodeableConcept: { coding: [{ display: 'Metformin 500mg Tablet' }] },
          status: 'active',
          dosageInstruction: [{ text: 'Take 1 tablet by mouth twice daily with meals' }],
          authoredOn: '2023-09-01'
        }
      },
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-3',
          medicationCodeableConcept: { coding: [{ display: 'Atorvastatin 20mg Tablet' }] },
          status: 'active',
          dosageInstruction: [{ text: 'Take 1 tablet by mouth at bedtime' }],
          authoredOn: '2024-02-20'
        }
      }
    ]
  }
};
