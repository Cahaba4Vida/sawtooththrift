(function () {
  const wrap = document.getElementById("productWrap");

  // Defensive: this script only runs on product pages.
  if (!wrap) return;


function slugify(str) {
    return String(str || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "item";
  }

  function ensureId(p) {
    if (p && p.id) return String(p.id);
    const base = `${p?.name || ""}-${p?.price || ""}-${p?.image || ""}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) hash = ((hash << 5) - hash) + base.charCodeAt(i) | 0;
    const hex = (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
    return `${slugify(p?.name || "item")}-${hex}`;
  }
function qp(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }

  
  // SEO: set canonical URL to include product id when present
  (function setCanonical() {
    try {
      var id = qp("id");
      var link = document.getElementById("canonicalLink");
      if (!link) return;
      var url = "https://sawtooththrift.com/product.html";
      if (id) url += "?id=" + encodeURIComponent(id);
      link.setAttribute("href", url);
    } catch (_) {}
  })();

  function conditionToSchema(condition) {
    const c = String(condition || "").toLowerCase();
    if (c.includes("new")) return "https://schema.org/NewCondition";
    if (c.includes("like")) return "https://schema.org/UsedCondition";
    if (c.includes("good")) return "https://schema.org/UsedCondition";
    if (c.includes("fair")) return "https://schema.org/UsedCondition";
    return "https://schema.org/UsedCondition";
  }

  function availabilityToSchema(p) {
    const qty = Number(p.quantity ?? p.qty);
    const sold = (Number.isFinite(qty) && qty <= 0) || p.status === "sold" || p.status === "inactive";
    return sold ? "https://schema.org/OutOfStock" : "https://schema.org/InStock";
  }

  function injectProductJsonLd(p) {
    try {
      const canonical = (document.getElementById("canonicalLink") || {}).href || "https://sawtooththrift.com/product.html";
      const data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": p.name || "Product",
        "description": (p.description_long || p.description_short || "").trim(),
        "image": (p.gallery && p.gallery.length ? p.gallery : [p.image]).filter(Boolean).map(src => {
          // Support absolute URLs or relative assets
          if (/^https?:\/\//i.test(src)) return src;
          return "https://sawtooththrift.com/" + String(src).replace(/^\//,"");
        }),
        "brand": { "@type": "Brand", "name": "Sawtooth Thrift" },
        "sku": p.id || undefined,
        "itemCondition": conditionToSchema(p.condition),
        "offers": {
          "@type": "Offer",
          "url": canonical,
          "priceCurrency": "USD",
          "price": (p.price != null ? String(p.price).replace(/[^0-9.]/g,"") : undefined),
          "availability": availabilityToSchema(p)
        }
      };
      // Remove undefined keys
      const clean = JSON.parse(JSON.stringify(data));
      const el = document.createElement("script");
      el.type = "application/ld+json";
      el.text = JSON.stringify(clean);
      document.head.appendChild(el);
    } catch (_) {}
  }

function formatPrice(n, currency) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(num);
    } catch {
      return `$${num.toFixed(2)}`;
    }
  }

  async function loadCatalog() {
    const endpoints = ["/.netlify/functions/products", "/data/products.json"];
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load products from ${endpoint}`);
        const data = await res.json();
        if (data && data.ok === false) throw new Error(data.error || "Catalog API error");
        return data;
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("Failed to load catalog");
  }

  async function init() {
    const id = qp("id");
    if (!id) {
      wrap.innerHTML = `<div class="card pad">Missing product id.</div>`;
      return;
    }

    try {
      const data = await loadCatalog();

      const currency = data.currency || "USD";
      const products = Array.isArray(data.products) ? data.products : [];
      const p = products.find((x) => x && (String(x.id) === id || ensureId(x) === id));

      if (!p || p.status !== "active") {
        wrap.innerHTML = `<div class="card pad">Product not found.</div>`;
        return;
      }

      const images = [p.image, ...(Array.isArray(p.gallery) ? p.gallery : [])].filter(Boolean);

      const qty = Number.isFinite(Number(p.quantity ?? p.qty)) ? Number(p.quantity ?? p.qty) : null;
      const isSoldOut = (qty !== null && qty <= 0) || p.status === "sold" || p.status === "inactive";
      const buyLink = p.stripe_payment_link || "#";
      const itemName = p.name || "this item";
      const askSms = `sms:+12082808976?&body=${encodeURIComponent(`Hi! I'm interested in ${itemName}. Is it still available?`)}`;

      document.title = p.name ? `${p.name} | Sawtooth Thrift` : "Product";

      wrap.innerHTML = `
        <div class="product-detail">
          <div class="product-detail-media card">
            ${
              images.length
                ? `<img src="${images[0]}" alt="${p.name || "Product"}" />`
                : `<div class="img-placeholder tall">No Image</div>`
            }
            ${
              images.length > 1
                ? `<div class="thumbs">
                    ${images
                      .map(
                        (src, idx) =>
                          `<button class="thumb" data-src="${src}" aria-label="View image ${idx + 1}">
                            <img src="${src}" alt="${escapeHtml(p.name || "Product")} thumbnail" loading="lazy" />
                          </button>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>

          <div class="product-detail-body">
            <div class="product-detail-top">
              <h1>${p.name || "Untitled"}</h1>
              <div class="price">${formatPrice(p.price, currency)}</div>
            </div>

            ${p.description_long ? `<p class="muted">${p.description_long}</p>` : (p.description_short ? `<p class="muted">${p.description_short}</p>` : "")}
${(p.condition || p.size || p.dimensions || qty !== null) ? `
            <div class="product-meta" style="margin-top:10px;">
              ${p.condition ? `<span class="pill">${p.condition}</span>` : ``}
              ${(p.size || p.dimensions) ? `<span class="pill">${[p.size, p.dimensions].filter(Boolean).join(" • ")}</span>` : ``}
              ${qty !== null ? `<span class="pill pill-soft">${isSoldOut ? "Sold Out" : `In stock: ${qty}`}</span>` : ``}
            </div>
          ` : ``}

            <div class="detail-notes">
              ${p.inventory_note ? `<div class="note"><div class="note-title">Availability</div><div class="muted small">${p.inventory_note}</div></div>` : ""}
              ${p.shipping_note ? `<div class="note"><div class="note-title">Shipping</div><div class="muted small">${p.shipping_note}</div></div>` : ""}
            </div>

            <div class="detail-actions">
              ${isSoldOut ? `<span class="btn" style="opacity:0.55;pointer-events:none;">Sold Out</span>` : `<a class="btn" href="${buyLink}" target="_blank" rel="noopener">Buy Now</a>`}
              <a class="btn btn-ghost" href="${askSms}">Text us</a>
            </div>
          </div>
        </div>
        <div class="mobile-buybar">
          <div>
            <div class="muted small">${p.name || "Item"}</div>
            <div class="price">${formatPrice(p.price, currency)}</div>
          </div>
          ${isSoldOut ? `<span class="btn" style="opacity:0.55;pointer-events:none;">Sold Out</span>` : `<a class="btn" href="${buyLink}" target="_blank" rel="noopener">Buy Now</a>`}
        </div>
      `;

      const mainImg = wrap.querySelector(".product-detail-media img");
      wrap.querySelectorAll(".thumb").forEach((btn) => {
        btn.addEventListener("click", () => {
          const src = btn.getAttribute("data-src");
          if (mainImg && src) mainImg.src = src;
        });
      });
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<div class="card pad">Error loading product.</div>`;
    }
  }

  init();
})();