# Sawtooth Thrift Website (Starter)

This is a Netlify-ready static site + Decap CMS admin panel.

## What you get
- Public product gallery (reads from `public/data/products.json`)
- Optional product detail page (`public/product.html`)
- Admin panel at `/admin` (Decap CMS) for editing products + uploading images
- Contact form section (FormSubmit placeholder)


## Running tests

Test tooling is Node-based and runs against either a deployed Netlify preview URL or local Netlify dev.

1) Install dependencies:

```bash
npm install
```

2) Set required environment variables:

- `BASE_URL` (example: `https://your-preview-url.netlify.app`)
- `ADMIN_TOKEN`
- `DATABASE_URL` (required when running local functions against a local DB)

Additional vars used by specific tests:

- `STRIPE_SECRET_KEY` (Stripe test mode key, needed for checkout session tests)
- `STRIPE_TEST_WEBHOOK_SECRET` (optional for local webhook wiring)

3) Run smoke tests only:

```bash
npm run test:smoke
```

4) Run full suite (smoke + browser checks):

```bash
npm test
```

A sample config is included at `tests/config.example.json`. Tests read from environment variables first and never print secret values.

## Local preview
From the project root, run one of the following:
- Python: `python -m http.server 8080` then open `http://localhost:8080/public/`
- Node (if you have it): `npx serve public`

## Launch (high-level)
1) Push to GitHub.
2) Create Netlify site from Git repo (publish dir: `public`, no build command).
3) Enable Identity + Git Gateway in Netlify, invite admin user(s).
4) Visit `/admin/` to add products.

## Configure the contact form
The homepage contact form is configured for Netlify Forms (`name="contact"`, `data-netlify="true"`).
No third-party form endpoint is required.

## Live catalog API (Neon optional)
The storefront now tries to load products from `/.netlify/functions/products` first, then falls back to `public/data/products.json` if the function is unavailable.

This means you can move catalog data to Neon Postgres and update inventory/content without redeploying the static site.

### Neon setup
1) Create a Neon project and copy the connection string.
2) In Netlify site environment variables, set either:
   - `PRODUCTS_DATABASE_URL` (preferred), or
   - `DATABASE_URL`
3) (Optional) set `PRODUCTS_TABLE` if you don't want the default `catalog` table name.
4) Create table:

```sql
create table if not exists catalog (
  id bigserial primary key,
  currency text not null default 'USD',
  products jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
```

5) Seed one row from your existing file:

```sql
insert into catalog (currency, products)
values (
  'USD',
  '[{"name":"Example Item","price":25,"status":"active"}]'::jsonb
);
```

> The function reads the latest row (`ORDER BY updated_at DESC LIMIT 1`). Update by inserting a fresh row with new `products` JSON.

## Inventory / sold out
This site supports a `quantity` field per product:
- If `quantity` is 0 (or status is `sold`/`inactive`), the UI shows **Sold Out** and disables the Buy button.

Important: because this is a static site using Stripe Payment Links, inventory is not automatically decremented after purchase.
To enforce true inventory (prevent oversells), you would add a server-side checkout flow + Stripe webhook (e.g., Netlify Functions) to decrement quantity and block checkout when quantity hits 0.


## Mobile UX upgrades included
- Product list now supports quick filter chips (All, In stock, Ready to ship, Under $50) and sorting controls for phone-friendly browsing.
- Product cards include a one-tap SMS contact action for fast buyer questions.
- Product detail pages now include a sticky mobile buy bar so checkout is always within reach.
- Admin now has quick-action buttons (open storefront, new product, focus search) to speed up edits on phones.
- Stripe Tools in admin now includes a per-product **Shipping Label** action that auto-fills from the latest paid Stripe order address (with manual prompt fallback) and copies a printable label template.
- Stripe Tools now includes **Auto-match current** to map the open product Name to the best Stripe item and auto-fill Price + Payment Link in one click.
- Admin now includes an **Awaiting Orders** panel to view recent paid checkouts, customer shipping details, purchased items, and one-click printable shipping labels.


## AI Insights (Admin)
- Admin now includes an **AI Insights** button for simple sourcing + revenue guidance.
- Set `OPENAI_API_KEY` in Netlify environment variables.
- Optional: `OPENAI_MODEL` (defaults to `gpt-4.1-mini`).
- For Stripe revenue context in AI responses, also set `STRIPE_SECRET_KEY`.
- Access is limited to requests authenticated by the server-side `ADMIN_TOKEN` cookie/Bearer validation.


## AI Sourcing (Admin)
- Admin includes **AI Sourcing (Clothes & Shoes)** with exactly 3 queued opportunities at a time.
- Accepting an opportunity creates an **AI draft product** (stored server-side), declining immediately refreshes the queue back to 3.
- Data persistence is DB-backed (`products`, `ai_opportunities`, `processed_stripe_sessions`) so publishing and inventory updates do not require redeploys.
- Storefront reads active products from `/.netlify/functions/active-products` (DB source of truth).
- Sold-out enforcement uses `inventory`: if `inventory <= 0`, UI shows **Sold out** and checkout is blocked server-side.

### Required environment/config
- `OPENAI_API_KEY`
- `ADMIN_TOKEN` (all admin/AI endpoints require authenticated admin token)
- `STRIPE_SECRET_KEY` (used by checkout creation and webhook inventory decrement)
- `STRIPE_WEBHOOK_SECRET` (used by `/.netlify/functions/stripe-webhook` signature verification)

## DB-only commerce setup
1) Ensure `DATABASE_URL` points to your Postgres database.
2) Run schema:
   - `psql "$DATABASE_URL" -f db/schema.sql`
3) Required env vars for commerce:
   - `DATABASE_URL` (all product/AI/order state)
   - `STRIPE_SECRET_KEY` (checkout + webhook)
   - `STRIPE_WEBHOOK_SECRET` (webhook signature verification)
   - `OPENAI_API_KEY` (AI opportunity generation)
   - Optional: `URL` or `SITE_URL` for checkout redirects

### Stripe webhook endpoint
- Configure Stripe webhook to send `checkout.session.completed` to:
  - `/.netlify/functions/stripe-webhook`
