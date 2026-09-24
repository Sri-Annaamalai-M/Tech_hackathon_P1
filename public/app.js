const scanList = document.querySelector('#scanList');
const scanDetails = document.querySelector('#scanDetails');
const trendList = document.querySelector('#trendList');
const health = document.querySelector('#health');
const refreshButton = document.querySelector('#refreshButton');

let selectedScanId = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '#';
  } catch {
    return '#';
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || `Request failed: ${response.status}`);
  }

  return response.json();
}

function formatDate(value) {
  if (!value) return 'Pending';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function severityClass(severity) {
  return ['critical', 'high', 'medium', 'low', 'info'].includes(severity) ? severity : 'info';
}

async function loadHealth() {
  try {
    const result = await api('/api/health');
    health.textContent = result.database === 'connected' ? 'Database connected' : 'Database degraded';
  } catch (error) {
    health.textContent = 'Database unavailable';
  }
}

function renderScans(scans) {
  if (!scans.length) {
    scanList.innerHTML = '<div class="empty-state">No scans yet. Send a GitHub pull_request webhook to begin.</div>';
    return;
  }

  scanList.innerHTML = scans
    .map(
      (scan) => `
        <button class="scan-item ${scan.id === selectedScanId ? 'active' : ''}" data-scan-id="${scan.id}">
          <strong>${escapeHtml(scan.repository)} #${escapeHtml(scan.pr_number)}</strong>
          <span>${escapeHtml(scan.pr_title)}</span>
          <span class="muted">By ${escapeHtml(scan.author_login)} · ${formatDate(scan.created_at)}</span>
          <span class="scan-meta">
            <span class="badge risk">Risk ${scan.risk_score}/100</span>
            <span class="badge">${escapeHtml(scan.status)}</span>
            <span class="badge">${scan.finding_count} findings</span>
            <span class="badge">${scan.severe_count} severe</span>
          </span>
        </button>
      `
    )
    .join('');
}

function renderDetails(scan) {
  scanDetails.className = 'details-content';
  scanDetails.innerHTML = `
    <div class="details-header">
      <span class="badge risk">Risk ${scan.risk_score}/100</span>
      <h2>${escapeHtml(scan.repository)} #${escapeHtml(scan.pr_number)}: ${escapeHtml(scan.pr_title)}</h2>
      <p class="muted">${escapeHtml(scan.summary || scan.error_message || 'No summary available yet.')}</p>
      <p><a href="${safeUrl(scan.pr_url)}" target="_blank" rel="noreferrer">Open pull request</a></p>
    </div>
    <div class="findings">
      ${
        scan.findings.length
          ? scan.findings.map(renderFinding).join('')
          : '<div class="empty-state">No findings stored for this scan.</div>'
      }
    </div>
  `;

  scanDetails.querySelectorAll('select[data-finding-id]').forEach((select) => {
    select.addEventListener('change', async () => {
      await api(`/api/findings/${select.dataset.findingId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: select.value })
      });
    });
  });
}

function renderFinding(finding) {
  const location = finding.file_path
    ? `${finding.file_path}${finding.line_start ? `:${finding.line_start}` : ''}`
    : 'PR diff';

  return `
    <article class="finding">
      <div class="finding-meta">
        <span class="badge ${severityClass(finding.severity)}">${escapeHtml(finding.severity.toUpperCase())}</span>
        <span class="badge">${escapeHtml(finding.category)}</span>
        <span class="badge">${Math.round(Number(finding.confidence) * 100)}% confidence</span>
      </div>
      <h3>${escapeHtml(finding.title)}</h3>
      <p><strong>Location:</strong> ${escapeHtml(location)}</p>
      ${finding.evidence ? `<p><strong>Evidence:</strong> ${escapeHtml(finding.evidence)}</p>` : ''}
      <p><strong>Fix:</strong> ${escapeHtml(finding.recommendation)}</p>
      <select data-finding-id="${finding.id}" aria-label="Finding status">
        ${['open', 'fixed', 'accepted_risk', 'false_positive']
          .map((status) => `<option value="${status}" ${finding.status === status ? 'selected' : ''}>${status}</option>`)
          .join('')}
      </select>
    </article>
  `;
}

function renderTrends(trends) {
  if (!trends.length) {
    trendList.innerHTML = '<div class="empty-state">Trend data appears after completed scans.</div>';
    return;
  }

  trendList.innerHTML = trends
    .map(
      (trend) => `
        <div class="trend-row">
          <span>
            <strong>${escapeHtml(trend.category)}</strong><br />
            <span class="muted">${escapeHtml(trend.trend_date.slice(0, 10))} · ${escapeHtml(trend.severity)}</span>
          </span>
          <span class="badge">${trend.finding_count}</span>
        </div>
      `
    )
    .join('');
}

async function loadScans() {
  try {
    const [{ data: scans }, { data: trends }] = await Promise.all([api('/api/scans'), api('/api/trends')]);
    renderScans(scans);
    renderTrends(trends);
  } catch (error) {
    scanList.innerHTML = `<div class="error-state">${error.message}</div>`;
  }
}

async function loadScanDetails(scanId) {
  selectedScanId = scanId;
  const { data } = await api(`/api/scans/${scanId}`);
  renderDetails(data);
  await loadScans();
}

scanList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-scan-id]');
  if (button) {
    loadScanDetails(button.dataset.scanId).catch((error) => {
      scanDetails.className = 'error-state';
      scanDetails.textContent = error.message;
    });
  }
});

refreshButton.addEventListener('click', () => {
  loadScans();
});

await loadHealth();
await loadScans();
