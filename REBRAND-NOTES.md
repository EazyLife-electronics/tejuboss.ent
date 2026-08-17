# Teju Boss Rebrand — What Changed & What's Left

This site was adapted from the EazyLife business-management engine. The
Firestore backend (products, orders, delivery, receivables) was already set
up for Teju Boss before this pass — this work covers the static site "shell"
around it: branding, theme, copy, and admin terminology.

## Done

- **Naming**: every "EazyLife" reference replaced with "Teju Boss" — page
  titles, nav, admin panel, reports, receivables statements, the receipt
  generator (`r/`), print sheets, comments.
- **Color theme**: switched from EazyLife's teal/lime to a black/red palette
  matching your actual live site (not a random guess — pulled from your old
  `tejuboss.ent-main` build).
- **Domain**: `eazylife.ng` → `tejuboss.ent` throughout (meta tags, canonical
  links, JSON-LD, sitemap, robots.txt).
- **Tracking codes**: `EZ-XXXXXX` → `TB-XXXXXX` (generator in `js/store.mjs`,
  placeholder in `track.html`).
- **Storage keys**: localStorage keys renamed off `eazylife-*` to avoid
  collisions with any old EazyLife session data on a shared device.
- **Admin product editor**: variant fields relabeled for grocery/general
  merchandise — Variant/Flavour, Unit/Type, Size/Weight, Pack/Carton — baked
  into the HTML/JS source directly (not a runtime patch). The Firestore field
  names underneath (`color`, `processor`, `ram`, `rom`) are unchanged so
  existing data keeps working.
- **"Optional Upgrades" (RAM/ROM add-ons)**: hidden by default since it's an
  electronics-only concept; the underlying feature still exists in code if
  you ever want "add-ons" (e.g. gift wrap) for specific products.
- **Homepage**: hero copy, "Services" section (now: Groceries & Household
  Essentials, Bulk/Wholesale Orders, Can't Find It sourcing requests, Fast
  WhatsApp Ordering & Delivery), trust section, and JSON-LD structured data
  (now `GroceryStore` schema) rewritten for a general merchant.
- **Shop page**: header, tagline, search placeholder, and the "can't find
  it" request-modal category list updated to grocery categories.
- **Receipt generator**: banner copy, return policy (was a 7-day electronics
  defect warranty, now a grocery-appropriate return policy), signature
  block, and contact block updated.
- **WhatsApp number**: carried over your real number from the old live site
  (+234 707 955 7886) everywhere the old EazyLife number was hardcoded.
- **Removed rather than guessed**: EazyLife's real street address, email,
  CAC registration number, and social media links were deleted rather than
  reused or faked — see TODOs below.

## Still needs you (marked with TODO / placeholder text in the code)

1. **Business address, email, and CAC number** (if registered) — search the
   codebase for `[Add`, `[Business`, `[email`, or `TODO` to find every spot.
   Main ones: `index.html` (JSON-LD + Contact section), `r/index.html`
   (receipt header).
2. **Social media links** (Facebook/Instagram/Maps) — the old social cards
   were removed from `index.html`'s Contact section rather than left with
   EazyLife's links; there's a commented-out template right where they were
   if you want to add real ones back in.
3. **GitHub repo name** for the admin image picker, in
   `admin/js/admin-shared.mjs` (`GITHUB_REPO` constant) — needed so admins
   can browse `assets/products/`/`assets/heroes/` by thumbnail instead of
   pasting URLs. Not urgent — pasting URLs still works without it.
4. **`assets/products/` and `assets/heroes/`** still contain EazyLife's old
   laptop/electronics photos. They're not used by the live site (Firestore
   drives the real catalog/heroes) but are dead weight worth deleting.
5. **`products.json`, `pictures/`, `manager.html`, `test.html`** are legacy
   dev/import tools, not part of the live site — left alone, but worth a
   look if you still use them for anything.
