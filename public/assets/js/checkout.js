(function () {
  let inFlight = false;

  async function startCheckout(items) {
    if (inFlight) return false;

    const normalizedItems = Array.isArray(items)
      ? items
          .map((item) => ({
            productId: String(item && item.productId ? item.productId : "").trim(),
            qty: Math.max(1, parseInt(item && item.qty ? item.qty : 1, 10) || 1),
          }))
          .filter((item) => item.productId)
      : [];

    if (!normalizedItems.length) {
      const msg = "Checkout failed: missing product details.";
      window.__LAST_CHECKOUT_ERROR__ = msg;
      alert(msg);
      return false;
    }

    inFlight = true;
    document.body.setAttribute("data-checkout-loading", "true");

    try {
      const res = await fetch("/.netlify/functions/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: normalizedItems }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.url) {
        throw new Error((data && data.error) || "Checkout service is temporarily unavailable.");
      }

      window.location = data.url;
      return true;
    } catch (err) {
      const msg = "Checkout failed: " + ((err && err.message) || "Please try again.");
      window.__LAST_CHECKOUT_ERROR__ = msg;
      window.dispatchEvent(new CustomEvent("checkout:error", { detail: { message: msg } }));
      alert(msg);
      return false;
    } finally {
      inFlight = false;
      document.body.removeAttribute("data-checkout-loading");
    }
  }

  window.startCheckout = startCheckout;
})();
