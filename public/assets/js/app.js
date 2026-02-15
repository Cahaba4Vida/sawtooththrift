(function () {
  const grid = document.getElementById("productsGrid");
  const emptyState = document.getElementById("emptyState");
  const statCount = document.getElementById("statCount");
  const searchInput = document.getElementById("searchInput");
  const categorySelect = document.getElementById("categorySelect");
  const sortSelect = document.getElementById("sortSelect");
  const quickFilters = Array.from(document.querySelectorAll(".chip[data-filter]"));

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

  function formatPrice(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "";
    return `$${num.toFixed(2)}`;
  }

  function showToast(msg) {
    const toast = document.createElement("div");
    toast.textContent = msg;
    toast.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 12px;border-radius:999px;z-index:100001;font:600 13px/1.1 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1300);
  }

  function stockState(p) {
    if (Number.isFinite(p.inventory)) {
      if (p.inventory <= 0) return { soldOut: true, low: false, label: "Sold out" };
      if (p.inventory <= 3) return { soldOut: false, low: true, label: `Low Stock (${p.inventory})` };
      return { soldOut: false, low: false, label: "In Stock" };
    }
    return { soldOut: false, low: false, label: "In Stock" };
  }

  function filterByQuick(products, mode) {
    const m = String(mode || "all").toLowerCase();
    if (m === "in-stock") return products.filter((p) => !stockState(p).soldOut);
    if (m === "ready-ship") {
      return products.filter((p) => {
        const stock = stockState(p);
        return !stock.soldOut && (!Number.isFinite(p.inventory) || p.inventory <= 3);
      });
    }
    if (m === "under-50") return products.filter((p) => Number(p.price) < 50);
    return products;
  }

  function filterByCategory(products, category) {
    const selected = String(category || "").trim().toLowerCase();
    if (!selected) return products;
    return products.filter((p) => String(p.category || "").trim().toLowerCase() === selected);
  }

  function sortProducts(products, mode) {
    const list = products.slice();
    const m = String(mode || "featured").toLowerCase();
    if (m === "price-asc") return list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    if (m === "price-desc") return list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    if (m === "name-asc") return list.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    return list;
  }

  function renderCard(p) {
    const stock = stockState(p);
    const primary = p.photos[0] || "";

    return `
      <article class="card product" data-name="${escapeHtmlAttr(p.title)}">
        <a class="product-media" href="/product.html?id=${encodeURIComponent(p.id)}" aria-label="View ${escapeHtmlAttr(p.title)}">
          ${primary ? `<img src="${escapeHtmlAttr(primary)}" alt="${escapeHtmlAttr(p.title)}" loading="lazy" />` : `<div class="img-placeholder">No Image</div>`}
          ${stock.soldOut ? `<span class="stock-badge stock-sold">Sold out</span>` : stock.low ? `<span class="stock-badge stock-low">${escapeHtml(stock.label)}</span>` : ""}
        </a>

        <div class="product-body">
          <div class="product-top">
            <h3 class="product-title">${escapeHtml(p.title)}</h3>
            <div class="product-price">${formatPrice(p.price)}</div>
          </div>

          ${p.description ? `<p class="product-desc muted small">${escapeHtml(p.description)}</p>` : ""}

          <div class="product-actions">
            ${stock.soldOut
              ? `<button class="btn" type="button" disabled aria-disabled="true">Sold out</button><button class="btn btn-ghost" type="button" disabled aria-disabled="true">Buy Now</button>`
              : `<button class="btn" type="button" data-add-cart-id="${escapeHtmlAttr(p.id)}">Add to Cart</button><button class="btn btn-ghost" type="button" data-checkout-id="${escapeHtmlAttr(p.id)}">Buy Now</button>`}
          </div>
        </div>
      </article>
    `;
  }

  function wireCheckoutButtons() {
    grid.querySelectorAll("[data-add-cart-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const productId = btn.getAttribute("data-add-cart-id") || "";
        if (!productId || !window.Cart) return;
        window.Cart.addToCart(productId, 1);
        showToast("Added to cart");
      });
    });

    grid.querySelectorAll("[data-checkout-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const productId = btn.getAttribute("data-checkout-id") || "";
        if (!productId || typeof window.startCheckout !== "function") return;

        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Starting checkout…";

        const ok = await window.startCheckout([{ productId, qty: 1 }]);
        if (!ok) {
          btn.disabled = false;
          btn.textContent = oldText;
        }
      });
    });
  }

  function setEmptyState(show, message) {
    if (!emptyState) return;
    emptyState.classList.toggle("hidden", !show);
    if (show) {
      emptyState.innerHTML = `
        <h3 style="margin:0 0 6px;">No products available.</h3>
        <p class="muted" style="margin:0 0 12px;">${escapeHtml(message || "Please check back soon for new arrivals.")}</p>
        <div class="empty-actions">
          <a class="btn" href="#contact">Contact us</a>
          <a class="btn btn-ghost" href="#about">Learn more</a>
        </div>
      `;
    }
  }

  function filterProducts(products, q) {
    const query = (q || "").toLowerCase().trim();
    return products.filter((p) => {
      if (p.status !== "active") return false;
      const hay = [p.title, p.description].filter(Boolean).join(" ").toLowerCase();
      return !query || hay.includes(query);
    });
  }

  async function init() {
    try {
      const allProducts = window.ProductsLoader && typeof window.ProductsLoader.loadAllProducts === "function"
        ? await window.ProductsLoader.loadAllProducts()
        : [];
      const products = allProducts.filter((p) => p.id && p.title);
      if (window.Cart) window.Cart.setInventoryMap(products);

      let quickMode = "all";

      const activeProducts = products.filter((p) => p.status === "active");
      const categories = Array.from(new Set(activeProducts.map((p) => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      if (categorySelect) {
        categorySelect.innerHTML = ['<option value="">All categories</option>', ...categories.map((c) => `<option value="${escapeHtmlAttr(c)}">${escapeHtml(c)}</option>`)].join("");
      }

      function setQuickFilter(nextMode) {
        quickMode = nextMode || "all";
        quickFilters.forEach((chip) => chip.classList.toggle("is-active", chip.getAttribute("data-filter") === quickMode));
      }

      function render() {
        const q = searchInput ? searchInput.value : "";
        const category = categorySelect ? categorySelect.value : "";
        const mode = sortSelect ? sortSelect.value : "featured";
        const active = sortProducts(filterByQuick(filterByCategory(filterProducts(products, q), category), quickMode), mode);

        if (statCount) statCount.textContent = String(active.length);
        grid.innerHTML = active.map((p) => renderCard(p)).join("");
        wireCheckoutButtons();
        setEmptyState(active.length === 0);
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
      setEmptyState(true, "We could not load products right now.");
    }
  }

  init();
})();
