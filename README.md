# Sawtooth Thrift Website (Starter)

This is a Netlify-ready static site + Decap CMS admin panel.

## What you get
- Public product gallery (reads from `public/data/products.json`)
- Optional product detail page (`public/product.html`)
- Admin panel at `/admin` (Decap CMS) for editing products + uploading images
- Contact form section (FormSubmit placeholder)

## Local preview
From the project root, run one of the following:
- Python: `python -m http.server 8080` then open `http://localhost:8080/public/`
- Node (if you have it): `npx serve public`

## Launch (high-level)
1) Push to GitHub.
2) Create Netlify site from Git repo (publish dir: `public`, no build command).
3) Enable Identity + Git Gateway in Netlify, invite admin user(s).
4) Visit `/admin/` to add products.

## Configure the contact form
Edit `public/index.html` and replace:
`https://formsubmit.co/YOUR_EMAIL@EXAMPLE.COM`
with your real email.


## Inventory / sold out
This site supports a `quantity` field per product:
- If `quantity` is 0 (or status is `sold`/`inactive`), the UI shows **Sold Out** and disables the Buy button.

Important: because this is a static site using Stripe Payment Links, inventory is not automatically decremented after purchase.
To enforce true inventory (prevent oversells), you would add a server-side checkout flow + Stripe webhook (e.g., Netlify Functions) to decrement quantity and block checkout when quantity hits 0.
