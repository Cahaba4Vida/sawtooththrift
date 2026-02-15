(function () {
  const wrap = document.getElementById("productWrap");
  if (!wrap) return;

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

  function qp(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
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

  function stockInfo(p) {
    if (Number.isFinite(p.inventory)) {
      if (p.inventory <= 0) return { soldOut: true, text: "Sold out", maxQty: 1 };
      if (p.inventory <= 3) return { soldOut: false, text: `Only ${p.inventory} left`, maxQty: p.inventory };
      return { soldOut: false, text: "In Stock", maxQty: p.inventory };
    }
    return { soldOut: false, text: "In Stock", maxQty: 10 };
  }

  async function init() {
    const id = qp("id");
    if (!id) {
      wrap.innerHTML = `<div class="card pad">Missing product id.</div>`;
      return;
    }

    try {
      const products = window.ProductsLoader && typeof window.ProductsLoader.loadAllProducts === "function"
        ? await window.ProductsLoader.loadAllProducts()
        : [];
      if (window.Cart) window.Cart.setInventoryMap(products);
      const p = products.find((x) => x && String(x.id) === id);

      if (!p || p.status !== "active") {
        wrap.innerHTML = `<div class="card pad">Product not found.</div>`;
        return;
      }

      const images = p.photos;
      const stock = stockInfo(p);

      document.title = p.title ? `${p.title} | Sawtooth Thrift` : "Product";

      wrap.innerHTML = `
        <div class="product-detail">
          <div class="product-detail-media card">
            ${images.length ? `<img id="productMainImage" src="${escapeHtmlAttr(images[0])}" alt="${escapeHtmlAttr(p.title || "Product")}" />` : `<div class="img-placeholder tall">No Image</div>`}
            ${images.length > 1
              ? `<div class="thumbs">
                  ${images
                    .map((src, idx) => `
                      <button class="thumb" data-src="${escapeHtmlAttr(src)}" aria-label="View image ${idx + 1}">
                        <img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(p.title || "Product")} thumbnail" loading="lazy" />
                      </button>
                    `)
                    .join("")}
                </div>`
              : ""}
          </div>

          <div class="product-detail-body">
            <div class="product-detail-top">
              <h1>${escapeHtml(p.title || "Untitled")}</h1>
              <div class="price product-price-lg">${formatPrice(p.price)}</div>
            </div>

            <div class="product-meta" style="margin-top:8px;">
              <span class="pill ${stock.soldOut ? "pill-soft" : ""}">${escapeHtml(stock.text)}</span>
            </div>

            <div class="detail-notes" style="margin-top:10px;">
              <div class="note">
                <div class="note-title">Quantity</div>
                <div><input id="qtyInput" class="input" type="number" min="1" max="${stock.maxQty}" step="1" value="1" style="max-width:110px;" ${stock.soldOut ? "disabled" : ""} /></div>
              </div>
            </div>

            <div class="detail-actions">
              <button class="btn" type="button" id="addToCartBtn" ${stock.soldOut ? "disabled" : ""}>Add to Cart</button>
              <button class="btn btn-ghost" type="button" id="buyNowBtn" ${stock.soldOut ? "disabled" : ""}>Buy Now</button>
            </div>

            ${p.description ? `<p class="muted" style="margin-top:12px;">${escapeHtml(p.description)}</p>` : ""}
          </div>
        </div>
      `;

      const mainImg = wrap.querySelector("#productMainImage");
      wrap.querySelectorAll(".thumb").forEach((btn) => {
        btn.addEventListener("click", () => {
          const src = btn.getAttribute("data-src");
          if (mainImg && src) mainImg.src = src;
        });
      });

      const buyBtn = document.getElementById("buyNowBtn");
      const addBtn = document.getElementById("addToCartBtn");
      const qtyInput = document.getElementById("qtyInput");

      if (addBtn) {
        addBtn.addEventListener("click", () => {
          if (!window.Cart || stock.soldOut) return;
          const rawQty = qtyInput ? Number(qtyInput.value) : 1;
          const qty = Math.min(stock.maxQty, Math.max(1, Number.isFinite(rawQty) ? Math.floor(rawQty) : 1));
          window.Cart.addToCart(p.id, qty);
          showToast("Added to cart");
        });
      }

      if (buyBtn) {
        buyBtn.addEventListener("click", async () => {
          if (stock.soldOut || typeof window.startCheckout !== "function") return;
          const rawQty = qtyInput ? Number(qtyInput.value) : 1;
          const qty = Math.min(stock.maxQty, Math.max(1, Number.isFinite(rawQty) ? Math.floor(rawQty) : 1));

          buyBtn.disabled = true;
          buyBtn.textContent = "Starting checkout…";

          const ok = await window.startCheckout([{ productId: p.id, qty }]);
          if (!ok) {
            buyBtn.disabled = false;
            buyBtn.textContent = "Buy Now";
          }
        });
      }
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<div class="card pad">Error loading product.</div>`;
    }
  }

  init();
})();
