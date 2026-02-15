// Hidden admin access (stealth):
// Type the secret phrase anywhere on the site to jump to /admin/
//
// Note: client-side "secrets" are discoverable by anyone who inspects the JS.
// This is convenience-only; rely on Netlify Identity to actually protect /admin/.
(() => {
  const SECRET = "ironmansucks";
  const SECRET_RE = new RegExp(SECRET, "i");

  function resolveAdminUrl() {
    try {
      // Derive the site base from the loaded script URL so it works on subpaths and pretty URLs.
      const scripts = Array.from(document.getElementsByTagName("script"));
      const self = scripts.find((s) => (s.src || "").includes("assets/js/secret-admin.js"));
      if (self && self.src) {
        const src = self.src;
        const i = src.indexOf("/assets/js/secret-admin.js");
        if (i !== -1) return src.slice(0, i) + "/admin/index.html";
      }
    } catch (_) {}
    return "/admin/index.html";
  }

  const ADMIN_URL = resolveAdminUrl();

  // Debug + verification hook
  const __params = new URLSearchParams(window.location.search || "");
  const DEBUG = __params.has("debugSecret");
  window.__secretAdminLoaded = true;
  if (DEBUG) console.log("[secret-admin] loaded; typing secret will redirect to", ADMIN_URL);


  // --- Key buffer (best-effort) ---
  let buffer = "";
  let lastTime = 0;
  const MAX_BUF = 64;

  function resetIfStale(now) {
    if (now - lastTime > 12000) buffer = "";
    lastTime = now;
  }

  function pushChar(ch) {
    buffer += ch;
    if (buffer.length > MAX_BUF) buffer = buffer.slice(-MAX_BUF);
    if (buffer.toLowerCase().includes(SECRET)) {
      if (DEBUG) console.log('[secret-admin] secret detected; redirecting to', ADMIN_URL);
      window.location.assign(ADMIN_URL);
    }
  }

  // 1) Earliest possible key hook (capture on window)
  window.addEventListener(
    "keydown",
    (e) => {
      const now = Date.now();
      resetIfStale(now);

      const key = String(e.key || "");
      if (key.length !== 1) return; // ignore modifiers
      if (DEBUG) console.log('[secret-admin] key:', key);
      pushChar(key.toLowerCase());
    },
    true
  );

  // 2) Fallback: if user types into ANY input/textarea, detect the phrase in the field value.
  // This bypasses situations where other scripts block key propagation.
  document.addEventListener(
    "input",
    (e) => {
      const t = e && e.target;
      if (!t) return;

      const tag = String(t.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea") return;

      const val = String(t.value || "");
      if (!val) return;

      if (SECRET_RE.test(val)) {
        // Optional cleanup so the secret doesn't remain visible
        try { t.value = ""; } catch (_) {}
        if (DEBUG) console.log('[secret-admin] secret detected; redirecting to', ADMIN_URL);
      window.location.assign(ADMIN_URL);
      }
    },
    true
  );

  // 3) Fallback: paste anywhere
  window.addEventListener(
    "paste",
    (e) => {
      const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
      if (!text) return;
      const s = String(text).toLowerCase();
      for (const ch of s) pushChar(ch);
    },
    true
  );

  // 4) Optional: URL hash trigger (type #ironmansucks and press Enter in the address bar)
  try {
    if (String(window.location.hash || "").toLowerCase().includes(SECRET)) {
      if (DEBUG) console.log('[secret-admin] secret detected; redirecting to', ADMIN_URL);
      window.location.assign(ADMIN_URL);
    }
  } catch (_) {}
})();
