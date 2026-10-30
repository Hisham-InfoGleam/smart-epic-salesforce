/**
 * Dashboard: loads FHIR data from this server's /api routes and shows it.
 *
 * FHIR text comes from outside this app. Every value goes through escapeHtml()
 * (public/js/escape-html.js) before it is put into the page.
 */
'use strict';

// ============================================
// FHIR display helpers
// ============================================

function getCodeableConceptDisplay(cc) {
  if (!cc) return null;
  if (typeof cc.text === 'string' && cc.text.trim()) return cc.text.trim();
  const coding = Array.isArray(cc.coding) ? cc.coding : [];
  const first = coding.find(c => c && (c.display || c.code)) || coding[0];
  if (!first) return null;
  return (first.display || first.code || '').toString().trim() || null;
}

function formatDate(dateString) {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

function getObservationDate(obs) {
  return (
    formatDate(obs?.effectiveDateTime) ||
    formatDate(obs?.effectivePeriod?.start) ||
    formatDate(obs?.issued) ||
    formatDate(obs?.meta?.lastUpdated) ||
    null
  );
}

function formatQuantity(q) {
  if (!q || typeof q.value === 'undefined' || q.value === null) return null;
  const unit = q.unit || q.code || '';
  return `${q.value}${unit ? ` ${unit}` : ''}`;
}

function formatObservationValue(obs) {
  if (!obs) return null;

  const direct =
    formatQuantity(obs.valueQuantity) ||
    getCodeableConceptDisplay(obs.valueCodeableConcept) ||
    (typeof obs.valueString === 'string' && obs.valueString.trim() ? obs.valueString.trim() : null) ||
    (typeof obs.valueBoolean === 'boolean' ? String(obs.valueBoolean) : null) ||
    (typeof obs.valueInteger === 'number' ? String(obs.valueInteger) : null);

  if (direct) return direct;

  // Many vital signs use Observation.component (for example blood pressure systolic and diastolic).
  const components = Array.isArray(obs.component) ? obs.component : [];
  const parts = components
    .map(c => {
      const label = getCodeableConceptDisplay(c.code) || 'Component';
      const val =
        formatQuantity(c.valueQuantity) ||
        getCodeableConceptDisplay(c.valueCodeableConcept) ||
        (typeof c.valueString === 'string' && c.valueString.trim() ? c.valueString.trim() : null);
      if (!val) return null;
      return `${label}: ${val}`;
    })
    .filter(Boolean);

  return parts.length ? parts.join(' / ') : null;
}

function getObservationTitle(obs) {
  const direct = getCodeableConceptDisplay(obs?.code);
  if (direct) return direct;

  const category = getCodeableConceptDisplay(obs?.category?.[0]);
  if (category) return category;

  const components = Array.isArray(obs?.component) ? obs.component : [];
  if (components.length) return 'Composite Observation';

  if (Array.isArray(obs?.hasMember) && obs.hasMember.length) {
    return `Observation Panel (${obs.hasMember.length})`;
  }

  return 'Observation';
}

function getMedicationRequestName(med) {
  // medication[x] can be a CodeableConcept or a Reference.
  const fromCC = getCodeableConceptDisplay(med?.medicationCodeableConcept);
  if (fromCC) return fromCC;

  const refDisplay = med?.medicationReference?.display;
  if (typeof refDisplay === 'string' && refDisplay.trim()) return refDisplay.trim();

  const ref = med?.medicationReference?.reference;
  const contained = Array.isArray(med?.contained) ? med.contained : [];
  if (typeof ref === 'string' && ref.startsWith('#')) {
    const id = ref.slice(1);
    const resource = contained.find(r => r && r.id === id);
    const name = getCodeableConceptDisplay(resource?.code);
    if (name) return name;
  }

  // Fallbacks: identifier, reason, category, then status.
  const identifier = med?.identifier?.[0];
  if (identifier?.value && typeof identifier.value === 'string') {
    return `Medication (ID: ${identifier.value.slice(0, 20)})`;
  }

  const reason = getCodeableConceptDisplay(med?.reasonCode?.[0]);
  if (reason) return `Medication for ${reason}`;

  const category = getCodeableConceptDisplay(med?.category?.[0]);
  if (category) return `${category} Medication`;

  if (typeof med?.status === 'string' && med.status) {
    return `${med.status.charAt(0).toUpperCase() + med.status.slice(1)} Medication`;
  }

  return null;
}

// Returns one of two fixed CSS class names, never text from the data.
function statusClass(status) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'active') return 'active';
  if (['final', 'amended', 'corrected', 'completed', 'stopped', 'entered-in-error'].includes(normalized)) {
    return 'completed';
  }
  return 'active';
}

// ============================================
// Loading and showing data
// ============================================

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }
  if (!response.ok) {
    const message = (body && (body.message || body.error)) || `Request failed (HTTP ${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

function errorHtml(prefix, error) {
  const message = error && error.message ? error.message : 'Unknown error';
  if (error && error.status === 401) {
    return `<div class="error">${escapeHtml(message)} <a href="/">Back to the start page</a></div>`;
  }
  return `<div class="error">${escapeHtml(prefix)}: ${escapeHtml(message)}</div>`;
}

function emptyHtml(note, helpText) {
  return `
    <div class="empty">
      <p>${escapeHtml(note)}</p>
      <p class="empty-help">
        ${escapeHtml(helpText)}
        <a href="https://fhir.epic.com" target="_blank" rel="noopener noreferrer">Epic app registration</a>
      </p>
    </div>`;
}

async function loadSessionInfo() {
  try {
    const data = await fetchJson('/api/session');
    document.getElementById('fhir-server').textContent = data.fhirBaseUrl || 'Unknown';
    document.getElementById('patient-id').textContent = data.patientId || 'Unknown';
    if (data.demoMode) {
      document.getElementById('demo-banner').hidden = false;
    }
  } catch (error) {
    document.getElementById('fhir-server').textContent = 'Unknown';
    document.getElementById('patient-id').textContent = 'Unknown';
  }
}

async function loadPatient() {
  const container = document.getElementById('patient-header');

  try {
    const patient = await fetchJson('/api/patient');

    const name = patient.name?.[0];
    const fullName = name ? `${name.given?.join(' ') || ''} ${name.family || ''}`.trim() || 'Unknown' : 'Unknown';
    const gender = patient.gender || 'Unknown';
    const birthDate = patient.birthDate || 'Unknown';
    const phone = patient.telecom?.find(t => t.system === 'phone')?.value || 'N/A';
    const address = patient.address?.[0];
    const addressStr = address ? [address.city, address.state].filter(Boolean).join(', ') || 'N/A' : 'N/A';

    container.innerHTML = `
      <div class="patient-avatar">${escapeHtml(fullName.charAt(0).toUpperCase())}</div>
      <div class="patient-info">
        <h2>${escapeHtml(fullName)}</h2>
        <div class="patient-meta">
          <span class="meta-item"><strong>Gender:</strong> ${escapeHtml(gender)}</span>
          <span class="meta-item"><strong>DOB:</strong> ${escapeHtml(birthDate)}</span>
          <span class="meta-item"><strong>Phone:</strong> ${escapeHtml(phone)}</span>
          <span class="meta-item"><strong>Location:</strong> ${escapeHtml(addressStr)}</span>
        </div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = errorHtml('Failed to load patient', error);
  }
}

async function loadObservations() {
  const container = document.getElementById('observations-list');

  try {
    const bundle = await fetchJson('/api/observations');
    const observations = bundle.entry?.map(e => e.resource) || [];

    if (observations.length === 0) {
      container.innerHTML = emptyHtml(
        bundle.note || 'No observations available for this patient.',
        'To see observations, enable the Observation APIs in your'
      );
      return;
    }

    container.innerHTML = observations.map(obs => {
      const title = getObservationTitle(obs);
      const value = formatObservationValue(obs) ||
        (Array.isArray(obs?.hasMember) && obs.hasMember.length ? `Panel (${obs.hasMember.length} items)` : 'N/A');
      const date = getObservationDate(obs) || 'Unknown date';
      const status = obs.status || 'unknown';

      return `
        <div class="item">
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="item-value">${escapeHtml(value)}</div>
          <div class="item-meta">
            <span class="status-badge status-${statusClass(status)}">${escapeHtml(status)}</span>
            <span class="item-date">${escapeHtml(date)}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    container.innerHTML = errorHtml('Failed to load observations', error);
  }
}

async function loadConditions() {
  const container = document.getElementById('conditions-list');

  try {
    const bundle = await fetchJson('/api/conditions');
    const conditions = bundle.entry?.map(e => e.resource) || [];

    if (conditions.length === 0) {
      container.innerHTML = '<div class="empty">No conditions found</div>';
      return;
    }

    container.innerHTML = conditions.map(cond => {
      // Name: code, then body site, severity or category, then clinical status.
      let name = getCodeableConceptDisplay(cond.code) || getCodeableConceptDisplay(cond.bodySite?.[0]);
      if (!name) {
        const severity = getCodeableConceptDisplay(cond.severity);
        if (severity) name = `${severity} Condition`;
      }
      if (!name) {
        name = getCodeableConceptDisplay(cond.category?.[0]);
      }
      if (!name) {
        const statusCode = cond.clinicalStatus?.coding?.[0]?.code;
        name = typeof statusCode === 'string' && statusCode
          ? `${statusCode.charAt(0).toUpperCase() + statusCode.slice(1)} Condition`
          : 'Condition';
      }
      const status = cond.clinicalStatus?.coding?.[0]?.code || 'unknown';
      const onset = formatDate(cond.onsetDateTime) || formatDate(cond.onsetPeriod?.start) || 'Unknown';
      const category = cond.category?.[0]?.coding?.[0]?.display || getCodeableConceptDisplay(cond.category?.[0]) || '';

      return `
        <div class="item">
          <div class="item-title">${escapeHtml(name)}</div>
          <div class="item-meta">
            <span class="status-badge status-${status === 'active' ? 'active' : 'completed'}">${escapeHtml(status)}</span>
            ${category ? `<span class="item-date">${escapeHtml(category)}</span>` : ''}
          </div>
          <div class="item-date">Onset: ${escapeHtml(onset)}</div>
        </div>
      `;
    }).join('');
  } catch (error) {
    container.innerHTML = errorHtml('Failed to load conditions', error);
  }
}

async function loadMedications() {
  const container = document.getElementById('medications-list');

  try {
    const bundle = await fetchJson('/api/medications');
    const medications = bundle.entry?.map(e => e.resource) || [];

    if (medications.length === 0) {
      container.innerHTML = emptyHtml(
        bundle.note || 'No medications available for this patient.',
        'To see medications, enable the MedicationRequest API in your'
      );
      return;
    }

    container.innerHTML = medications.map(med => {
      const name = getMedicationRequestName(med) || 'Unknown Medication';
      const status = med.status || 'unknown';
      const dosage = med.dosageInstruction?.[0]?.text || 'Dosage not specified';
      const authored = formatDate(med.authoredOn) || 'Unknown';

      return `
        <div class="item">
          <div class="item-title">${escapeHtml(name)}</div>
          <div class="item-meta">
            <span class="status-badge status-${statusClass(status)}">${escapeHtml(status)}</span>
          </div>
          <div class="item-detail">${escapeHtml(dosage)}</div>
          <div class="item-date">Prescribed: ${escapeHtml(authored)}</div>
        </div>
      `;
    }).join('');
  } catch (error) {
    container.innerHTML = errorHtml('Failed to load medications', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSessionInfo();
  loadPatient();
  loadObservations();
  loadConditions();
  loadMedications();
});
