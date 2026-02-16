(function () {
  function normalizePhotos(p) {
    if (Array.isArray(p && p.photos)) return p.photos.filter((x) => typeof x === 'string');
    return [];
  }

  function normalizeProduct(p) {
    return {
      id: String((p && p.id) || '').trim(),
      title: String((p && (p.title || p.name)) || '').trim(),
      category: String((p && p.category) || '').trim().toLowerCase(),
      clothing_subcategory: String((p && p.clothing_subcategory) || '').trim().toLowerCase(),
      status: String((p && p.status) || 'draft').toLowerCase(),
      price: Number(p && (p.price != null ? p.price : Number(p.price_cents || 0) / 100)),
      photos: normalizePhotos(p),
      description: String((p && p.description) || ''),
      inventory: p && p.inventory != null ? Number(p.inventory) : null,
      tags: Array.isArray(p && p.tags) ? p.tags : [],
    };
  }

  async function loadAllProducts() {
    const res = await fetch('/.netlify/functions/active-products', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load active products');
    const data = await res.json();
    const list = Array.isArray(data && data.products) ? data.products : [];
    return list.map(normalizeProduct).filter((p) => p.id);
  }

  window.ProductsLoader = { loadAllProducts, normalizeProduct };
})();
