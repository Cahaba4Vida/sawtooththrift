(function () {
  const STORAGE_KEY = "cart_v1";
  let inventoryById = {};

  function safeParse(raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function normalizeCart(input) {
    if (!Array.isArray(input)) return [];
    const merged = new Map();

    input.forEach((row) => {
      const productId = String(row && row.productId ? row.productId : "").trim();
      const qty = Math.max(1, parseInt(row && row.qty ? row.qty : 1, 10) || 1);
      if (!productId) return;
      merged.set(productId, (merged.get(productId) || 0) + qty);
    });

    return Array.from(merged.entries()).map(([productId, qty]) => ({ productId, qty }));
  }

  function readCart() {
    if (!window.localStorage) return [];
    return normalizeCart(safeParse(window.localStorage.getItem(STORAGE_KEY)));
  }

  function writeCart(cart) {
    if (!window.localStorage) return;
    const normalized = normalizeCart(cart);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("cart:updated", { detail: normalized }));
    renderCartBadges(normalized);
  }

  function clampQty(productId, qty) {
    const safeQty = Math.max(1, parseInt(qty, 10) || 1);
    const inv = inventoryById[productId];
    if (Number.isFinite(inv) && inv >= 0) return Math.max(1, Math.min(safeQty, inv));
    return safeQty;
  }

  function getCart() {
    return readCart();
  }

  function setCart(cart) {
    writeCart(cart);
  }

  function addToCart(productId, qty) {
    const id = String(productId || "").trim();
    if (!id) return;
    const cart = readCart();
    const idx = cart.findIndex((x) => x.productId === id);
    const addQty = Math.max(1, parseInt(qty || 1, 10) || 1);
    if (idx === -1) cart.push({ productId: id, qty: clampQty(id, addQty) });
    else cart[idx].qty = clampQty(id, cart[idx].qty + addQty);
    writeCart(cart);
  }

  function updateQty(productId, qty) {
    const id = String(productId || "").trim();
    if (!id) return;
    const cart = readCart();
    const idx = cart.findIndex((x) => x.productId === id);
    if (idx === -1) return;
    cart[idx].qty = clampQty(id, qty);
    writeCart(cart);
  }

  function removeFromCart(productId) {
    const id = String(productId || "").trim();
    writeCart(readCart().filter((x) => x.productId !== id));
  }

  function clearCart() {
    writeCart([]);
  }

  function cartCount() {
    return readCart().reduce((sum, item) => sum + (parseInt(item.qty, 10) || 0), 0);
  }

  function setInventoryMap(products) {
    const map = {};
    (Array.isArray(products) ? products : []).forEach((p) => {
      const id = String(p && p.id ? p.id : "").trim();
      if (!id) return;
      const invRaw = p && p.inventory != null && p.inventory !== "" ? Number(p.inventory) : (p && p.quantity != null && p.quantity !== "" ? Number(p.quantity) : null);
      if (Number.isFinite(invRaw)) map[id] = invRaw;
    });
    inventoryById = map;
  }


  function ensureFloatingCart() {
    if (document.getElementById("stFloatingCart")) return;
    const a = document.createElement("a");
    a.id = "stFloatingCart";
    a.href = "/cart.html";
    a.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:99998;padding:10px 12px;border-radius:999px;border:1px solid rgba(214,185,138,.45);background:rgba(18,18,18,.92);color:#fff;text-decoration:none;font:700 13px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);";
    a.innerHTML = 'Cart (<span data-cart-count>0</span>)';
    document.body.appendChild(a);
  }
  function renderCartBadges(cart) {
    const current = Array.isArray(cart) ? cart : readCart();
    const count = current.reduce((sum, item) => sum + (parseInt(item.qty, 10) || 0), 0);
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = String(count);
    });
  }

  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) renderCartBadges(readCart());
  });
  window.addEventListener("DOMContentLoaded", () => { ensureFloatingCart(); renderCartBadges(readCart()); });

  window.Cart = {
    getCart,
    setCart,
    addToCart,
    updateQty,
    removeFromCart,
    clearCart,
    cartCount,
    setInventoryMap,
    storageKey: STORAGE_KEY,
  };
})();
