(function () {
  const grid = document.getElementById("productsGrid");
  const emptyState = document.getElementById("emptyState");
  const statCount = document.getElementById("statCount");
  const searchInput = document.getElementById("searchInput");
  const categorySelect = document.getElementById("categorySelect");
  const sortSelect = document.getElementById("sortSelect");
  const quickFilters = Array.from(document.querySelectorAll(".chip[data-filter]"));
  const recentlySoldWrap = document.getElementById("recentlySoldWrap");
  const recentlySoldGrid = document.getElementById("recentlySoldGrid");

  // Defensive: if expected elements are missing, abort gracefully (prevents runtime errors on other pages).
  if (!grid) return;


  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeHtmlAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  function slugify(str) {
    return String(str ?? "")
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function ensureId(p) {
    // Optional ID: if missing, generate a deterministic ID from name+price+image so links remain stable.
    if (p && p.id) return String(p.id);
    const base = `${p?.name || ""}-${p?.price || ""}-${p?.image || ""}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) hash = ((hash << 5) - hash) + base.charCodeAt(i) | 0;
    const hex = (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
    return `${slugify(p?.name || "item")}-${hex}`;
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

  function isValidStripePaymentLink(url) {
    const v = String(url || "").trim();
    if (!v || v.includes("REPLACE_ME")) return false;
    return /^https:\/\/buy\.stripe\.com\//i.test(v);
  }

  function normalizeTags(tags) {
    if (!tags) return [];
    if (!Array.isArray(tags)) return [];
    return tags.map(t => (typeof t === "string" ? t : t?.tag)).filter(Boolean).map(String);
  }

  function getCardImg(p) {
    const primary = p.image;
    const hover = Array.isArray(p.gallery) && p.gallery.length ? p.gallery[0] : null;
    return { primary, hover };
  }


  function isSoldOutProduct(p) {
    const qty = (p.quantity === 0 || Number.isFinite(Number(p.quantity))) ? Number(p.quantity) : null;
    const status = String(p.status || "").toLowerCase();
    return status === "sold" || status === "inactive" || (qty !== null && qty <= 0);
  }

  function filterByQuick(products, mode) {
    const m = String(mode || "all").toLowerCase();
    if (m === "in-stock") return products.filter(p => !isSoldOutProduct(p));
    if (m === "ready-ship") return products.filter(p => !Boolean(p.pickup_only));
    if (m === "under-50") return products.filter(p => Number(p.price) < 50);
    return products;
  }

  function sortProducts(products, mode) {
    const list = products.slice();
    const m = String(mode || "featured").toLowerCase();
    if (m === "price-asc") return list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    if (m === "price-desc") return list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    if (m === "name-asc") return list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return list;
  }

  function renderCard(p, currency) {
    const id = ensureId(p);
    const safeName = p.name ? String(p.name) : "Item";
    const { primary, hover } = getCardImg(p);

    const qty = (p.quantity === 0 || Number.isFinite(Number(p.quantity))) ? Number(p.quantity) : null;
    const isSold = String(p.status || "").toLowerCase() === "sold";
    const inactive = String(p.status || "").toLowerCase() === "inactive";
    const soldOutByQty = qty !== null && qty <= 0;
    const isSoldOut = isSold || inactive || soldOutByQty;

    const condition = p.condition ? `<span class="pill">${escapeHtml(p.condition)}</span>` : "";
    const sizeDims = [p.size, p.dimensions].filter(Boolean).join(" • ");
    const sizePill = sizeDims ? `<span class="pill">${escapeHtml(sizeDims)}</span>` : "";

    const pickupOnly = Boolean(p.pickup_only);
    const pickupPill = pickupOnly ? `<span class="pill pill-soft">Pickup only</span>` : "";
    const fulfillment = (!pickupOnly && p.shipping_note) ? `<span class="pill pill-soft">${escapeHtml(p.shipping_note)}</span>` : "";

    const tags = normalizeTags(p.tags);
    const tagsHtml = tags.slice(0, 3).map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("");

    const buy = p.stripe_payment_link ? String(p.stripe_payment_link) : "#";
    const hasValidBuyLink = isValidStripePaymentLink(buy);

    // Image: swap on hover if hover image exists
    const imgHtml = primary
      ? `<img src="${escapeHtmlAttr(primary)}" alt="${escapeHtmlAttr(safeName)}" loading="lazy" data-primary="${escapeHtmlAttr(primary)}" ${hover ? `data-hover="${escapeHtmlAttr(hover)}"` : ""} />`
      : `<div class="img-placeholder">No Image</div>`;

    return `
      <article class="card product" data-name="${escapeHtmlAttr(safeName)}">
        <a class="product-media" href="/product.html?id=${encodeURIComponent(id)}" aria-label="View ${escapeHtmlAttr(safeName)}">
          ${imgHtml}
        </a>

        <div class="product-body">
          <div class="product-top">
            <h3 class="product-title">${escapeHtml(safeName)}</h3>
            <div class="product-price">${formatPrice(p.price, currency)}</div>
          </div>

          ${p.description_short ? `<p class="product-desc muted small">${escapeHtml(p.description_short)}</p>` : ""}

          <div class="product-meta">
            ${condition}
            ${sizePill}
            ${fulfillment}
            ${pickupPill}
            ${qty !== null ? `<span class="pill ${isSoldOut ? "pill-soft" : ""}">${isSoldOut ? "Sold Out" : `In stock: ${qty}`}</span>` : ""}
            ${tagsHtml}
          </div>

          ${pickupOnly && p.pickup_note ? `<div class="muted small">Pickup: ${escapeHtml(p.pickup_note)}</div>` : ""}
          ${!pickupOnly && p.shipping_note ? `<div class="muted small">Ships: ${escapeHtml(p.shipping_note)}</div>` : ""}

          <div class="product-actions">
            <a class="btn btn-ghost" href="/product.html?id=${encodeURIComponent(id)}">Details</a>
            ${isSoldOut
              ? `<span class="btn" style="opacity:0.55; cursor:not-allowed;">Sold Out</span>`
              : hasValidBuyLink
                ? `<a class="btn" href="${escapeHtmlAttr(buy)}" target="_blank" rel="noopener">Buy Now</a>`
                : `<span class="btn" style="opacity:0.55; cursor:not-allowed;">Checkout unavailable</span>`}
          </div>

          <div class="product-footlinks">
            <a class="muted small link" href="#contact" data-inquire="${escapeHtmlAttr(safeName)}">Ask about this item</a>
            <a class="muted small link" href="sms:+12082808976?&body=${encodeURIComponent(`Hi! I'm interested in ${safeName}. Is it still available?`)}">Text us</a>
          </div>
        </div>
      </article>
    `;
  }

  function soldCard(p, currency) {
    const safeName = p.name ? String(p.name) : "Item";
    const { primary } = getCardImg(p);
    return `
      <article class="card product" aria-label="Recently sold: ${escapeHtmlAttr(safeName)}">
        <div class="product-media">
          ${primary ? `<img src="${escapeHtmlAttr(primary)}" alt="${escapeHtmlAttr(safeName)}" loading="lazy" />` : `<div class="img-placeholder">Sold</div>`}
        </div>
        <div class="product-body">
          <div class="product-top">
            <h3 class="product-title">${escapeHtml(safeName)}</h3>
            <div class="product-price">${formatPrice(p.price, currency)}</div>
          </div>
          <div class="product-meta">
            <span class="pill pill-soft">Recently sold</span>
            ${p.condition ? `<span class="pill">${escapeHtml(p.condition)}</span>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function applyHoverSwap() {
    grid.querySelectorAll("img[data-hover]").forEach(img => {
      const primary = img.getAttribute("data-primary");
      const hover = img.getAttribute("data-hover");
      const parent = img.closest(".product-media");
      if (!parent || !primary || !hover) return;

      parent.addEventListener("mouseenter", () => { img.src = hover; });
      parent.addEventListener("mouseleave", () => { img.src = primary; });

      // Touch devices: press to preview second image.
      parent.addEventListener("touchstart", () => { img.src = hover; }, { passive: true });
      parent.addEventListener("touchend", () => { img.src = primary; }, { passive: true });
    });
  }

  function wireInquireAutofill() {
    document.querySelectorAll('[data-inquire]').forEach(a => {
      a.addEventListener("click", () => {
        const name = a.getAttribute("data-inquire") || "";
        const textarea = document.querySelector('textarea[name="message"]');
        if (!textarea) return;
        const prefix = `Question about: ${name}\n\n`;
        if (!textarea.value.includes(prefix)) textarea.value = prefix + textarea.value;
        textarea.focus();
      });
    });
  }

  function setEmptyState(show) {
    if (!emptyState) return;
    if (emptyState) emptyState.classList.toggle("hidden", !show);
  }

  function filterProducts(products, q, cat, quickMode) {
    const query = (q || "").toLowerCase().trim();
    const category = (cat || "").toLowerCase().trim();
    const base = products.filter(p => {
      const status = String(p.status || "active").toLowerCase();
      if (status !== "active") return false;

      const hay = [
        p.name,
        p.description_short,
        p.description_long,
        p.condition,
        p.size,
        p.dimensions,
        ...(normalizeTags(p.tags))
      ].filter(Boolean).join(" ").toLowerCase();

      const okQuery = !query || hay.includes(query);
      const okCat = !category || normalizeTags(p.tags).some(t => String(t).toLowerCase() === category);
      return okQuery && okCat;
    });
    return filterByQuick(base, quickMode);
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
    try {
      const data = await loadCatalog();
      const currency = data.currency || "USD";
      const products = Array.isArray(data.products) ? data.products : [];

      // Populate categories from tags
      const tagSet = new Set();
      products.forEach(p => normalizeTags(p.tags).forEach(t => tagSet.add(String(t))));
      const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
      if (categorySelect) {
        categorySelect.innerHTML = `<option value="">All categories</option>` + tags.map(t => `<option value="${escapeHtmlAttr(t)}">${escapeHtml(t)}</option>`).join("");
      }

      let quickMode = "all";

      function setQuickFilter(nextMode) {
        quickMode = nextMode || "all";
        quickFilters.forEach((chip) => chip.classList.toggle("is-active", chip.getAttribute("data-filter") === quickMode));
      }

      function render() {
        const q = searchInput ? searchInput.value : "";
        const cat = categorySelect ? categorySelect.value : "";
        const mode = sortSelect ? sortSelect.value : "featured";
        const active = sortProducts(filterProducts(products, q, cat, quickMode), mode);

        if (statCount) statCount.textContent = String(active.length);

        grid.innerHTML = active.map(p => renderCard(p, currency)).join("");
        applyHoverSwap();
        wireInquireAutofill();

        setEmptyState(active.length === 0);

        // Recently sold proof
        const sold = products.filter(p => String(p.status || "").toLowerCase() === "sold").slice(0, 3);
        if (recentlySoldWrap && recentlySoldGrid) {
          if (sold.length) {
            if (recentlySoldWrap) recentlySoldWrap.classList.remove("hidden");
            if (recentlySoldGrid) recentlySoldGrid.innerHTML = sold.map(p => soldCard(p, currency)).join("");
          } else {
            if (recentlySoldWrap) recentlySoldWrap.classList.add("hidden");
            if (recentlySoldGrid) recentlySoldGrid.innerHTML = "";
          }
        }
      }

      if (searchInput) searchInput.addEventListener("input", render);
      if (categorySelect) categorySelect.addEventListener("change", render);
      if (sortSelect) sortSelect.addEventListener("change", render);
      quickFilters.forEach((chip) => {
        chip.addEventListener("click", () => {
          setQuickFilter(chip.getAttribute("data-filter") || "all");
          render();
        });
      });

      setQuickFilter("all");
      render();
    } catch (e) {
      console.error(e);
      grid.innerHTML = `<div class="card pad">Error loading products.</div>`;
      setEmptyState(true);
    }
  }

  init();
})();
