/**
 * Escapes text for safe use in HTML (element content and quoted attribute values).
 * Use it for every value that comes from the server or from FHIR data.
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Lets the Node.js tests load this file. Browsers skip this part.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml };
}
