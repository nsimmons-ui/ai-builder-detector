/* ------------------------------------------------------------------ */
/* AI Builder Detector — Frontend                                       */
/* ------------------------------------------------------------------ */

const BATCH_CHUNK_SIZE = 50;

// ---------------------------------------------------------------------------
// Bucket display config
// ---------------------------------------------------------------------------

const BUCKET_CONFIG = {
  "platform-assisted": {
    icon: "🧱",
    label: "Platform-assisted",
    cls: "bucket-platform-assisted",
    description: "Built with a no-code or AI site builder platform",
  },
  "ai-assisted": {
    icon: "🤖",
    label: "AI-assisted",
    cls: "bucket-ai-assisted",
    description: "Code patterns consistent with an AI coding assistant (Claude, Cursor, Copilot, etc.)",
  },
  "no-ai-signals": {
    icon: "👤",
    label: "No AI signals detected",
    cls: "bucket-no-ai-signals",
    description: "No identifiable AI or platform signals found — likely hand-written",
  },
  "unknown": {
    icon: "❓",
    label: "Unknown",
    cls: "bucket-unknown",
    description: "Could not fetch or analyse the page",
  },
};

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === target);
      t.setAttribute("aria-selected", t.dataset.tab === target ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const isActive = panel.id === `tab-${target}`;
      panel.classList.toggle("active", isActive);
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  });
});

// ---------------------------------------------------------------------------
// Single URL
// ---------------------------------------------------------------------------

const formSingle    = document.getElementById("form-single");
const urlInput      = document.getElementById("url-input");
const singleResult  = document.getElementById("single-result");
const btnCheck      = document.getElementById("btn-check");

formSingle.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  btnCheck.disabled = true;
  showLoading(singleResult, `Analysing ${url}…`);

  try {
    const res = await fetch(`/api/detect?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderSingleResult(singleResult, data);
  } catch (err) {
    showError(singleResult, err.message);
  } finally {
    btnCheck.disabled = false;
  }
});

function renderSingleResult(container, result) {
  container.classList.remove("hidden", "loading");
  container.innerHTML = "";

  if (result.error && result.bucket === "unknown") {
    container.innerHTML = `
      <p style="color:var(--danger);font-size:.9rem">
        Could not fetch <code>${esc(result.url)}</code>: ${esc(result.error)}
      </p>`;
    return;
  }

  const cfg = BUCKET_CONFIG[result.bucket] ?? BUCKET_CONFIG["unknown"];
  const conf = result.bucketConfidence ?? "none";

  // Confidence as a percentage string
  const confPct = { high: "90%+", medium: "~70%", low: "~50%", none: "—" }[conf] ?? "—";

  let subLine = "";
  if (result.bucket === "platform-assisted" && result.platform) {
    subLine = `Platform: <strong>${esc(result.platform)}</strong> &nbsp;·&nbsp; Platform score: ${result.platformScore.toFixed(0)}`;
  } else if (result.bucket === "ai-assisted") {
    subLine = `AI heuristic score: ${result.aiScore.toFixed(0)}`;
  }

  container.innerHTML = `
    <div class="bucket-label ${cfg.cls}">
      <span class="bucket-icon">${cfg.icon}</span>
      <span>${cfg.label}</span>
      <span class="badge badge-${conf}">${conf !== "none" ? conf + " · " + confPct : "n/a"}</span>
    </div>
    <p class="result-sub">${cfg.description}</p>
    ${subLine ? `<p class="result-sub" style="margin-top:.5rem">${subLine}</p>` : ""}
    <p class="result-sub">${esc(result.finalUrl || result.url)}</p>
    ${renderSignalSections(result)}
  `;

  // Wire up signal toggles
  container.querySelectorAll(".signals-toggle").forEach((btn) => {
    const list = btn.nextElementSibling;
    btn.addEventListener("click", () => {
      const open = list.classList.toggle("open");
      const count = btn.dataset.count;
      btn.textContent = open ? `Hide signals ↑` : `Show ${count} signals ↓`;
    });
  });
}

function renderSignalSections(result) {
  const parts = [];

  if (result.platformSignals?.length) {
    parts.push(`
      <div class="signals-section">
        <div class="signals-section-label">Platform signals</div>
        <button class="signals-toggle" data-count="${result.platformSignals.length}">
          Show ${result.platformSignals.length} signals ↓
        </button>
        <div class="signals-list">${renderSignals(result.platformSignals)}</div>
      </div>
    `);
  }

  if (result.aiSignals?.length) {
    parts.push(`
      <div class="signals-section">
        <div class="signals-section-label">AI heuristic signals</div>
        <button class="signals-toggle" data-count="${result.aiSignals.length}">
          Show ${result.aiSignals.length} signals ↓
        </button>
        <div class="signals-list">${renderSignals(result.aiSignals)}</div>
      </div>
    `);
  }

  return parts.join("");
}

function renderSignals(signals) {
  return signals.map((s) => `
    <div class="signal-row">
      <span class="signal-conf ${s.confidence}">${s.confidence.toUpperCase()}</span>
      <span class="signal-desc">${esc(s.description)}</span>
      ${s.matchedValue ? `<span class="signal-match">${esc(s.matchedValue)}</span>` : ""}
    </div>
  `).join("");
}

function showLoading(container, msg) {
  container.classList.remove("hidden");
  container.classList.add("loading");
  container.innerHTML = `<div class="spinner"></div><span>${esc(msg)}</span>`;
}

function showError(container, msg) {
  container.classList.remove("hidden", "loading");
  container.innerHTML = `<p style="color:var(--danger)">${esc(msg)}</p>`;
}

// ---------------------------------------------------------------------------
// CSV Upload
// ---------------------------------------------------------------------------

const uploadZone    = document.getElementById("upload-zone");
const fileInput     = document.getElementById("file-input");
const fileMeta      = document.getElementById("file-meta");
const fileNameEl    = document.getElementById("file-name");
const fileRowsEl    = document.getElementById("file-rows");
const btnClearFile  = document.getElementById("btn-clear-file");
const urlColInput   = document.getElementById("url-col-input");
const btnBatch      = document.getElementById("btn-batch");
const batchProgress = document.getElementById("batch-progress");
const progressBar   = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const batchResult   = document.getElementById("batch-result");

let csvParsed = null;

uploadZone.addEventListener("click", () => fileInput.click());
uploadZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

btnClearFile.addEventListener("click", clearFile);

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    csvParsed = parseCSV(text);
    fileNameEl.textContent = file.name;
    fileRowsEl.textContent = `${csvParsed.rows.length} rows`;
    fileMeta.classList.remove("hidden");
    btnBatch.disabled = csvParsed.rows.length === 0;
    batchResult.classList.add("hidden");
    batchProgress.classList.add("hidden");
  };
  reader.readAsText(file);
}

function clearFile() {
  csvParsed = null;
  fileInput.value = "";
  fileMeta.classList.add("hidden");
  btnBatch.disabled = true;
  batchResult.classList.add("hidden");
  batchProgress.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Run batch
// ---------------------------------------------------------------------------

btnBatch.addEventListener("click", async () => {
  if (!csvParsed) return;

  btnBatch.disabled = true;
  batchResult.classList.add("hidden");
  batchProgress.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressLabel.textContent = "Starting…";

  const urlCol = urlColInput.value.trim() || autoDetectUrlColumn(csvParsed.headers);
  if (!urlCol) {
    showBatchError(`Could not auto-detect URL column. Available: ${csvParsed.headers.join(", ")}. Enter the column name above.`);
    btnBatch.disabled = false;
    return;
  }

  const allRows = csvParsed.rows;
  const chunks = chunkArray(allRows, BATCH_CHUNK_SIZE);
  const allResults = [];
  let completed = 0;

  try {
    for (const chunk of chunks) {
      const chunkCsv = rowsToCSV(csvParsed.headers, chunk);
      const form = new FormData();
      form.append("file", new Blob([chunkCsv], { type: "text/csv" }), "batch.csv");
      if (urlColInput.value.trim()) form.append("url_column", urlColInput.value.trim());

      const res = await fetch("/api/batch", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const csvText = await res.text();
      const parsed = parseCSV(csvText);
      allResults.push(...parsed.rows);

      completed += chunk.length;
      const pct = Math.round((completed / allRows.length) * 100);
      progressBar.style.width = `${pct}%`;
      progressLabel.textContent = `${completed} / ${allRows.length} rows processed…`;
    }

    progressBar.style.width = "100%";
    progressLabel.textContent = "Done!";
    renderBatchResults(allResults, csvParsed.headers);
  } catch (err) {
    showBatchError(err.message);
  } finally {
    btnBatch.disabled = false;
  }
});

function showBatchError(msg) {
  batchProgress.classList.add("hidden");
  batchResult.classList.remove("hidden");
  batchResult.innerHTML = `<p style="color:var(--danger);font-size:.9rem">${esc(msg)}</p>`;
}

function renderBatchResults(rows, originalHeaders) {
  batchResult.classList.remove("hidden");

  // Tally buckets
  const tally = { "platform-assisted": 0, "ai-assisted": 0, "no-ai-signals": 0, "unknown": 0 };
  for (const r of rows) tally[r.ai_bucket] = (tally[r.ai_bucket] ?? 0) + 1;

  const allHeaders = [
    ...originalHeaders,
    ...["ai_bucket","ai_bucket_confidence","ai_platform","ai_platform_score","ai_score","ai_error"]
      .filter((h) => !originalHeaders.includes(h)),
  ];
  const csvContent = rowsToCSV(allHeaders, rows);
  const blob = new Blob([csvContent], { type: "text/csv" });
  const downloadUrl = URL.createObjectURL(blob);
  const urlCol = autoDetectUrlColumn(originalHeaders) || originalHeaders[0];

  batchResult.innerHTML = `
    <div class="batch-summary">
      <span><strong>${rows.length}</strong> total</span>
      <span style="color:#a78bfa"><strong>${tally["platform-assisted"]}</strong> platform</span>
      <span style="color:#34d399"><strong>${tally["ai-assisted"]}</strong> AI-assisted</span>
      <span style="color:var(--muted)"><strong>${tally["no-ai-signals"]}</strong> no signals</span>
      ${tally["unknown"] ? `<span style="color:var(--danger)"><strong>${tally["unknown"]}</strong> unknown</span>` : ""}
    </div>
    <a class="download-btn" href="${downloadUrl}" download="results.csv">⬇ Download results.csv</a>
    <div class="results-table-wrap">
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th>Bucket</th>
            <th>Confidence</th>
            <th>Platform</th>
            <th>AI score</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
            const cfg = BUCKET_CONFIG[r.ai_bucket] ?? BUCKET_CONFIG["unknown"];
            return `
              <tr>
                <td class="td-url" title="${esc(r[urlCol] ?? "")}">${esc(truncate(r[urlCol] ?? "", 40))}</td>
                <td class="${cfg.cls}" style="font-weight:600">${cfg.icon} ${esc(cfg.label)}</td>
                <td>${r.ai_bucket_confidence && r.ai_bucket_confidence !== "none"
                  ? `<span class="badge badge-${esc(r.ai_bucket_confidence)}">${esc(r.ai_bucket_confidence)}</span>`
                  : `<span style="color:var(--muted)">—</span>`}
                </td>
                <td>${r.ai_platform || `<span style="color:var(--muted)">—</span>`}</td>
                <td>${r.ai_score || "—"}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitRow(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}

function splitRow(line) {
  const fields = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      fields.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function rowsToCSV(headers, rows) {
  const escape = (v) => {
    const s = String(v ?? "");
    return (s.includes(",") || s.includes('"') || s.includes("\n"))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h] ?? "")).join(","));
  return lines.join("\r\n");
}

const URL_CANDIDATES = ["url","urls","website","websites","domain","domains","link","links","site","sites","href"];

function autoDetectUrlColumn(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const c of URL_CANDIDATES) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + "…" : str;
}
