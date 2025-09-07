// === Utilities =======================================================

const SETTINGS_KEY = "__prediction_odds_helper_settings__";
const defaultSettings = {
  showDecimal: true,
  showAmerican: false,
  showFractional: false,
  feeModel: false, // false | "kalshi" | "polymarket"
  feeAdjustmentPp: 0,
};

let currentSettings = loadSettings();

function updateSettings(patchOrAll) {
  const patch = patchOrAll;
  Object.assign(currentSettings, patch);
  saveSettings(currentSettings);
}

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

function isLikelyPriceText(t) {
  if (!t) return false;
  const s = t.trim();

  // Percent: "55%" or "5.5%"
  const pct = /(^|\s)\d{1,3}(?:\.\d+)?\s*%(\s|$)/;

  // Dollar price: "$0.55" or "$ .55"
  const usd = /(^|\s)\$\s*0?\.\d+(\s|$)/;

  // Cents: "92¢"  (¢ = U+00A2). Allow optional thin/nbsp spaces before/after.
  const cents = /(^|\s)\d{1,3}(?:\.\d+)?[\s\u00A0]*¢(\s|$)/;

  return pct.test(s) || usd.test(s) || cents.test(s);
}

function extractProbFromText(t) {
  const s = t.trim();

  // 1) Percentage: "55%" => 0.55
  const mPct = s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (mPct) {
    const p = parseFloat(mPct[1]) / 100;
    return clamp01(p);
  }

  // 2) Dollar price: "$0.55" => 0.55
  const mDol = s.match(/\$\s*(0?\.\d+)/);
  if (mDol) {
    const p = parseFloat(mDol[1]);
    return clamp01(p);
  }

  // 3) Cents: "92¢" => 0.92
  // Allow 1–3 digits (or with .decimal, just in case a site uses "92.0¢").
  // \u00A0 = NBSP; some UIs insert that instead of a normal space.
  const mCent = s.match(/(\d{1,3}(?:\.\d+)?)[\s\u00A0]*¢/);
  if (mCent) {
    const cents = parseFloat(mCent[1]);
    const p = cents / 100;
    return clamp01(p);
  }

  return NaN;
}

function applyFeeModel(p, settings) {
  if (settings.feeModel === "kalshi") {
    return clamp01(p + 0.07 * (1 - p));
  } else if (settings.feeModel === "polymarket") {
    return clamp01(p);
  } else {
    const fee = (settings.feeAdjustmentPp || 0) / 100;
    return clamp01(p / (1 - fee));
  }
}

// === Badge creation ==========================================================

const BADGE_ATTR = "data-odds-badge-attached";
const OUR_ROOT_SELECTOR = ".odds-badge, #odds-helper-settings";

function renderBadge(el, p, settings) {
  const effectiveP = applyFeeModel(p, settings);
  el.className = "odds-badge";
  el.title =
    `Implied from p=${(effectiveP * 100).toFixed(2)}%` +
    (settings.feeModel === "kalshi"
      ? " (Kalshi fees)"
      : settings.feeModel === "polymarket"
      ? " (Polymarket: no fee)"
      : settings.feeAdjustmentPp
      ? ` (manual: ${settings.feeAdjustmentPp}pp)`
      : "");

  const bits = [];
  if (settings.showDecimal)
    bits.push(`Dec ${fmtDecimal(probToDecimal(effectiveP))}`);
  if (settings.showAmerican)
    bits.push(`US ${fmtAmerican(probToAmerican(effectiveP))}`);
  if (settings.showFractional)
    bits.push(`Frac ${probToFractional(effectiveP)}`);
  el.textContent = ` ${bits.join(" · ")}`;
}

function createBadge(p, settings) {
  const span = document.createElement("span");
  renderBadge(span, p, settings);
  return span;
}

function attachBadge(targetNode, p, settings) {
  const hostEl =
    targetNode.nodeType === Node.TEXT_NODE
      ? targetNode.parentElement
      : targetNode;
  if (!hostEl) return;

  // If we're inside our own UI/badge, do nothing
  if (hostEl.closest(OUR_ROOT_SELECTOR)) return;

  // Find an existing direct child badge
  let badge = hostEl.querySelector?.(":scope > .odds-badge");

  if (badge) {
    // Update in place (no replace)
    renderBadge(badge, p, settings);
  } else {
    // Insert new badge right after the text node or at end of element
    badge = createBadge(p, settings);
    if (targetNode.nodeType === Node.TEXT_NODE && targetNode.parentNode) {
      targetNode.parentNode.insertBefore(badge, targetNode.nextSibling);
    } else {
      hostEl.insertAdjacentElement("beforeend", badge);
    }
    hostEl.setAttribute(BADGE_ATTR, "1");
  }
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

    // Skip anything inside our badges/settings UI
    const parentEl = n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
    if (parentEl && parentEl.closest(OUR_ROOT_SELECTOR)) continue;

    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.nodeValue;
      if (isLikelyPriceText(t)) {
        const p = extractProbFromText(t);
        if (!Number.isNaN(p)) attachBadge(n, p, settings);
      }
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      if (seen.has(n)) continue;
      seen.add(n);

      // Only simple elements (single text node)
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

let PATCHING = 0; // reentrancy guard

function startObservers(settings) {
  let timer = 0;

  const obs = new MutationObserver((mutations) => {
    // If all mutations are within our own UI/badges, ignore
    const allOurs = mutations.every(
      (m) =>
        (m.target && m.target.closest?.(OUR_ROOT_SELECTOR)) ||
        [...m.addedNodes].every(
          (n) => n.nodeType === 1 && n.closest?.(OUR_ROOT_SELECTOR)
        )
    );
    if (allOurs || PATCHING > 0) return;

    clearTimeout(timer);
    timer = setTimeout(() => {
      PATCHING++;
      try {
        scanOnce(currentSettings);
      } finally {
        PATCHING--;
      }
    }, 80);
  });

  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  PATCHING++;
  try {
    scanOnce(currentSettings);
  } finally {
    PATCHING--;
  }

  return obs;
}

// === Tiny settings pill ======================================================

function mountSettings(settings) {
  if (document.getElementById("odds-helper-settings")) return;

  const wrap = document.createElement("div");
  wrap.id = "odds-helper-settings";

  const currentFeeChoice =
    settings.feeModel === "kalshi"
      ? "kalshi"
      : settings.feeModel === "polymarket"
      ? "polymarket"
      : "none";

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

      <fieldset class="oh-fieldset">
        <legend class="oh-legend">Fee model</legend>
        <label><input type="radio" name="oh-feemodel" value="kalshi" ${
          currentFeeChoice === "kalshi" ? "checked" : ""
        }/> Kalshi</label>
        <label><input type="radio" name="oh-feemodel" value="polymarket" ${
          currentFeeChoice === "polymarket" ? "checked" : ""
        }/> Polymarket</label>
        <label><input type="radio" name="oh-feemodel" value="none" ${
          currentFeeChoice === "none" ? "checked" : ""
        }/> None (Use custom % below)</label>
      </fieldset>

      <label>
        Fee adj (pp):
        <input type="number" id="oh-fee" min="-10" max="10" step="0.1" value="${
          settings.feeAdjustmentPp
        }"/>
      </label>

      <div class="oh-row">
        <button id="oh-apply" class="oh-btn">Apply</button>
        <button id="oh-close" class="oh-btn">Close</button>
      </div>
      <div class="oh-hint">
        • Kalshi applies 0.07 × (1 - p).<br/>
        • Polymarket uses no fee.<br/>
        • “None” lets you add/subtract percentage points manually (e.g., 3 → +0.03 to p).
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const panel = document.getElementById("odds-helper-panel");
  const feeInput = document.getElementById("oh-fee");

  const updateFeeInputEnabled = () => {
    const choice =
      document.querySelector('input[name="oh-feemodel"]:checked')?.value ||
      "none";
    const isManual = choice === "none";
    feeInput.disabled = !isManual;
    feeInput.style.opacity = isManual ? "1" : "0.6";
  };

  document
    .getElementsByName("oh-feemodel")
    .forEach((r) => r.addEventListener("change", updateFeeInputEnabled));

  updateFeeInputEnabled();

  document
    .getElementById("odds-helper-toggle")
    .addEventListener("click", () => {
      panel.hidden = !panel.hidden;
    });
  document.getElementById("oh-close").addEventListener("click", () => {
    panel.hidden = true;
  });

  document.getElementById("oh-apply").addEventListener("click", () => {
    const feeChoice =
      document.querySelector('input[name="oh-feemodel"]:checked')?.value ||
      "none";
    const feeModel = feeChoice === "none" ? false : feeChoice;

    const s = {
      showDecimal: document.getElementById("oh-dec").checked,
      showAmerican: document.getElementById("oh-ame").checked,
      showFractional: document.getElementById("oh-frac").checked,
      feeModel,
      feeAdjustmentPp: parseFloat(
        document.getElementById("oh-fee").value || "0"
      ),
    };
    updateSettings(s);

    PATCHING++;
    try {
      document.querySelectorAll(".odds-badge").forEach((el) => el.remove());
      document
        .querySelectorAll(`[${BADGE_ATTR}="1"]`)
        .forEach((el) => el.removeAttribute(BADGE_ATTR));
      scanOnce(currentSettings);
    } finally {
      PATCHING--;
    }
  });
}

// === Boot ====================================================================

(function main() {
  const settings = loadSettings();
  mountSettings(settings);
  startObservers(settings);
})();
