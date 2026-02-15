(function () {
  const listEl = document.getElementById("cartList");
  const subtotalEl = document.getElementById("cartSubtotal");
  const totalEl = document.getElementById("cartTotal");
  const checkoutBtn = document.getElementById("cartCheckoutBtn");
  const emptyEl = document.getElementById("cartEmpty");

  if (!listEl) return;

  function money(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "$0.00";
    return `$${v.toFixed(2)}`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function render(products) {
    const checkoutNoteEl = document.getElementById("cartCheckoutNote");
    if (!window.Cart) return;
    const cart = window.Cart.getCart();
    const productMap = new Map(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const checkoutItems = [];
    let hasBlockedItems = false;

    if (!cart.length) {
      listEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      checkoutBtn.disabled = true;
      subtotalEl.textContent = "$0.00";
      totalEl.textContent = "$0.00";
      return;
    }

    emptyEl.classList.add("hidden");

    listEl.innerHTML = cart
      .map((row) => {
        const p = productMap.get(row.productId);
        if (!p || p.status !== "active") {
          hasBlockedItems = true;
          return `
            <div class="card pad" data-id="${escapeHtml(row.productId)}">
              <b>Item no longer available</b>
              <div class="muted small">${escapeHtml(row.productId)}</div>
              <div style="margin-top:8px;"><button class="btn btn-ghost" data-remove="${escapeHtml(row.productId)}" type="button">Remove</button></div>
            </div>
          `;
        }

        const inv = Number.isFinite(p.inventory) ? p.inventory : null;
        const max = inv !== null ? Math.max(0, inv) : 10;
        const qty = Math.max(1, Math.min(parseInt(row.qty, 10) || 1, max || 1));
        const soldOut = inv !== null && inv <= 0;
        if (soldOut) hasBlockedItems = true;
        const lineTotal = (Number(p.price) || 0) * qty;
        const thumb = p.photos[0] || "";

        if (row.qty !== qty && !soldOut) window.Cart.updateQty(p.id, qty);
        if (!soldOut) {
          subtotal += lineTotal;
          checkoutItems.push({ productId: p.id, qty });
        }

        return `
          <div class="card pad" data-id="${escapeHtml(p.id)}" style="display:grid;grid-template-columns:90px 1fr;gap:12px;align-items:start;">
            <div>${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(p.title)}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;" />` : `<div class="img-placeholder" style="height:90px;">No Image</div>`}</div>
            <div>
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:start;">
                <div>
                  <b>${escapeHtml(p.title)}</b>
                  <div class="muted small">${money(p.price)} each</div>
                </div>
                <button class="btn btn-ghost" data-remove="${escapeHtml(p.id)}" type="button">Remove</button>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
                <button class="btn btn-ghost" data-dec="${escapeHtml(p.id)}" type="button" ${soldOut ? "disabled" : ""}>-</button>
                <span>Qty ${qty}</span>
                <button class="btn btn-ghost" data-inc="${escapeHtml(p.id)}" type="button" ${soldOut || qty >= max ? "disabled" : ""}>+</button>
                <span class="muted small">Line: ${money(lineTotal)}</span>
              </div>
              ${soldOut ? `<div class="muted small" style="margin-top:8px;color:#fca5a5;">Sold out — remove item to checkout.</div>` : ""}
              ${inv !== null && row.qty > inv && inv > 0 ? `<div class="muted small" style="margin-top:8px;color:#f59e0b;">Quantity adjusted to available inventory (${inv}).</div>` : ""}
              ${inv !== null && qty >= inv && inv > 0 ? `<div class="muted small" style="margin-top:8px;">Max available quantity reached.</div>` : ""}
            </div>
          </div>
        `;
      })
      .join("");

    checkoutBtn.disabled = checkoutItems.length === 0 || hasBlockedItems || typeof window.startCheckout !== "function";
    if (checkoutNoteEl) checkoutNoteEl.textContent = hasBlockedItems ? "Checkout blocked: remove sold out/unavailable items first." : "";
    subtotalEl.textContent = money(subtotal);
    totalEl.textContent = money(subtotal);

    listEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.Cart.removeFromCart(btn.getAttribute("data-remove"));
        render(products);
      });
    });

    listEl.querySelectorAll("[data-inc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-inc");
        const row = window.Cart.getCart().find((x) => x.productId === id);
        if (!row) return;
        window.Cart.updateQty(id, (row.qty || 1) + 1);
        render(products);
      });
    });

    listEl.querySelectorAll("[data-dec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-dec");
        const row = window.Cart.getCart().find((x) => x.productId === id);
        if (!row) return;
        if ((row.qty || 1) <= 1) return;
        window.Cart.updateQty(id, (row.qty || 1) - 1);
        render(products);
      });
    });

    checkoutBtn.onclick = async function () {
      const old = checkoutBtn.textContent;
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = "Starting checkout…";
      const ok = await window.startCheckout(checkoutItems);
      if (!ok) {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = old;
      }
    };
  }

  async function init() {
    try {
      const products = window.ProductsLoader && typeof window.ProductsLoader.loadAllProducts === "function"
        ? (await window.ProductsLoader.loadAllProducts()).filter((p) => p.id)
        : [];
      if (window.Cart) window.Cart.setInventoryMap(products);
      render(products);
      window.addEventListener("cart:updated", () => render(products));
    } catch (err) {
      listEl.innerHTML = `<div class="card pad">Could not load cart right now.</div>`;
      checkoutBtn.disabled = true;
    }
  }

  init();
})();
