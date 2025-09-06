# Prediction Odds Helper

Appends sportsbook-style odds next to prediction market prices on Polymarket and Kalshi. Shows Decimal, American, and Fractional. Optional fee adjustment (in percentage points) to model effective probability before conversion.

## Install (Chrome / Brave / Edge)

1. `chrome://extensions` → toggle **Developer mode** (top-right).
2. **Load unpacked** → select this folder.
3. Visit Polymarket or Kalshi; you’ll see small badges next to prices. Use the **Odds** pill (bottom-right) to change formats or fee adj.

## What it does

- Finds text like `55%` or `$0.55` and computes:
  - **Decimal**: `1 / p`
  - **American**: if `p >= 0.5` → `-(p/(1-p))*100`, else `((1-p)/p)*100`
  - **Fractional**: `(1 - p) / p` as a simplified fraction (approx.)
- Works on SPA updates using a `MutationObserver`.
- Avoids duplicate badges via a data-attribute.

## Notes & Tips

- Interprets `$0.55` as `p = 0.55` for **YES**. If you’re reading **NO** prices, convert via `p_yes = 1 - p_no` (you could add a quick toggle if desired).
- **Fee adjustment**: enter +3.0 to turn `p=0.55` into `p'=0.58` before converting (useful if the market charges a buy-side fee upfront).
- You can expand `matches` in `manifest.json` to other markets easily.

## Extending

- If a site renders prices in specific selectors, you can speed things up by querying those selectors directly instead of scanning text nodes.
- If you want a popup or toolbar icon, add a `action` and `popup.html` in the manifest and move settings into `chrome.storage`.
