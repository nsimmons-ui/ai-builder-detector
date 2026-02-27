/**
 * AI Builder Detector — core logic (TypeScript port)
 * Used by both /api/detect and /api/batch Pages Functions.
 *
 * Four output buckets:
 *   platform-assisted  — built with a no-code/AI site builder (Framer, Webflow, Wix, etc.)
 *   ai-assisted        — built with an AI coding assistant (Claude, Cursor, Copilot, v0, etc.)
 *   no-ai-signals      — no signals found; likely human-written
 *   unknown            — could not fetch or analyse the page
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Signal {
  category: string;
  description: string;
  confidence: "high" | "medium" | "low";
  matchedValue: string;
}

export type Bucket = "platform-assisted" | "ai-assisted" | "no-ai-signals" | "unknown";

export interface DetectionResult {
  url: string;
  finalUrl: string;
  // Four-bucket classification
  bucket: Bucket;
  bucketConfidence: "high" | "medium" | "low" | "none";
  // Platform detector fields (populated when bucket === "platform-assisted")
  platform: string | null;
  platformScore: number;
  platformSignals: Signal[];
  allPlatformScores: Record<string, number>;
  // AI heuristic fields (populated when bucket === "ai-assisted")
  aiScore: number;
  aiSignals: Signal[];
  error: string | null;
}

type PatternEntry = [pattern: string, confidence: "high" | "medium" | "low", description: string];

interface PlatformFingerprint {
  hostname?: PatternEntry[];
  http_header?: PatternEntry[];
  meta_tag?: PatternEntry[];
  html_comment?: PatternEntry[];
  data_attribute?: PatternEntry[];
  css_class?: PatternEntry[];
  css_variable?: PatternEntry[];
  js_global?: PatternEntry[];
  dom_id?: PatternEntry[];
  script_content?: PatternEntry[];
  script_src?: PatternEntry[];
  link_href?: PatternEntry[];
  img_src?: PatternEntry[];
  font?: PatternEntry[];
}

// ---------------------------------------------------------------------------
// Platform fingerprints (existing)
// ---------------------------------------------------------------------------

const FINGERPRINTS: Record<string, PlatformFingerprint> = {

  Framer: {
    hostname: [
      ["\\.framer\\.website$", "high", "Framer subdomain (.framer.website)"],
      ["\\.framer\\.app$", "high", "Framer subdomain (.framer.app)"],
      ["\\.framer\\.ai$", "high", "Framer subdomain (.framer.ai)"],
    ],
    http_header: [
      ["^Framer/", "high", "Framer Server header"],
      ["^framer$", "high", "Framer Server header (lowercase)"],
    ],
    meta_tag: [
      ["<meta[^>]+name=[\"']generator[\"'][^>]+content=[\"']Framer", "high", "Framer generator meta tag"],
      ["<meta[^>]+content=[\"']Framer[^\"']*[\"'][^>]+name=[\"']generator[\"']", "high", "Framer generator meta tag (reversed)"],
    ],
    html_comment: [
      ["Built with Framer", "high", "Framer build comment"],
      ["framer\\.com", "medium", "Framer URL in HTML comment"],
    ],
    data_attribute: [
      ["data-framer-component-type", "high", "Framer component attribute"],
      ["data-framer-stack-", "high", "Framer stack layout attribute"],
      ["data-framer-appear-id", "high", "Framer appear animation attribute"],
      ["data-framer-name", "medium", "Framer name attribute"],
    ],
    css_class: [
      ["\\bframer-[a-zA-Z0-9]{4,10}\\b", "medium", "Framer generated CSS class"],
    ],
    css_variable: [
      ["--framer-font-family", "high", "Framer CSS font variable"],
      ["--framer-text-color", "high", "Framer CSS text color variable"],
      ["--framer-link-", "high", "Framer CSS link variable"],
    ],
    dom_id: [
      ["id=[\"']__framer-badge-container[\"']", "high", "Framer badge (free tier)"],
    ],
    script_src: [
      ["framerusercontent\\.com", "high", "Framer CDN (framerusercontent.com)"],
      ["framerstatic\\.com", "high", "Framer static CDN"],
      ["events\\.framer\\.com", "high", "Framer analytics endpoint"],
    ],
    link_href: [
      ["framerusercontent\\.com", "high", "Framer CDN in stylesheet"],
    ],
  },

  Webflow: {
    hostname: [
      ["\\.webflow\\.io$", "high", "Webflow subdomain (.webflow.io)"],
    ],
    html_comment: [
      ["This site was created in Webflow", "high", "Webflow build comment"],
      ["webflow\\.com", "medium", "Webflow URL in HTML comment"],
    ],
    meta_tag: [
      ["<meta[^>]+content=[\"']Webflow[\"'][^>]+name=[\"']generator[\"']", "high", "Webflow generator meta tag"],
      ["<meta[^>]+name=[\"']generator[\"'][^>]+content=[\"']Webflow[\"']", "high", "Webflow generator meta tag (reversed)"],
    ],
    data_attribute: [
      ["data-wf-domain", "high", "Webflow domain attribute"],
      ["data-wf-page", "high", "Webflow page ID attribute"],
      ["data-wf-site", "high", "Webflow site ID attribute"],
      ["data-wf-experiences", "high", "Webflow experiences attribute"],
      ["data-wf--button--variant", "high", "Webflow button component attribute"],
      ["data-wf--nav--variant", "high", "Webflow nav component attribute"],
    ],
    css_class: [
      ["\\bw-mod-js\\b", "high", "Webflow w-mod-js class"],
      ["\\bw-richtext\\b", "high", "Webflow rich text class"],
      ["\\bw-embed\\b", "high", "Webflow embed class"],
      ["\\bw-dyn-list\\b", "high", "Webflow dynamic list class"],
      ["\\bw-dyn-item\\b", "high", "Webflow dynamic item class"],
      ["\\bw-nav\\b", "high", "Webflow nav class"],
      ["\\bw-container\\b", "medium", "Webflow container class"],
    ],
    css_variable: [
      ["--_color---primary--webflow-blue", "high", "Webflow brand CSS variable"],
      ["--wst-button-", "high", "Webflow style token button variable"],
    ],
    js_global: [
      ["window\\.wf\\b", "high", "Webflow JS global (window.wf)"],
      ["window\\.webflowHost", "high", "Webflow JS host global"],
      ["Webflow\\.push", "high", "Webflow.push() JS call"],
    ],
    script_src: [
      ["cdn\\.prod\\.website-files\\.com", "high", "Webflow production CDN"],
      ["d3e54v103j8qbb\\.cloudfront\\.net", "high", "Webflow CloudFront CDN"],
    ],
    link_href: [
      ["cdn\\.prod\\.website-files\\.com", "high", "Webflow CDN stylesheet"],
      ["\\.webflow\\.[a-f0-9]+-[a-f0-9]+\\.min\\.css", "high", "Webflow generated CSS filename"],
    ],
  },

  Bolt: {
    hostname: [
      ["\\.bolt\\.new$", "high", "Bolt preview subdomain (.bolt.new)"],
      ["\\.stackblitz\\.io$", "high", "StackBlitz preview (Bolt host)"],
    ],
    meta_tag: [
      ["<meta[^>]+name=[\"']bolt-version[\"']", "high", "Bolt version meta tag"],
    ],
    html_comment: [
      ["bolt\\.new", "high", "bolt.new URL in HTML comment"],
      ["<!--remix-island-start-->", "medium", "Remix island comment (Bolt uses Remix)"],
    ],
    css_variable: [
      ["--bolt-elements-", "high", "Bolt CSS element variable"],
      ["--bolt-ds-", "high", "Bolt design system CSS variable"],
    ],
    js_global: [
      ["window\\.__allowDOMMutations", "high", "Bolt JS global (__allowDOMMutations)"],
      ["window\\.__loadingPrompt", "high", "Bolt JS global (__loadingPrompt)"],
      ["\"bolt_theme\"", "medium", "Bolt theme localStorage key"],
    ],
  },

  "v0 (Vercel)": {
    hostname: [
      ["\\.v0\\.dev$", "high", "v0 subdomain (.v0.dev)"],
      ["\\.v0\\.app$", "high", "v0 subdomain (.v0.app)"],
      ["\\.vusercontent\\.net$", "high", "v0 vusercontent preview subdomain"],
    ],
    data_attribute: [
      ["data-dpl-id=[\"']dpl_[a-zA-Z0-9]+[\"']", "high", "v0/Vercel deployment ID attribute"],
    ],
    script_src: [
      ["/chat-static/_next/static/", "high", "v0 Next.js static bundle path"],
      ["blobs\\.vusercontent\\.net", "high", "v0 blob storage CDN"],
      ["generated\\.vusercontent\\.net", "high", "v0 generated asset CDN"],
    ],
    link_href: [
      ["/chat-static/_next/static/", "high", "v0 Next.js static CSS path"],
      ["vusercontent\\.net", "high", "v0 CDN in stylesheet"],
    ],
    css_class: [
      ["\\bgeist\\b", "medium", "Geist font class (Vercel/v0 proprietary)"],
    ],
  },

  Wix: {
    hostname: [
      ["\\.wix\\.com$", "high", "Wix subdomain (.wix.com)"],
      ["\\.wixsite\\.com$", "high", "Wix subdomain (.wixsite.com)"],
    ],
    meta_tag: [
      ["<meta[^>]+name=[\"']generator[\"'][^>]+content=[\"']Wix\\.com", "high", "Wix generator meta tag"],
      ["<meta[^>]+content=[\"']Wix\\.com[^\"']*[\"'][^>]+name=[\"']generator[\"']", "high", "Wix generator meta tag (reversed)"],
    ],
    dom_id: [
      ["id=[\"']SITE_CONTAINER[\"']", "high", "Wix SITE_CONTAINER element"],
      ["id=[\"']SITE_HEADER[\"']", "high", "Wix SITE_HEADER element"],
      ["id=[\"']SITE_FOOTER[\"']", "high", "Wix SITE_FOOTER element"],
      ["id=[\"']WIX_ADS[\"']", "high", "Wix ads element (free tier)"],
      ["id=[\"']masterPage[\"']", "high", "Wix masterPage element"],
    ],
    script_content: [
      ["wix-thunderbolt", "high", "Wix Thunderbolt renderer reference"],
      ["\"applicationId\"\\s*:\\s*\"wix-", "high", "Wix application ID in JSON"],
    ],
    css_variable: [
      ["--color_\\d+\\s*:", "medium", "Wix numbered color CSS variable"],
      ["--font_\\d+\\s*:", "medium", "Wix numbered font CSS variable"],
      ["--wix-ads-height", "high", "Wix ads height CSS variable"],
    ],
    script_src: [
      ["static\\.parastorage\\.com", "high", "Wix parastorage CDN"],
      ["static\\.wixstatic\\.com", "high", "Wix static CDN"],
      ["siteassets\\.parastorage\\.com", "high", "Wix site assets CDN"],
    ],
    link_href: [
      ["static\\.parastorage\\.com", "high", "Wix parastorage CDN stylesheet"],
      ["static\\.wixstatic\\.com", "high", "Wix static CDN stylesheet"],
    ],
  },

  Lovable: {
    hostname: [
      ["\\.lovable\\.app$", "high", "Lovable preview subdomain (.lovable.app)"],
      ["\\.gptengineer\\.app$", "high", "Lovable legacy subdomain (.gptengineer.app)"],
    ],
    meta_tag: [
      ["<meta[^>]+name=[\"']generator[\"'][^>]+content=[\"']Lovable", "high", "Lovable generator meta tag"],
    ],
    dom_id: [
      ["id=[\"']lovable-badge[\"']", "high", "Lovable badge (free tier)"],
    ],
    html_comment: [
      ["[Ll]ovable", "medium", "Lovable mention in HTML comment"],
    ],
    js_global: [
      ["window\\.__lovable", "high", "Lovable JS global"],
    ],
    script_src: [
      ["/lovable-uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z]+", "high", "Lovable UUID uploads asset"],
    ],
    img_src: [
      ["/lovable-uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z]+", "high", "Lovable UUID uploads image"],
    ],
  },

  Squarespace: {
    hostname: [
      ["\\.squarespace\\.com$", "high", "Squarespace subdomain (.squarespace.com)"],
    ],
    http_header: [
      ["Squarespace", "high", "Squarespace server header"],
    ],
    meta_tag: [
      ["<meta[^>]+name=[\"']generator[\"'][^>]+content=[\"']Squarespace", "high", "Squarespace generator meta tag"],
      ["<meta[^>]+content=[\"']Squarespace[^\"']*[\"'][^>]+name=[\"']generator[\"']", "high", "Squarespace generator meta tag (reversed)"],
    ],
    html_comment: [
      ["Squarespace", "medium", "Squarespace mention in HTML comment"],
    ],
    js_global: [
      ["window\\.SQUARESPACE_ROLLUPS", "high", "Squarespace JS rollups global"],
      ["Static\\.SQUARESPACE_CONTEXT", "high", "Squarespace context global"],
      ["Y\\.Squarespace", "high", "Squarespace YUI namespace"],
    ],
    css_class: [
      ["\\bsqs-block\\b", "high", "Squarespace block CSS class"],
      ["\\bsqs-layout\\b", "high", "Squarespace layout CSS class"],
      ["\\bsqs-col-wrapper\\b", "high", "Squarespace col wrapper CSS class"],
    ],
    script_src: [
      ["static\\d*\\.squarespace\\.com", "high", "Squarespace static CDN"],
      ["squarespace\\.com/universal/scripts", "high", "Squarespace universal scripts"],
    ],
    link_href: [
      ["static\\d*\\.squarespace\\.com", "high", "Squarespace CDN stylesheet"],
    ],
  },

  "GitHub Pages": {
    hostname: [
      ["\\.github\\.io$", "high", "GitHub Pages subdomain (.github.io)"],
    ],
    http_header: [
      ["GitHub\\.com", "high", "GitHub.com server header"],
    ],
    html_comment: [
      ["[Gg]it[Hh]ub\\s*[Cc]opilot|[Cc]opilot\\s*[Ww]orkspace", "low", "GitHub Copilot mention in HTML comment"],
    ],
  },

  "Cursor AI": {
    html_comment: [
      ["[Cc]ursor\\s*[Aa][Ii]|built\\s+with\\s+[Cc]ursor", "low", "Cursor AI mention in HTML comment"],
    ],
    meta_tag: [
      ["<meta[^>]+content=[\"'][Cc]ursor\\s*[Aa][Ii][\"']", "low", "Cursor AI meta tag"],
    ],
  },
};

// ---------------------------------------------------------------------------
// AI heuristic signals
// ---------------------------------------------------------------------------

// Over-commenter patterns: tutorial-style comments that explain obvious code
const OVER_COMMENTER_PATTERNS = [
  // JS single-line
  /\/\/\s*(This function|Here we|Loop through|Initialize the|Check if|This will|We need to|Now we|First we|Get the|Set the|Add the|Create the|Update the|Handle the|This is (a|the)|This component|This page|This renders|The following)/i,
  // JS block comments on trivial things
  /\/\*\s*(This function|Initialize|Loop|Handle|Create|Update|Get|Set|Add)\b/i,
  // HTML comments explaining layout
  /<!--\s*(This section|This is the|Navigation|Header section|Footer section|Main content|Hero section|This div|Wrapper for|Container for)/i,
];

// shadcn/ui signatures: very specific class combos generated by shadcn components
const SHADCN_PATTERNS = [
  // Card component
  /rounded-lg border bg-card text-card-foreground shadow/,
  // Button variants
  /inline-flex items-center justify-center (gap-2 )?whitespace-nowrap rounded-md text-sm font-medium/,
  // Badge
  /inline-flex items-center rounded-full border px-2\.5 py-0\.5 text-xs font-semibold/,
  // Input
  /flex h-(?:9|10) w-full rounded-md border border-input bg-background px-3 py-[12]/,
  // Dialog overlay
  /fixed inset-0 z-50 bg-black\/80/,
  // Sheet / sidebar
  /fixed inset-y-0 z-50 flex (h-full )?flex-col/,
  // cn() utility function signature
  /function cn\([^)]*\)\s*\{[\s\S]{0,100}clsx|twMerge/,
  // @radix-ui import in bundle
  /@radix-ui\//,
];

// Tailwind + Vite + React SPA combo
const TAILWIND_PATTERNS = [
  // Tailwind utility combos typical of AI output (verbose, stacked)
  /class(?:Name)?="[^"]*(?:flex|grid)[^"]*(?:items-center|justify-between)[^"]*(?:gap-|space-)[^"]*"/,
  // Tailwind responsive + dark mode prefixes (AI loves to add these by default)
  /class(?:Name)?="[^"]*(?:sm:|md:|lg:|xl:|dark:){3,}[^"]*"/,
  // Tailwind color scale pattern (AI defaults to specific shades)
  /(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|blue|indigo|violet|purple)-(?:50|100|200|300|400|500|600|700|800|900|950)/,
];

const VITE_PATTERNS = [
  // Vite default output: /assets/index-[hash].js
  /\/assets\/index-[A-Za-z0-9_-]{6,12}\.js/,
  // Vite CSS chunk
  /\/assets\/index-[A-Za-z0-9_-]{6,12}\.css/,
];

const REACT_SPA_PATTERNS = [
  // Standard React root mount point
  /<div id="root">\s*<\/div>/,
  // React root with empty content (SPA)
  /<div id="app">\s*<\/div>/,
];

// Lucide icon signatures (SVG paths used by lucide-react)
const LUCIDE_PATTERNS = [
  // Lucide bundle name in script src
  /lucide[-_]react/i,
  // Lucide SVG viewBox + common path patterns
  /lucide/i,
  // Two common Lucide icon path segments that appear in inlined SVGs
  /M\s*12\s+2[Cc]\s*6\.477\s+2/,   // circle-based icons
  /M\s*3\s+12[Hh]\s*21/,           // arrow-right and similar
];

// Hallucinated / placeholder link patterns
const PLACEHOLDER_LINK_PATTERNS = [
  /href=["']https?:\/\/(?:www\.)?example\.com["']/gi,
  /href=["']https?:\/\/(?:www\.)?yourdomain\.com["']/gi,
  /href=["']https?:\/\/(?:www\.)?placeholder\.com["']/gi,
  /action=["']\/api\/your[-_]endpoint["']/gi,
  /["']https?:\/\/api\.example\.com\//gi,
  /href=["']mailto:you@example\.com["']/gi,
  /href=["']mailto:email@yourdomain\.com["']/gi,
  /href=["']mailto:info@yourcompany\.com["']/gi,
];

// Generic AI naming conventions: numbered suffixes on wrapper/container names
const GENERIC_NAMING_PATTERNS = [
  // class="container-1", class="wrapper-2", class="section-3", class="block-4"
  /class(?:Name)?="[^"]*\b(?:container|wrapper|section|block|div|col|row|item|card|box|panel|element|component)-\d+\b/gi,
  // id="container-1" etc
  /id="[^"]*\b(?:container|wrapper|section|block|div)-\d+\b/gi,
  // data-block, data-wrapper, data-section (Webflow already covered separately)
  /\bdata-(?:block|wrapper|element|component)="\d*"/gi,
];

// Hosting platform signals (Option B)
const PROTOTYPE_HOSTING_HOSTNAMES = [
  /\.vercel\.app$/i,
  /\.netlify\.app$/i,
  /\.pages\.dev$/i,    // Cloudflare Pages
  /\.onrender\.com$/i,
  /\.fly\.dev$/i,
  /\.railway\.app$/i,
  /\.up\.railway\.app$/i,
  /\.glitch\.me$/i,
  /\.stackblitz\.io$/i,
  /\.codesandbox\.io$/i,
];

// AI generator meta tags (beyond platform-specific ones already covered)
const AI_GENERATOR_META_PATTERNS = [
  /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*(?:Hostinger\s*AI|AI\s*Website|Durable\.co|10Web|Jimdo\s*AI|GoDaddy\s*AI|Wix\s*ADI|Zyro)[^"']*["']/i,
  /<meta[^>]+content=["'][^"']*(?:Hostinger\s*AI|AI\s*Website|Durable\.co|10Web|Jimdo\s*AI|GoDaddy\s*AI|Wix\s*ADI|Zyro)[^"']*["'][^>]+name=["']generator["']/i,
];

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const CONFIDENCE_WEIGHTS: Record<string, number> = { high: 10, medium: 5, low: 2 };
const MIN_PLATFORM_SCORE = 5;
const MIN_AI_SCORE = 10;
const CATEGORY_CAP = 15;

function scoreSignals(signals: Signal[]): number {
  const byCategory: Record<string, number> = {};
  for (const sig of signals) {
    const w = CONFIDENCE_WEIGHTS[sig.confidence] ?? 1;
    byCategory[sig.category] = (byCategory[sig.category] ?? 0) + w;
  }
  return Object.values(byCategory).reduce((sum, v) => sum + Math.min(v, CATEGORY_CAP), 0);
}

function confidenceLabel(score: number, min: number): "high" | "medium" | "low" | "none" {
  if (score >= min * 3) return "high";
  if (score >= min * 1.5) return "medium";
  if (score >= min) return "low";
  return "none";
}

// ---------------------------------------------------------------------------
// Pattern matching helpers
// ---------------------------------------------------------------------------

function matchAll(html: string, patterns: PatternEntry[], category: string): Signal[] {
  const signals: Signal[] = [];
  for (const [pat, conf, desc] of patterns) {
    const re = new RegExp(pat, "is");
    const m = re.exec(html);
    if (m) {
      signals.push({ category, confidence: conf, description: desc, matchedValue: m[0].slice(0, 120) });
    }
  }
  return signals;
}

function matchTagSrcs(html: string, tagPattern: string, urlPatterns: PatternEntry[], category: string): Signal[] {
  const signals: Signal[] = [];
  const tagRe = new RegExp(tagPattern, "gi");
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(html)) !== null) {
    const src = tagMatch[1];
    for (const [pat, conf, desc] of urlPatterns) {
      if (new RegExp(pat, "i").test(src)) {
        signals.push({ category, confidence: conf, description: desc, matchedValue: src.slice(0, 120) });
        break;
      }
    }
  }
  return signals;
}

function extractHostname(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return url.toLowerCase(); }
}

// ---------------------------------------------------------------------------
// Platform detector
// ---------------------------------------------------------------------------

function detectPlatform(
  platform: string,
  fp: PlatformFingerprint,
  html: string,
  headers: Record<string, string>,
  finalUrl: string,
): Signal[] {
  const signals: Signal[] = [];
  const hostname = extractHostname(finalUrl);

  if (fp.hostname) {
    for (const [pat, conf, desc] of fp.hostname) {
      if (new RegExp(pat, "i").test(hostname)) {
        signals.push({ category: "hostname", confidence: conf, description: desc, matchedValue: hostname });
      }
    }
  }

  if (fp.http_header) {
    const server = headers["server"] ?? "";
    for (const [pat, conf, desc] of fp.http_header) {
      if (new RegExp(pat, "i").test(server)) {
        signals.push({ category: "http_header", confidence: conf, description: `${desc} [server: ${server.slice(0, 60)}]`, matchedValue: server.slice(0, 60) });
      }
    }
  }

  if (platform === "Wix") {
    const pepyaka = headers["server"] ?? "";
    if (/Pepyaka/i.test(pepyaka)) {
      signals.push({ category: "http_header", confidence: "high", description: `Wix Pepyaka server [server: ${pepyaka}]`, matchedValue: pepyaka });
    }
    if ((headers["x-meta-site-is-wix-site"] ?? "").trim() === "1") {
      signals.push({ category: "http_header", confidence: "high", description: "Wix site confirmation header", matchedValue: "1" });
    }
  }

  if (platform === "Bolt") {
    const sv = headers["server-version"] ?? "";
    if (sv) signals.push({ category: "http_header", confidence: "high", description: `Bolt server-version header [${sv.slice(0, 60)}]`, matchedValue: sv.slice(0, 60) });
  }

  const htmlCategories: Array<keyof PlatformFingerprint> = [
    "meta_tag", "html_comment", "data_attribute", "css_class",
    "css_variable", "js_global", "dom_id", "script_content", "font",
  ];
  for (const cat of htmlCategories) {
    const patterns = fp[cat] as PatternEntry[] | undefined;
    if (patterns) signals.push(...matchAll(html, patterns, cat));
  }

  if (fp.script_src) signals.push(...matchTagSrcs(html, "<script[^>]+src=[\"']([^\"']+)[\"']", fp.script_src, "cdn_url"));
  if (fp.link_href)  signals.push(...matchTagSrcs(html, "<link[^>]+href=[\"']([^\"']+)[\"']", fp.link_href, "cdn_url"));
  if (fp.img_src)    signals.push(...matchTagSrcs(html, "<img[^>]+src=[\"']([^\"']+)[\"']", fp.img_src, "cdn_url"));

  return signals;
}

// ---------------------------------------------------------------------------
// AI heuristic detector
// ---------------------------------------------------------------------------

async function detectAiHeuristics(
  html: string,
  headers: Record<string, string>,
  finalUrl: string,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const hostname = extractHostname(finalUrl);

  // Fetch first JS bundle for deeper analysis (same-origin, capped at 300kb)
  let jsSource = "";
  const scriptMatch = /src=["']([^"']*\/assets\/[^"']+\.js)['"]/i.exec(html);
  if (scriptMatch) {
    try {
      const jsUrl = scriptMatch[1].startsWith("http")
        ? scriptMatch[1]
        : new URL(scriptMatch[1], finalUrl).href;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const resp = await fetch(jsUrl, { signal: controller.signal });
        // Only read up to 300kb to stay within Worker limits
        const buf = await resp.arrayBuffer();
        jsSource = new TextDecoder().decode(buf.slice(0, 300_000));
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Non-fatal — carry on without JS source
    }
  }

  const fullSource = html + "\n" + jsSource;

  // ------------------------------------------------------------------
  // 1. Over-commenter detection
  // ------------------------------------------------------------------
  let commentHits = 0;
  for (const pat of OVER_COMMENTER_PATTERNS) {
    const matches = fullSource.match(new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g"));
    commentHits += matches?.length ?? 0;
  }
  if (commentHits >= 5) {
    signals.push({
      category: "over_commenter",
      confidence: "high",
      description: `Tutorial-style comments detected (${commentHits} matches) — AI models over-explain trivial code`,
      matchedValue: String(commentHits),
    });
  } else if (commentHits >= 2) {
    signals.push({
      category: "over_commenter",
      confidence: "medium",
      description: `Some tutorial-style comments detected (${commentHits} matches)`,
      matchedValue: String(commentHits),
    });
  }

  // ------------------------------------------------------------------
  // 2. shadcn/ui signatures
  // ------------------------------------------------------------------
  let shadcnHits = 0;
  for (const pat of SHADCN_PATTERNS) {
    if (pat.test(fullSource)) shadcnHits++;
  }
  if (shadcnHits >= 3) {
    signals.push({
      category: "shadcn_ui",
      confidence: "high",
      description: `shadcn/ui component signatures detected (${shadcnHits} patterns) — AI coding tools default to shadcn`,
      matchedValue: String(shadcnHits),
    });
  } else if (shadcnHits >= 1) {
    signals.push({
      category: "shadcn_ui",
      confidence: "medium",
      description: `shadcn/ui component signatures detected (${shadcnHits} patterns)`,
      matchedValue: String(shadcnHits),
    });
  }

  // ------------------------------------------------------------------
  // 3. Tailwind utility class patterns
  // ------------------------------------------------------------------
  let tailwindHits = 0;
  for (const pat of TAILWIND_PATTERNS) {
    if (pat.test(fullSource)) tailwindHits++;
  }
  if (tailwindHits >= 2) {
    signals.push({
      category: "tailwind_stack",
      confidence: "medium",
      description: "Tailwind CSS utility pattern detected — common AI default stack",
      matchedValue: String(tailwindHits),
    });
  }

  // ------------------------------------------------------------------
  // 4. Vite build artifacts
  // ------------------------------------------------------------------
  let viteHits = 0;
  for (const pat of VITE_PATTERNS) {
    if (pat.test(html)) viteHits++;
  }
  if (viteHits >= 1) {
    const reactSpa = REACT_SPA_PATTERNS.some((p) => p.test(html));
    signals.push({
      category: "vite_build",
      confidence: reactSpa ? "medium" : "low",
      description: reactSpa
        ? "Vite build artifacts + React SPA root — AI tools default to Vite + React"
        : "Vite build artifacts detected",
      matchedValue: "vite",
    });
  }

  // ------------------------------------------------------------------
  // 5. Lucide icons
  // ------------------------------------------------------------------
  const lucideHit = LUCIDE_PATTERNS.some((p) => p.test(fullSource));
  if (lucideHit) {
    signals.push({
      category: "lucide_icons",
      confidence: "medium",
      description: "Lucide icon library detected — heavily favoured by AI coding tools",
      matchedValue: "lucide",
    });
  }

  // ------------------------------------------------------------------
  // 6. Inter font (Google Fonts or bundled)
  // ------------------------------------------------------------------
  const interFont =
    /fonts\.googleapis\.com[^"']*[Ii]nter/.test(html) ||
    /font-family:[^;'"]*['"]Inter['"]/.test(fullSource) ||
    /['"]Inter['"],/.test(fullSource);
  if (interFont) {
    signals.push({
      category: "inter_font",
      confidence: "low",
      description: "Inter font detected — AI tools almost universally default to Inter",
      matchedValue: "Inter",
    });
  }

  // ------------------------------------------------------------------
  // 7. Hallucinated / placeholder links
  // ------------------------------------------------------------------
  let placeholderHits = 0;
  for (const pat of PLACEHOLDER_LINK_PATTERNS) {
    const m = html.match(new RegExp(pat.source, "gi"));
    placeholderHits += m?.length ?? 0;
  }
  if (placeholderHits >= 3) {
    signals.push({
      category: "placeholder_links",
      confidence: "high",
      description: `Placeholder/hallucinated links detected (${placeholderHits}) — e.g. example.com, yourdomain.com, fake API endpoints`,
      matchedValue: String(placeholderHits),
    });
  } else if (placeholderHits >= 1) {
    signals.push({
      category: "placeholder_links",
      confidence: "medium",
      description: `Placeholder link detected (${placeholderHits}) — e.g. example.com or yourdomain.com`,
      matchedValue: String(placeholderHits),
    });
  }

  // ------------------------------------------------------------------
  // 8. Generic numbered naming conventions
  // ------------------------------------------------------------------
  let namingHits = 0;
  for (const pat of GENERIC_NAMING_PATTERNS) {
    const m = html.match(new RegExp(pat.source, "gi"));
    namingHits += m?.length ?? 0;
  }
  if (namingHits >= 4) {
    signals.push({
      category: "generic_naming",
      confidence: "medium",
      description: `Generic numbered class/ID names detected (${namingHits}) — e.g. .container-1, .wrapper-2, .section-3`,
      matchedValue: String(namingHits),
    });
  } else if (namingHits >= 2) {
    signals.push({
      category: "generic_naming",
      confidence: "low",
      description: `Some generic numbered class names detected (${namingHits})`,
      matchedValue: String(namingHits),
    });
  }

  // ------------------------------------------------------------------
  // 9. Prototype hosting (no custom domain)
  // ------------------------------------------------------------------
  const isPrototypeHost = PROTOTYPE_HOSTING_HOSTNAMES.some((p) => p.test(hostname));
  if (isPrototypeHost) {
    signals.push({
      category: "prototype_hosting",
      confidence: "medium",
      description: `Hosted on a prototype/AI-default platform subdomain (${hostname})`,
      matchedValue: hostname,
    });
  }

  // ------------------------------------------------------------------
  // 10. Vercel / Netlify hosting headers (custom domain but still on these platforms)
  // ------------------------------------------------------------------
  const vercelId = headers["x-vercel-id"] ?? headers["x-vercel-cache"] ?? "";
  if (vercelId && !isPrototypeHost) {
    signals.push({
      category: "hosting_platform",
      confidence: "low",
      description: "Hosted on Vercel (common AI-assisted site host)",
      matchedValue: "vercel",
    });
  }
  const netlifyHdr = headers["x-nf-request-id"] ?? headers["x-netlify"] ?? "";
  if (netlifyHdr && !isPrototypeHost) {
    signals.push({
      category: "hosting_platform",
      confidence: "low",
      description: "Hosted on Netlify (common AI-assisted site host)",
      matchedValue: "netlify",
    });
  }

  // ------------------------------------------------------------------
  // 11. AI generator meta tags (Hostinger AI, Durable, Wix ADI, etc.)
  // ------------------------------------------------------------------
  for (const pat of AI_GENERATOR_META_PATTERNS) {
    const m = pat.exec(html);
    if (m) {
      signals.push({
        category: "ai_generator_meta",
        confidence: "high",
        description: "AI website builder generator meta tag detected",
        matchedValue: m[0].slice(0, 120),
      });
      break;
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function detectUrl(rawUrl: string, timeoutMs = 15000): Promise<DetectionResult> {
  let url = rawUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  let html = "";
  let responseHeaders: Record<string, string> = {};
  let finalUrl = url;
  let fetchError: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    finalUrl = response.url || url;
    response.headers.forEach((v, k) => { responseHeaders[k.toLowerCase()] = v; });
    html = await response.text();
  } catch (err: unknown) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  if (fetchError) {
    return {
      url: rawUrl, finalUrl,
      bucket: "unknown",
      bucketConfidence: "none",
      platform: null, platformScore: 0, platformSignals: [], allPlatformScores: {},
      aiScore: 0, aiSignals: [],
      error: fetchError,
    };
  }

  // --- Run platform detector ---
  const allPlatformScores: Record<string, number> = {};
  const allPlatformSignalsMap: Record<string, Signal[]> = {};

  for (const [platform, fp] of Object.entries(FINGERPRINTS)) {
    const sigs = detectPlatform(platform, fp, html, responseHeaders, finalUrl);
    allPlatformScores[platform] = scoreSignals(sigs);
    allPlatformSignalsMap[platform] = sigs;
  }

  const [bestPlatform, bestPlatformScore] = Object.entries(allPlatformScores)
    .sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

  // --- Run AI heuristic detector (always, regardless of platform result) ---
  const aiSignals = await detectAiHeuristics(html, responseHeaders, finalUrl);
  const aiScore = scoreSignals(aiSignals);

  // --- Bucket decision ---
  // Platform wins if it clears its threshold — it's the more specific classification.
  // AI heuristic is the fallback.
  let bucket: Bucket;
  let bucketConfidence: "high" | "medium" | "low" | "none";
  let platform: string | null = null;
  let platformScore = 0;
  let platformSignals: Signal[] = [];

  if (bestPlatformScore >= MIN_PLATFORM_SCORE) {
    bucket = "platform-assisted";
    bucketConfidence = confidenceLabel(bestPlatformScore, MIN_PLATFORM_SCORE);
    platform = bestPlatform;
    platformScore = bestPlatformScore;
    platformSignals = allPlatformSignalsMap[bestPlatform] ?? [];
  } else if (aiScore >= MIN_AI_SCORE) {
    bucket = "ai-assisted";
    bucketConfidence = confidenceLabel(aiScore, MIN_AI_SCORE);
  } else {
    bucket = "no-ai-signals";
    bucketConfidence = "none";
  }

  return {
    url: rawUrl,
    finalUrl,
    bucket,
    bucketConfidence,
    platform,
    platformScore,
    platformSignals,
    allPlatformScores,
    aiScore,
    aiSignals,
    error: null,
  };
}
