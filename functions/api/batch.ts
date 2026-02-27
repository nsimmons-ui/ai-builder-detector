import { detectUrl, DetectionResult } from "../_detector";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: CORS });

export const onRequestPost: PagesFunction = async (ctx) => {
  const contentType = ctx.request.headers.get("content-type") ?? "";

  // -------------------------------------------------------------------------
  // Parse input: accept either a CSV file upload (multipart) or JSON body
  // -------------------------------------------------------------------------
  let rows: Record<string, string>[] = [];
  let urlColumn = "";

  if (contentType.includes("multipart/form-data")) {
    const form = await ctx.request.formData();
    const file = form.get("file");
    const colOverride = (form.get("url_column") as string | null) ?? "";

    if (!file || typeof file === "string") {
      return Response.json({ error: "Expected a 'file' field in the form" }, { status: 400, headers: CORS });
    }

    const text = await (file as File).text();
    const parsed = parseCSV(text);
    if (!parsed.rows.length) {
      return Response.json({ error: "CSV has no data rows" }, { status: 400, headers: CORS });
    }

    try {
      urlColumn = findUrlColumn(parsed.headers, colOverride);
    } catch (e: unknown) {
      return Response.json({ error: (e as Error).message }, { status: 400, headers: CORS });
    }
    rows = parsed.rows;

  } else {
    // JSON body: { urls: string[] }
    let body: { urls?: string[] };
    try {
      body = await ctx.request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }
    if (!Array.isArray(body.urls) || !body.urls.length) {
      return Response.json({ error: "Expected { urls: string[] } in JSON body" }, { status: 400, headers: CORS });
    }
    rows = body.urls.map((u) => ({ url: u }));
    urlColumn = "url";
  }

  // CF Workers have a CPU time limit — cap batch size to avoid timeouts.
  // For larger batches the client should chunk requests.
  const MAX_BATCH = 50;
  if (rows.length > MAX_BATCH) {
    return Response.json(
      { error: `Batch too large. Max ${MAX_BATCH} rows per request. Split your CSV into chunks.` },
      { status: 413, headers: CORS },
    );
  }

  // -------------------------------------------------------------------------
  // Run detection concurrently (Workers don't have thread limits but do have
  // CPU wall-clock limits, so we fan out with Promise.all)
  // -------------------------------------------------------------------------
  const results: Array<DetectionResult & { originalRow: Record<string, string> }> = await Promise.all(
    rows.map(async (row) => {
      const url = (row[urlColumn] ?? "").trim();
      if (!url) {
        return {
          url: "",
          finalUrl: "",
          bucket: "unknown" as const,
          bucketConfidence: "none" as const,
          platform: null,
          platformScore: 0,
          platformSignals: [],
          allPlatformScores: {},
          aiScore: 0,
          aiSignals: [],
          error: "empty_url",
          originalRow: row,
        };
      }
      const result = await detectUrl(url);
      return { ...result, originalRow: row };
    }),
  );

  // -------------------------------------------------------------------------
  // Return: if the request came from a CSV upload, respond with a CSV.
  // If it came from a JSON body, respond with JSON.
  // -------------------------------------------------------------------------
  const acceptCsv = contentType.includes("multipart/form-data");

  if (acceptCsv) {
    // Build output CSV: original columns + result columns
    const originalHeaders = Object.keys(rows[0] ?? {});
    const resultHeaders = ["ai_bucket", "ai_bucket_confidence", "ai_platform", "ai_platform_score", "ai_score", "ai_error"];
    const allHeaders = [...originalHeaders, ...resultHeaders.filter((h) => !originalHeaders.includes(h))];

    const csvLines: string[] = [allHeaders.map(csvEscape).join(",")];
    for (const r of results) {
      const outRow: Record<string, string> = { ...r.originalRow };
      outRow["ai_bucket"]             = r.bucket;
      outRow["ai_bucket_confidence"]  = r.bucketConfidence;
      outRow["ai_platform"]           = r.platform ?? "";
      outRow["ai_platform_score"]     = r.platformScore.toFixed(1);
      outRow["ai_score"]              = r.aiScore.toFixed(1);
      outRow["ai_error"]              = r.error ?? "";
      csvLines.push(allHeaders.map((h) => csvEscape(outRow[h] ?? "")).join(","));
    }

    return new Response(csvLines.join("\r\n"), {
      headers: {
        ...CORS,
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=\"results.csv\"",
      },
    });
  }

  return Response.json({ results }, { headers: CORS });
};

// ---------------------------------------------------------------------------
// CSV utilities
// ---------------------------------------------------------------------------

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (!lines.length) return { headers: [], rows: [] };

  const headers = splitCSVRow(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }

  return { headers, rows };
}

function splitCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

const URL_COLUMN_CANDIDATES = [
  "url", "urls", "website", "websites",
  "domain", "domains", "link", "links",
  "site", "sites", "href",
];

function findUrlColumn(headers: string[], override: string): string {
  if (override) {
    const found = headers.find((h) => h.toLowerCase() === override.toLowerCase());
    if (found) return found;
    throw new Error(`Column '${override}' not found. Available: ${headers.join(", ")}`);
  }
  const lower = headers.map((h) => h.toLowerCase());
  for (const c of URL_COLUMN_CANDIDATES) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return headers[idx];
  }
  throw new Error(`Could not auto-detect URL column. Available: ${headers.join(", ")}. Use the 'url_column' field to specify it.`);
}
