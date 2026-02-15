# Sawtooth Thrift Admin + Storefront System Spec (DB-Only)

## 1) Goals / Non-goals

### Goals
- Make Postgres the sole source of truth for products, AI opportunities, and Stripe session idempotency state.
- Provide token-based admin authentication using `ADMIN_TOKEN` with HttpOnly cookie login flow.
- Allow admins to source inventory via AI (Twin Falls, clothes + shoes only), maintain always-on queue of exactly 3 opportunities, and convert accepted opportunities into editable product drafts.
- Allow admins to manage products (title, description, photos, inventory, price, status) and publish instantly by setting `status=active` (no redeploy).
- Provide storefront read path from `/.netlify/functions/active-products` with sold-out enforcement in UI and checkout API.
- Support multi-item cart and Stripe Checkout session creation with server-side inventory validation.
- Decrement inventory from Stripe webhook (`checkout.session.completed` with paid status) with idempotency protection.
- Provide admin order/fulfillment view for paid orders with ship-to, line items, print packing slip, and optional mark-shipped metadata update.

### Non-goals
- Netlify Identity or SSO auth for admin (explicitly out of scope).
- Decap/Netlify CMS admin experience.
- Blob or static JSON catalog as runtime source of truth for commerce product state.
- Automated shipping label creation from carrier APIs (UPS label is printed at drop-off; admin handles packing slip only).
- Email notifications for shipped status.
- Reservation/locking inventory at add-to-cart time.
- Refund/cancellation workflow automation.

---

## 2) Assumptions
- Currency is USD by default and represented in cents (`price_cents`) server-side.
- Product IDs are stable text slugs (`id TEXT PRIMARY KEY`), not generated integers.
- `photos` are URL strings stored in JSON arrays.
- Stripe line items are generated from DB product snapshots at checkout-session creation time.
- Webhook consumes `session.metadata.cart` JSON payload to map purchased `productId` and `qty`.
- If a webhook event has missing/invalid cart metadata, handler no-ops safely and still returns success to avoid retry storms.
- Admin is a custom dashboard page at `/admin/` implemented in plain HTML/CSS/JS, protected by `ADMIN_TOKEN` cookie gate via Edge Function.

---

## 3) User roles

### 3.1 Shopper (public)
- Can browse active products.
- Can view product detail page.
- Can add multiple items to cart.
- Can checkout through Stripe Checkout.
- Cannot access any admin endpoint.

### 3.2 Admin
- Authenticates via `/admin/login` using shared token (`ADMIN_TOKEN`).
- Receives `admin_auth` HttpOnly cookie.
- Can access `/admin/*` routes and admin functions.
- Can perform product lifecycle actions (draft -> active -> archived).
- Can manage AI sourcing queue and accept/decline opportunities.
- Can view paid orders, print packing slips, and optionally mark orders shipped.

### 3.3 Stripe Webhook (system actor)
- Calls `/.netlify/functions/stripe-webhook`.
- Must pass signature validation.
- Decrements inventory exactly once per Stripe session ID.

---

## 4) Key flows (step-by-step)

### 4.1 Admin login + gated admin routes
1. Admin visits `/admin/login`.
2. Enters shared token and submits.
3. Frontend POSTs `{ token }` to `/.netlify/functions/admin-login` with `credentials: include`.
4. Function compares token to `process.env.ADMIN_TOKEN`.
5. On success, function sets `admin_auth` HttpOnly cookie (Lax, path `/`, 30-day max age; Secure in prod).
6. Browser redirects to `/admin/`.
7. Netlify Edge Function (`admin-auth`) checks `admin_auth` cookie on `/admin/*` except `/admin/login`.
8. If cookie mismatches expected token, user is redirected to `/admin/login`.

### 4.2 AI Sourcing queue (always 3 opportunities)
1. Admin opens AI Sourcing tab/panel.
2. UI GETs `/.netlify/functions/ai-opportunities`.
3. Function enforces admin auth and calls `ensureOpportunities(3)`.
4. If DB queue has <3 rows, generator creates opportunities (OpenAI or fallback templates).
5. API returns 3 opportunities ordered oldest-first.
6. Admin clicks **Decline**:
   - UI POSTs `/.netlify/functions/ai-decline` with `{ opp_id }`.
   - Function deletes row, re-fills queue back to 3, returns refreshed set.
7. Admin clicks **Accept**:
   - UI POSTs `/.netlify/functions/ai-accept` with `{ opp_id }`.
   - In transaction: lock opportunity, delete it, create product draft with AI title/description/suggested price, `inventory=1`, `status='draft'`.
   - Function re-fills opportunities back to 3 and returns both created draft + refreshed opportunities.

### 4.3 Product editing and instant publish
1. Admin opens DB Products tab.
2. UI GETs `/.netlify/functions/admin-products`.
3. Admin edits title/description/price/inventory/status.
4. UI PATCHes `/.netlify/functions/admin-products` with `{ id, updates }`.
5. Server validates constraints (price >=0, inventory integer >=0, status in draft/active/archived).
6. DB row updates with `updated_at=now()`.
7. If status changed to `active`, product is immediately visible to storefront through active-products endpoint (no redeploy).

### 4.4 Storefront listing + product page
1. Home page loads products via `/.netlify/functions/active-products`.
2. UI shows cards only for `status='active'` products.
3. Inventory badges:
   - `inventory<=0`: Sold out badge + disabled buttons.
   - `inventory<=3`: low-stock label.
4. Product page loads same endpoint list and resolves by `id` query param.
5. If item not found or not active -> “Product not found”.

### 4.5 Multi-item cart behavior
1. Cart stored in `localStorage` (`cart_v1`) with merged product quantities.
2. Quantity operations are clamped client-side against latest loaded inventory map.
3. Cart page validates each line against active products:
   - Missing/inactive item -> blocked row “Item no longer available”.
   - Sold out item -> blocked with warning text.
   - Over-quantity -> auto-adjust down to available inventory.
4. Checkout button disabled while blocked rows exist.

### 4.6 Checkout creation
1. User clicks Buy Now or Checkout.
2. Frontend POSTs `items:[{productId,qty}]` to `/.netlify/functions/create-checkout-session`.
3. Function validates payload shape, qty integers >=1.
4. Function queries DB for all referenced products.
5. For each item, server enforces:
   - Product exists.
   - Product status is active.
   - Inventory > 0.
   - Requested qty <= inventory.
6. Function creates Stripe Checkout session (`mode=payment`, US shipping addresses only).
7. Writes serialized cart to `metadata.cart`.
8. Returns Stripe hosted checkout URL.

### 4.7 Stripe webhook inventory decrement + idempotency
1. Stripe sends `checkout.session.completed` event to webhook endpoint.
2. Function verifies signature with `STRIPE_WEBHOOK_SECRET`.
3. Ignores non-`checkout.session.completed` events.
4. Ignores sessions where `payment_status !== 'paid'`.
5. Parses `session.metadata.cart` to `{productId, qty}` array.
6. Starts DB transaction:
   - Checks `processed_stripe_sessions` for `session_id`.
   - If found, exits without applying decrement.
   - If not found, decrements each product with `inventory = GREATEST(0, inventory - qty)`.
   - Inserts session_id into processed table.
7. Returns `200 {ok:true}`.

### 4.8 Admin orders + fulfillment
1. Admin opens Orders tab.
2. UI GETs `/.netlify/functions/stripe-orders?limit=&status=&q=`.
3. Function lists paid checkout sessions from Stripe and expands recipient and line items.
4. Admin can:
   - Expand order details.
   - Print packing slip (includes blank tracking line).
   - Copy ship-to address.
   - Optionally mark shipped (POST to `stripe-mark-shipped` with session ID + optional tracking).
5. Mark shipped updates Stripe session metadata (`fulfillment_status=shipped`, `tracking`, `shipped_at`).

---

## 5) Data model (DB tables + important fields + constraints)

### 5.1 `products`
- `id TEXT PRIMARY KEY` — canonical product ID/slug.
- `status TEXT NOT NULL DEFAULT 'draft'` — constrained to `draft|active|archived`.
- `title TEXT NOT NULL`.
- `description TEXT NOT NULL DEFAULT ''`.
- `price_cents INT NOT NULL` with check `>=0`.
- `currency TEXT NOT NULL DEFAULT 'usd'`.
- `photos JSONB NOT NULL DEFAULT []`.
- `inventory INT NOT NULL DEFAULT 1` with check `>=0`.
- `tags JSONB NOT NULL DEFAULT []`.
- `source_notes TEXT NOT NULL DEFAULT ''`.
- `buy_price_max_cents INT NULL`.
- `search_keywords JSONB NOT NULL DEFAULT []`.
- `created_at`, `updated_at` timestamps (UTC).

Constraints:
- `products_status_chk` status enum-like check.
- `products_inventory_chk` prevents negative stock.
- `products_price_chk` prevents negative price.

### 5.2 `ai_opportunities`
- `opp_id TEXT PRIMARY KEY`.
- `category TEXT NOT NULL` constrained to `clothes|shoes`.
- `title TEXT NOT NULL`.
- `max_buy_price_cents INT NOT NULL` `>=0`.
- `suggested_price_cents INT NOT NULL` `>=0`.
- `expected_margin_pct INT NULL`.
- `search_keywords JSONB`, `condition_checklist JSONB`.
- `notes TEXT`.
- `created_at TIMESTAMPTZ`.

### 5.3 `processed_stripe_sessions`
- `session_id TEXT PRIMARY KEY`.
- `processed_at TIMESTAMPTZ DEFAULT now()`.

Purpose:
- Idempotency ledger so inventory decrement for same Stripe session is applied once.

---

## 6) API surface (DB-only MVP endpoints)

> Prefix for all endpoints: `/.netlify/functions/*`

### 6.1 `POST /admin-login`
- Auth: none (login endpoint).
- Request:
```json
{ "token": "string" }
```
- Success `200`:
```json
{ "ok": true }
```
- Side effect: sets `Set-Cookie: admin_auth=<ADMIN_TOKEN>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (+ `Secure` in prod).
- Errors:
  - `405` method not allowed.
  - `500` missing `ADMIN_TOKEN` env var.
  - `401` invalid token.

### 6.2 `POST /admin-logout`
- Auth: none required (cookie clear).
- Success `200 {"ok":true}` and expires `admin_auth` cookie.
- Errors: `405` method not allowed.

### 6.3 `GET|PATCH /admin-products`
- Auth: admin required (`requireAdmin`).
- GET success:
```json
{ "ok": true, "products": [ { "id": "...", "status": "draft|active|archived", "title": "...", "price_cents": 1000, "price": 10, "inventory": 1, "photos": [], "description": "..." } ] }
```
- PATCH request:
```json
{
  "id": "product-id",
  "updates": {
    "title": "optional",
    "description": "optional",
    "currency": "usd",
    "photos": ["https://..."],
    "tags": ["..."],
    "search_keywords": ["..."],
    "source_notes": "...",
    "buy_price_max_cents": 1200,
    "inventory": 2,
    "status": "draft|active|archived",
    "price": 39.99,
    "price_cents": 3999
  }
}
```
- PATCH success `200 { "ok": true, "product": { ...updated row... } }`
- Errors:
  - `401` unauthorized.
  - `429` auth rate limit.
  - `400` missing id / invalid fields / no updates.
  - `404` product not found.
  - `405` method not allowed.
  - `500` server/db/auth config.

### 6.4 `GET /active-products`
- Auth: public.
- Returns active DB products only.
- Success:
```json
{ "ok": true, "products": [ { "id":"...", "status":"active", "price":39.99, "inventory":1, "photos":[] } ] }
```
- Errors: `405`, `500` (returns empty list fallback in body).

### 6.5 `POST /create-checkout-session`
- Auth: public.
- Request:
```json
{ "items": [ { "productId": "id", "qty": 2 } ] }
```
- Alternate accepted shape: `{ "productId":"id", "qty":1 }`.
- Success:
```json
{ "ok": true, "url": "https://checkout.stripe.com/...", "id": "cs_test_..." }
```
- Server validations:
  - item structure and qty integer >=1.
  - product existence.
  - status active.
  - inventory >0 and qty <= inventory.
- Errors:
  - `400` bad input / sold out / qty exceeds stock.
  - `405` method not allowed.
  - `500` missing Stripe key/server errors.

### 6.6 `POST /stripe-webhook`
- Auth: Stripe signature (`stripe-signature` header).
- Required env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Request body: raw Stripe event JSON.
- Behavior:
  - Ignores non-completed events and unpaid sessions.
  - Applies inventory decrement transactionally and idempotently.
- Success `200 {"ok":true}` or `{ "ok": true, "ignored": true }`.
- Errors:
  - `400` invalid signature/payload.
  - `405` method.
  - `500` missing env vars.

### 6.7 `GET /ai-opportunities`
- Auth: admin.
- Returns exactly 3 queued opportunities (auto-generated if needed).
- Success:
```json
{ "ok": true, "opportunities": [ { "opp_id":"...", "category":"clothes|shoes", "title":"...", "max_buy_price":18, "suggested_price":52, "margin_estimate":"65%", "checklist":[] } ] }
```
- Errors: `401/429/500`.

### 6.8 `POST /ai-decline`
- Auth: admin.
- Request: `{ "opp_id": "..." }`.
- Deletes opportunity and returns refreshed queue (maintains 3).
- Errors: `400/401/429/405/500`.

### 6.9 `POST /ai-accept`
- Auth: admin.
- Request: `{ "opp_id": "..." }`.
- Transactionally creates draft product (`inventory=1`) and removes opportunity.
- Returns created product + refreshed opportunities.
- Errors: `400/401/404/405/500`.

### 6.10 `GET|PATCH|POST /draft-products`
- Auth: admin.
- Purpose in MVP: manage AI-created drafts (inventory/status/price/title edits).
- GET returns draft-only products.
- PATCH/POST updates a draft by id.
- Errors: `400/401/404/405/500`.

### 6.11 `GET /stripe-orders`
- Auth: admin.
- Query params:
  - `limit` (1..100, default 50)
  - `status` (`unshipped|shipped|all`, default `unshipped`)
  - `q` (search by order id/email)
- Success:
```json
{ "ok": true, "orders": [ { "id":"cs_...", "created":1730000000, "customer_email":"...", "recipient": {"name":"...","line1":"..."}, "items":[{"name":"...","quantity":1}], "amount_total":1234, "currency":"usd", "fulfillment_status":"unshipped|shipped", "tracking":"", "shipped_at":"" } ] }
```
- Errors: `401/429/500`.

### 6.12 `POST /stripe-mark-shipped`
- Auth: admin.
- Request:
```json
{ "sessionId":"cs_...", "tracking":"optional" }
```
- Side effect: updates Stripe session metadata (`fulfillment_status`, `tracking`, `shipped_at`).
- Errors: `400` missing sessionId, `401/429`, `405`, `500`.

### 6.13 `GET /health`
- Auth: admin.
- Returns minimal operational metadata:
```json
{ "ok": true, "stripeKeyPresent": true, "siteUrl": "https://...", "timestamp": "..." }
```

---

## 7) UI spec (admin pages/sections/components/states)

## 7.1 `/admin/login`
**Layout**
- Centered dark card.
- Header: “Admin login”.
- Body text: “Enter the shared admin token.”
- Fields/buttons:
  - Password input (`#token`, placeholder “Admin token”).
  - Submit button (“Sign in”).
  - Status line (`#status`).

**States**
- Idle: blank status.
- Loading: “Signing in…”.
- Error: invalid token / network error string.
- Success: redirect to `/admin/`.

## 7.2 `/admin/` custom dashboard
- No Decap/Netlify CMS runtime.
- No Netlify Identity runtime.
- Admin page renders immediately as custom dashboard after auth.
- Primary navigation is tab/buttons for:
  - AI Sourcing
  - DB Products
  - Orders

## 7.3 AI Sourcing tab
**Header/controls**
- Title: “AI Sourcing (Clothes & Shoes)”.
- Description: always 3 opportunities; Accept creates AI draft product.
- Refresh button.

**Opportunities list (exactly 3 cards)**
Each opportunity card shows:
- Title.
- Category chip (`clothes` or `shoes`).
- Suggested price + max buy + margin estimate.
- Keywords.
- Condition checklist.
- Buttons: **Accept**, **Decline**.

**AI draft products list**
- Card shows title, status, price.
- Inventory number input (min 0).
- Save button for inventory update.
- “Sold out” chip shown when inventory <=0.

**States**
- Loading opportunities.
- Loaded (3).
- Declined (auto-refreshed to 3).
- Accepted (draft created + list refreshed).
- Empty draft list (“No AI draft products yet.”).
- Error messages from API.

## 7.4 DB Products tab
**Controls**
- Refresh button.

**Per-product editable fields**
- Title input.
- Price input (`step 0.01`).
- Inventory integer input.
- Description textarea.
- Status select (`draft|active|archived`).
- Save button.

**Visual tags**
- “Sold out” chip when inventory <=0.

**States**
- Loading products.
- No products found.
- Save success/failure status text.

## 7.5 Orders tab
**Header controls**
- Status filter select: Unshipped / Shipped / All.
- Search input: email/order id.
- Refresh.

**Order row content**
- Summary: order id, created time, customer email, amount total, fulfillment status.
- Expanded body:
  - Ship To block (name + full address).
  - Items block (multi-item list with qty x name).
  - Tracking input.
  - Buttons: Print packing slip, Copy ship-to address, Mark shipped.

**Packing slip output requirements**
- Includes order id, date, ship-to, itemized list with qty.
- Includes blank “Tracking: __________” line for UPS drop-off workflow.

---

## 8) Storefront behavior

### 8.1 Product listing page
- Loads active products from public endpoint (`active-products`).
- Supports search, category filter, quick filters (All/In stock/Ready to ship/Under $50), and sort options.
- Product cards:
  - image, title, price, optional description.
  - stock badge (`Sold out` or `Low Stock`).
  - Sold out cards disable Add to Cart + Buy Now buttons.

### 8.2 Product detail page
- Resolves item by query `id` from active-products set.
- If missing/archived/draft -> “Product not found.”
- Displays image gallery + quantity input.
- Quantity input max is current inventory.
- Sold out disables quantity and action buttons.

### 8.3 Cart
- Supports multiple different products and quantities.
- Reconciles cart entries against current product feed:
  - unavailable product marked as blocked until removed.
  - sold-out product blocked until removed.
  - qty clamped to available inventory.
- Checkout disabled while blocked items exist.

### 8.4 Checkout
- Triggered via create-checkout-session endpoint.
- Sends cart array to server for authoritative validation.
- On success redirects to Stripe checkout URL.
- On error shows alert “Checkout failed: ...”.

### 8.5 Success/Cancel pages
- Success page shows confirmation and optional `session_id` as order ID.
- Cancel page states no charge made and links back to shop.

---

## 9) Inventory rules
- `inventory` is integer >=0 at DB level.
- UI sold-out rule: inventory <=0 means product cannot be purchased.
- API sold-out rule (`create-checkout-session`): reject if non-active, inventory <=0, or requested qty > inventory.
- Client qty clamp:
  - At add/update time, clamp to known inventory map.
  - Cart page auto-adjusts oversize qty down.
- Webhook decrement:
  - Applies after paid checkout completion event.
  - `GREATEST(0, inventory - qty)` prevents negatives.
- Idempotency:
  - `processed_stripe_sessions` checked in transaction before decrement.
  - Duplicate webhook deliveries for same session become no-op.

---

## 10) Security model

### 10.1 Admin authentication
- Shared secret in `ADMIN_TOKEN` env var.
- Login endpoint compares submitted token and issues HttpOnly cookie.
- Cookie name: `admin_auth`.
- No Netlify Identity tokens and no Identity SDK usage.

### 10.2 Edge gating
- Edge Function bound to `/admin/*`.
- Exempts `/admin/login` path.
- Redirects unauthenticated visitors to `/admin/login`.
- Returns 500 when `ADMIN_TOKEN` is missing.

### 10.3 Function-level auth checks
- Admin APIs call `requireAdmin(event)` from `_adminAuth`.
- Token accepted from cookie or Bearer header.
- Timing-safe comparison used to avoid token leak timing vectors.
- In-memory per-IP rate limiting (~120 requests/min window) across admin-authenticated functions.

### 10.4 Stripe webhook security
- Requires `stripe-signature` header.
- Validates payload with Stripe SDK + webhook secret.
- Rejects malformed/unsigned payloads.

### 10.5 Additional controls
- Security headers in `netlify.toml` (XFO, nosniff, CSP, referrer policy, permissions policy).
- Admin endpoints should return `Cache-Control: no-store` where sensitive.

---

## 11) Observability (minimal logs)

### 11.1 Log principles
- Log structured events at function boundaries.
- Never log secrets/tokens or full payment PII.
- Include request correlation context when available (function name, timestamp, session/order IDs truncated if needed).

### 11.2 Suggested logs by flow
- `admin-login`: success/failure + source IP (no token value).
- `requireAdmin` failures: reason (`unauthorized`, `rate_limited`, `missing_env`).
- `create-checkout-session`: item count, validation failure reason, generated session ID.
- `stripe-webhook`: event type, paid/ignored/applied, session ID, decrement applied bool.
- `ai-*`: generation source (`openai|fallback`), queue refill count, accepted/declined opp IDs.
- `admin-products` PATCH: product ID, changed fields, actor=admin token auth.
- `stripe-orders`/`mark-shipped`: order counts loaded, mark-shipped success/failure.

---

## 12) Test plan

### 12.1 Smoke tests
- Admin login:
  - invalid token rejected.
  - valid token sets cookie and redirects.
- Edge auth:
  - `/admin/` redirects without cookie.
  - `/admin/` loads with valid cookie.
- Product APIs:
  - GET `active-products` returns only active items.
  - PATCH `admin-products` updates inventory/status.
- AI queue:
  - GET `ai-opportunities` returns exactly 3.
  - POST `ai-decline` returns refreshed 3.
  - POST `ai-accept` creates draft with inventory=1.
- Checkout:
  - Sold-out item rejected by create-checkout-session.
  - In-stock multi-item accepted.

### 12.2 E2E scenarios
1. **Publish lifecycle**
   - Create draft -> set active -> verify appears on storefront without redeploy.
2. **Sold-out enforcement**
   - Set inventory=0 -> verify Sold out on listing/product page and checkout API rejects.
3. **Cart multi-item validation**
   - Add two items with valid quantities -> checkout session created.
4. **Webhook decrement + idempotency**
   - Send checkout.session.completed paid fixture once -> inventory decremented.
   - Replay same event -> inventory unchanged.
5. **Fulfillment flow**
   - Load paid orders in admin -> print packing slip -> mark shipped -> verify order status filter behavior.

### 12.3 Failure-injection tests
- DB unavailable: endpoints return controlled 500s and storefront shows error state.
- Stripe API failure on checkout/session listing: admin/storefront show actionable errors.
- Missing env vars: login/webhook return explicit configuration errors.

---

## 13) Deployment checklist

### 13.1 Environment variables
Required:
- `DATABASE_URL`
- `ADMIN_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `OPENAI_API_KEY`

Recommended:
- `OPENAI_MODEL` (default fallback exists)
- `URL` or `SITE_URL` for checkout redirects

### 13.2 DB migrations/setup
1. Provision Postgres.
2. Run:
   - `psql "$DATABASE_URL" -f db/schema.sql`
3. Verify tables exist: `products`, `ai_opportunities`, `processed_stripe_sessions`.
4. Seed initial products (draft or active) as needed.

### 13.3 Stripe webhook setup
1. In Stripe Dashboard, create endpoint:
   - `https://<site>/.netlify/functions/stripe-webhook`
2. Subscribe to event:
   - `checkout.session.completed`
3. Copy signing secret to `STRIPE_WEBHOOK_SECRET`.
4. Validate with Stripe test event + fixture replay.

### 13.4 Netlify routing/security
- Confirm edge function mapping `/admin/* -> admin-auth`.
- Confirm `/admin/login` path remains accessible without cookie.
- Confirm CSP/headers in `netlify.toml` align with allowed Stripe/OpenAI origins.

---

## 14) Edge cases + failure modes

### DB down/unreachable
- `active-products`, `admin-products`, `draft-products`, webhook, AI DB flows fail with 500.
- Expected UX: storefront error/empty state, admin status errors, no silent success.

### Stripe down/API errors
- `create-checkout-session` fails with 500 + error text.
- Orders tab cannot load; should keep existing UI and display actionable error.
- mark-shipped may fail; no local DB fallback.

### Webhook retries/out-of-order
- Duplicate deliveries safe due to processed session ledger.
- Unpaid/completed mismatch ignored.
- Missing/invalid metadata cart means no decrements (safe fail).

### Out-of-sync inventory
- Race: multiple checkouts can be initiated before webhook decrements complete.
- Mitigation currently partial: checkout validates current inventory but does not reserve stock.
- Consequence: oversell still possible in narrow concurrency window.

### Auth misconfiguration
- Missing `ADMIN_TOKEN` causes login/admin failures and edge 500 on admin routes.
- Cookie invalidation requires re-login when token rotates.

### Client stale data
- User may hold stale product list in memory.
- Final guard remains server-side checkout validation.

---

## 15) Migration note
- If Decap/Netlify CMS artifacts still exist in the repo, they are deprecated and must be removed from `/admin` runtime paths to avoid Netlify Identity login prompts.

---

## 16) TODO list (future improvements)
- Add DB-backed `orders` table to persist Stripe order snapshots and fulfillment state independent of Stripe metadata.
- Add optimistic inventory reservation at checkout session creation (or short-lived cart reservation table).
- Add webhook handling for refunds/cancellations to restock when appropriate.
- Add product image upload management workflow (signed uploads/CDN) with validation.
- Add role-based admin accounts and token rotation UX instead of shared static token.
- Add audit log table for admin mutations (who changed what/when).
- Add structured JSON logging + dashboard alerts for webhook failures and auth anomalies.
- Add dead-letter/retry strategy for webhook processing failures.
- Add pagination and advanced filters to DB products and orders tabs.
- Add automated tests for edge function cookie gating in CI.

---

## 17) Screenshots-as-text (admin sections)

### A) Admin Login screen
- Full-page dark background.
- Center card with:
  - Heading: **Admin login**
  - Text: **Enter the shared admin token.**
  - Field: password input labeled by placeholder **Admin token**
  - Button: **Sign in**
  - Inline status line below button.

### B) `/admin/` custom dashboard
- Header with title **Sawtooth Thrift Admin**.
- Three primary tab buttons:
  - **AI Sourcing**
  - **DB Products**
  - **Orders**
- Action buttons in header:
  - **Refresh active tab**
  - **Logout**

### C) AI Sourcing tab
- Section title: **AI Sourcing (Clothes & Shoes)**.
- Button: **Refresh opportunities**.
- Opportunities column with exactly 3 cards; each card includes:
  - Title
  - Category/margin indicators
  - Buy max and suggested price
  - Keywords and checklist
  - Buttons: **Accept** and **Decline**
- AI Draft Products column; each card includes:
  - Draft title/status/price
  - Inventory numeric input
  - **Save** button
  - Sold-out chip when inventory is 0

### D) DB Products tab
- Section title: **DB Products**.
- Button: **Refresh products**.
- Product cards include fields:
  - `title` input
  - `price` input (decimal)
  - `inventory` input (integer)
  - `status` select (`draft`, `active`, `archived`)
  - `description` textarea
  - **Save** button
- Sold-out chip appears for inventory <=0.

### E) Orders tab
- Section title: **Orders**.
- Controls row:
  - Dropdown: **Unshipped / Shipped / All**
  - Search input: **Search order id or email**
  - Button: **Refresh orders**
- Each order row/accordion shows:
  - Order ID, date/time, email, status
  - Ship-to address block
  - Items block (`qty x item`)
  - Tracking input field
  - Buttons: **Print packing slip**, **Copy ship-to address**, **Mark shipped**
