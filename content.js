// === Minimal utilities =======================================================

const SETTINGS_KEY = "__prediction_odds_helper_settings__";
const defaultSettings = {
  showDecimal: true,
  showAmerican: true,
  showFractional: false,
  // If your market charges a fee at buy time, you can model “effective p”
  // as p' = p + feeAdj (for YES) or tweak however you prefer.
  // Enter as percentage points (e.g., 3 => +3pp => 0.55 becomes 0.58).
  feeAdjustmentPp: 0,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw
      ? { ...defaultSettings, ...JSON.parse(raw) }
      : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function clamp01(x) {
  if (Number.isNaN(x)) return NaN;
  return Math.max(0.000001, Math.min(0.999999, x));
}

// Convert between formats
function probToDecimal(p) {
  return 1 / p;
}
function probToAmerican(p) {
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}
function probToFractional(p) {
  // Fractional odds = (1-p)/p simplified approximate
  const num = (1 - p) / p;
  // Convert to nearest nice fraction with small denominator
  // We’ll cap denominator at 100 for readability
  const maxDen = 100;
  let best = { n: Math.round(num), d: 1, err: Math.abs(num - Math.round(num)) };
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(num * d);
    const err = Math.abs(num - n / d);
    if (err < best.err) best = { n, d, err };
  }
  return `${best.n}/${best.d}`;
}

function fmtDecimal(x) {
  if (!Number.isFinite(x)) return "—";
  // Decimal odds usually shown to 2–3 dp
  return x.toFixed(2);
}
function fmtAmerican(a) {
  if (!Number.isFinite(a)) return "—";
  return a > 0 ? `+${a}` : `${a}`;
}

// === Detection of prices on each site =======================================

// Polymarket: UI can show percentage (“55%”) or dollar price (“$0.55”).
// Kalshi: typically shows price like $0.55 or probability as “55%” in some views.
// We'll generically scan text nodes with % or $0.xx, and avoid duplicating badges.

const BADGE_ATTR = "data-odds-badge-attached";

function isLikelyPriceText(t) {
  if (!t) return false;
  const s = t.trim();
  // Accept e.g. "55%"  "5.5%"  "0.55" (rare)  "$0.55"  "$0.55 YES"
  // Also reject large percentages like “100% OFF” (still fine to show, but heuristic).
  return (
    /(^|\s)\d{1,3}(\.\d+)?%(\s|$)/.test(s) || /(^|\s)\$\s*0?\.\d+(\s|$)/.test(s)
  );
}

function extractProbFromText(t) {
  const s = t.trim();
  // 1) Percentage case
  const mPct = s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (mPct) {
    let p = parseFloat(mPct[1]) / 100;
    return clamp01(p);
  }
  // 2) Dollar price case like $0.55 => assume YES probability ~ price
  const mDol = s.match(/\$\s*(0?\.\d+)/);
  if (mDol) {
    let p = parseFloat(mDol[1]);
    return clamp01(p);
  }
  return NaN;
}

// === Badge creation ==========================================================

function createBadge(p, settings) {
  const effectiveP = clamp01(p + settings.feeAdjustmentPp / 100);
  const container = document.createElement("span");
  container.className = "odds-badge";
  container.title =
    `Implied from p=${(effectiveP * 100).toFixed(2)}%` +
    (settings.feeAdjustmentPp
      ? ` (fee adj: ${settings.feeAdjustmentPp}pp)`
      : "");

  const bits = [];
  if (settings.showDecimal)
    bits.push(`Dec ${fmtDecimal(probToDecimal(effectiveP))}`);
  if (settings.showAmerican)
    bits.push(`US ${fmtAmerican(probToAmerican(effectiveP))}`);
  if (settings.showFractional)
    bits.push(`Frac ${probToFractional(effectiveP)}`);
  container.textContent = ` ${bits.join(" · ")}`;
  return container;
}

function attachBadge(targetNode, p, settings) {
  // Resolve the element we’ll hang our badge and attribute on
  const hostEl =
    targetNode.nodeType === Node.TEXT_NODE
      ? targetNode.parentElement
      : targetNode;
  if (!hostEl) return;

  // Avoid double-attaching on the same host element
  if (hostEl.getAttribute(BADGE_ATTR) === "1") return;

  const badge = createBadge(p, settings);

  // If we matched a text node, insert the badge right after that text,
  // otherwise append to the element.
  if (targetNode.nodeType === Node.TEXT_NODE && targetNode.parentNode) {
    // If the *immediate* next sibling is already a badge, skip (prevents dupes on fast re-scans)
    const next = targetNode.nextSibling;
    if (
      next &&
      next.nodeType === Node.ELEMENT_NODE &&
      next.classList.contains("odds-badge")
    ) {
      return;
    }
    targetNode.parentNode.insertBefore(badge, targetNode.nextSibling);
  } else {
    // If last child is already our badge, skip
    const last = hostEl.lastElementChild;
    if (last && last.classList.contains("odds-badge")) return;
    hostEl.insertAdjacentElement("beforeend", badge);
  }

  hostEl.setAttribute(BADGE_ATTR, "1");
}

// Walk nodes and find likely price texts
function scanOnce(settings) {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );
  const seen = new WeakSet();

  while (walker.nextNode()) {
    const n = walker.currentNode;
    // Only examine text nodes or small texty elements
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.nodeValue;
      if (isLikelyPriceText(t)) {
        const p = extractProbFromText(t);
        if (!Number.isNaN(p)) attachBadge(n, p, settings);
      }
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      if (seen.has(n)) continue;
      seen.add(n);

      // Skip nodes we injected
      if (
        n.classList?.contains("odds-badge") ||
        n.id === "odds-helper-settings"
      )
        continue;

      // Check elements with short text (avoid huge chunks)
      const text =
        n.childNodes?.length === 1 && n.firstChild?.nodeType === Node.TEXT_NODE
          ? n.textContent
          : null;
      if (text && isLikelyPriceText(text)) {
        const p = extractProbFromText(text);
        if (!Number.isNaN(p)) attachBadge(n, p, settings);
      }
    }
  }
}

// Observe SPA updates
function startObservers(settings) {
  const obs = new MutationObserver((mutations) => {
    // Throttle with microtask
    queueMicrotask(() => scanOnce(settings));
  });
  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // Also initial pass:
  scanOnce(settings);
  return obs;
}

// === Tiny settings pill ======================================================

function mountSettings(settings) {
  if (document.getElementById("odds-helper-settings")) return;

  const wrap = document.createElement("div");
  wrap.id = "odds-helper-settings";
  wrap.innerHTML = `
    <button id="odds-helper-toggle" class="oh-btn" title="Prediction Odds Helper settings">Odds</button>
    <div id="odds-helper-panel" class="oh-panel" hidden>
      <label><input type="checkbox" id="oh-dec" ${
        settings.showDecimal ? "checked" : ""
      }/> Decimal</label>
      <label><input type="checkbox" id="oh-ame" ${
        settings.showAmerican ? "checked" : ""
      }/> American</label>
      <label><input type="checkbox" id="oh-frac" ${
        settings.showFractional ? "checked" : ""
      }/> Fractional</label>
      <label>Fee adj (pp): <input type="number" id="oh-fee" min="-10" max="10" step="0.1" value="${
        settings.feeAdjustmentPp
      }"/></label>
      <div class="oh-row">
        <button id="oh-apply" class="oh-btn">Apply</button>
        <button id="oh-close" class="oh-btn">Close</button>
      </div>
      <div class="oh-hint">Tip: Fee adjustment adds/subtracts percentage points to implied p before converting.</div>
    </div>
  `;
  document.body.appendChild(wrap);

  const panel = document.getElementById("odds-helper-panel");
  document
    .getElementById("odds-helper-toggle")
    .addEventListener("click", () => {
      panel.hidden = !panel.hidden;
    });
  document.getElementById("oh-close").addEventListener("click", () => {
    panel.hidden = true;
  });
  document.getElementById("oh-apply").addEventListener("click", () => {
    const s = {
      showDecimal: document.getElementById("oh-dec").checked,
      showAmerican: document.getElementById("oh-ame").checked,
      showFractional: document.getElementById("oh-frac").checked,
      feeAdjustmentPp: parseFloat(
        document.getElementById("oh-fee").value || "0"
      ),
    };
    saveSettings(s);
    // Re-scan and refresh badges: easiest is to remove old badges and rescan.
    document
      .querySelectorAll(`[${BADGE_ATTR}="1"] .odds-badge`)
      .forEach((el) => el.remove());
    document
      .querySelectorAll(`[${BADGE_ATTR}="1"]`)
      .forEach((el) => el.removeAttribute(BADGE_ATTR));
    scanOnce(s);
  });
}

// === Boot ====================================================================

(function main() {
  const settings = loadSettings();
  mountSettings(settings);
  startObservers(settings);
})();
