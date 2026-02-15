const { query } = require('./_db');

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function toCents(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100);
}

function createSearchQuery(raw) {
  const keywords = Array.isArray(raw.search_keywords) ? raw.search_keywords.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const base = [raw.title, ...keywords].map((s) => String(s || '').trim()).filter(Boolean).slice(0, 6).join(' ');
  return base || String(raw.title || 'thrift finds').trim() || 'thrift finds';
}

function buildBuyLinks(raw) {
  const q = createSearchQuery(raw);
  const enc = encodeURIComponent(q);
  return [
    { label: 'eBay', url: `https://www.ebay.com/sch/i.html?_nkw=${enc}` },
    { label: 'Poshmark', url: `https://poshmark.com/search?query=${enc}` },
    { label: 'Depop', url: `https://www.depop.com/search/?q=${enc}` },
    { label: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${enc}` },
    { label: 'Facebook Marketplace', url: `https://www.facebook.com/marketplace/search/?query=${enc}` },
  ];
}

function buildLocalPickup(raw) {
  const q = createSearchQuery(raw);
  const enc = encodeURIComponent(`${q} Twin Falls Idaho`);
  return [
    { place: 'Facebook Marketplace (Twin Falls)', url: `https://www.facebook.com/marketplace/twin-falls/search/?query=${enc}` },
    { place: 'OfferUp (Twin Falls)', url: `https://offerup.com/search/?q=${enc}` },
    { place: 'Google Maps: thrift stores Twin Falls', url: 'https://www.google.com/maps/search/thrift+stores+in+Twin+Falls+Idaho' },
    { place: 'Google Maps: consignment Twin Falls', url: 'https://www.google.com/maps/search/consignment+stores+in+Twin+Falls+Idaho' },
  ];
}

function normalizeOpp(raw) {
  const maxBuy = toCents(raw.max_buy_price ?? raw.max_buy_price_cents / 100, 1800);
  const minSuggested = Math.ceil(maxBuy * 1.6);
  const suggested = Math.max(toCents(raw.suggested_price ?? raw.suggested_price_cents / 100, minSuggested), minSuggested);
  const margin = Math.max(40, Math.round(((suggested - maxBuy) / Math.max(suggested, 1)) * 100));
  const category = String(raw.category || '').toLowerCase().includes('shoe') ? 'shoes' : 'clothes';

  return {
    opp_id: uid('opp'),
    category,
    title: String(raw.title || `${raw.brand || ''} ${raw.item_type || 'item'}`).trim() || 'Resale opportunity',
    max_buy_price_cents: maxBuy,
    suggested_price_cents: suggested,
    expected_margin_pct: margin,
    search_keywords: Array.isArray(raw.search_keywords) ? raw.search_keywords.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8) : [],
    buy_links: buildBuyLinks(raw),
    local_pickup: buildLocalPickup(raw),
    condition_checklist: Array.isArray(raw.condition_checklist || raw.checklist) ? (raw.condition_checklist || raw.checklist).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8) : [],
    notes: String(raw.notes || raw.source_notes || '').trim(),
  };
}

function fallback(count) {
  const seed = [
    { category: 'shoes', title: 'Nike Air Max 90 (used)', max_buy_price: 32, suggested_price: 89, search_keywords: ['nike air max 90','sneakers men 10'], condition_checklist: ['check heel wear','clean midsoles'], notes: 'High demand sneaker in Twin Falls listings.' },
    { category: 'clothes', title: "Levi's 501 jeans vintage wash", max_buy_price: 18, suggested_price: 52, search_keywords: ['levis 501', 'vintage denim'], condition_checklist: ['measure inseam','check zipper/button'], notes: 'Evergreen denim sell-through.' },
    { category: 'shoes', title: 'Dr Martens 1460 boots', max_buy_price: 45, suggested_price: 115, search_keywords: ['doc martens 1460', 'combat boots'], condition_checklist: ['inspect sole split','condition leather'], notes: 'Strong margin with authentic pairs.' },
    { category: 'clothes', title: 'Patagonia fleece quarter zip', max_buy_price: 22, suggested_price: 68, search_keywords: ['patagonia fleece', 'quarter zip'], condition_checklist: ['check pilling', 'test zipper'], notes: 'Outdoor brand sells quickly.' },
  ];
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(normalizeOpp(seed[i % seed.length]));
  return out;
}

async function openAiGenerate(count) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback(count);

  const prompt = `Generate ${count} resale opportunities for Twin Falls, Idaho, CLOTHES + SHOES only. Return strict JSON array objects with keys: category,title,max_buy_price,suggested_price,expected_margin_pct,search_keywords,condition_checklist,notes. Enforce expected_margin_pct >= 40 and suggested_price >= max_buy_price * 1.6.`;

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', input: prompt, max_output_tokens: 1200 }),
  });
  if (!res.ok) return fallback(count);
  const data = await res.json().catch(() => ({}));
  let parsed = [];
  try { parsed = JSON.parse(data.output_text || '[]'); } catch { parsed = []; }
  if (!Array.isArray(parsed) || !parsed.length) return fallback(count);
  return parsed.slice(0, count).map(normalizeOpp);
}

async function ensureAiOpportunityColumns() {
  await query(`ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS buy_links JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS local_pickup JSONB NOT NULL DEFAULT '[]'::jsonb`);
}

async function insertOpp(opp) {
  await ensureAiOpportunityColumns();
  await query(
    `INSERT INTO ai_opportunities (opp_id,category,title,max_buy_price_cents,suggested_price_cents,expected_margin_pct,search_keywords,buy_links,local_pickup,condition_checklist,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11)
     ON CONFLICT (opp_id) DO NOTHING`,
    [opp.opp_id, opp.category, opp.title, opp.max_buy_price_cents, opp.suggested_price_cents, opp.expected_margin_pct, JSON.stringify(opp.search_keywords || []), JSON.stringify(opp.buy_links || []), JSON.stringify(opp.local_pickup || []), JSON.stringify(opp.condition_checklist || []), opp.notes || '']
  );
}

async function ensureOpportunities(minCount = 3) {
  await ensureAiOpportunityColumns();
  const existing = await query(`SELECT * FROM ai_opportunities ORDER BY created_at ASC`);
  if (existing.rows.length < minCount) {
    const generated = await openAiGenerate(Math.max(5, minCount - existing.rows.length));
    // eslint-disable-next-line no-restricted-syntax
    for (const opp of generated) await insertOpp(opp);
  }

  const refreshed = await query(`SELECT * FROM ai_opportunities ORDER BY created_at ASC LIMIT 3`);
  return refreshed.rows;
}

module.exports = { ensureOpportunities, normalizeOpp };
