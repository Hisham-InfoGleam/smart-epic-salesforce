// Start page: show the demo button only when the server runs with DEMO_MODE=true.
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const demoOption = document.getElementById('demo-option');
  try {
    const response = await fetch('/api/mode', { headers: { Accept: 'application/json' } });
    const mode = await response.json();
    if (mode && mode.demoMode === true) {
      demoOption.hidden = false;
    }
  } catch (error) {
    // Keep the demo button hidden when the mode cannot be read.
  }
});
