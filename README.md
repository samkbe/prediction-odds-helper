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
