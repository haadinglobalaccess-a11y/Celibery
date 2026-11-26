# SEO, AEO and GEO

How the store is made readable for search engines (SEO), answer engines (AEO: featured snippets,
voice, FAQ answers) and generative AI search (GEO: ChatGPT, Perplexity, Gemini, Claude).

## 1. Crawlers get server-rendered pages

The storefront is a React single-page app. Crawlers often do not run JavaScript (AI crawlers and
link-preview bots never do), so they would see an empty page.

- `server/src/modules/seo/bots.ts` recognises search, AI and link-preview crawlers by user agent.
- `server/src/modules/seo/prerender.ts` renders the page for them from the same data the store
  shows: title, meta description, canonical, `hreflang` (ar-SA, en-SA, x-default), Open Graph,
  one H1, the page content, breadcrumbs, header/footer links and schema.org JSON-LD.
- On Vercel only crawlers are routed to it (`vercel.json`: rewrites with a `has` user-agent rule;
  keep its list in sync with `bots.ts`). People get the normal storefront from the CDN.
- Unknown products, categories and pages answer **404** with `noindex` (no soft-404s).
- Private pages (cart, checkout, account, tracking, search) are `noindex`.
- If the database is unavailable the plain storefront is served; the renderer never blocks a visit.
- Responses are cached at the CDN for 10 minutes (`s-maxage=600`), so admin edits reach crawlers
  within 10 minutes.

Structured data per page:

| Page | JSON-LD |
|---|---|
| Home | Organization, WebSite with SearchAction (sitelinks search box), FAQPage (top FAQs) |
| Shop, category, collection, bundles | CollectionPage + ItemList, BreadcrumbList |
| Product | Product (brand, SKU, model/MPN, images, specs, Offer with SAR price and stock, rating only from real approved reviews), BreadcrumbList |
| FAQ | FAQPage |
| About / Contact | AboutPage / ContactPage |

Sample (demo) products never get Product/Offer data.

In the app, `client/src/lib/useSeo.ts` keeps the same head tags up to date while people navigate.

## 2. Sitemap, robots and AI files

- `/sitemap.xml`: every public page in Arabic and English with `hreflang` alternates and
  `x-default`, product images (image sitemap), collections, campaigns and policy pages.
- `/robots.txt`: public pages allowed, private paths blocked; AI crawlers follow
  Admin → Settings → SEO → "Allow AI crawlers".
- `/llms.txt`: short store summary for AI assistants.
- `/llms-full.txt`: the full catalogue (names in English and Arabic, link, price incl. VAT,
  availability, SKU/model, specifications) so AI assistants answer with correct, current facts.

## 3. What the store team should do (content wins rankings)

1. **Google Search Console** (verification tag is already in `client/index.html`): submit
   `https://<domain>/sitemap.xml`, then check *Pages* and *Enhancements* (Products, Breadcrumbs, FAQ).
2. **Bing Webmaster Tools**: import from Search Console (also feeds ChatGPT search and Copilot).
3. **Google Business Profile** for CELIBERY International (name, address, phone, hours, photos).
4. Every product: a clear name with model and key spec ("Power Bank 20,000mAh 22.5W CEL20"),
   a 1–2 sentence short description, a full description, specifications and real photos.
5. Category descriptions (Admin → Categories): 2–3 sentences in Arabic and English.
6. Homepage SEO title and description: Admin → Settings → SEO.
7. Publish FAQs (Admin → Website → FAQ): real customer questions answer AEO/GEO queries directly.
8. Collect genuine reviews (Admin → Reviews): ratings show in Google results once approved.
9. Earn links: brand mentions on Saudi tech blogs, marketplaces and social profiles; add the
   social profile URLs in Admin → Settings → Business so they appear as `sameAs`.

Nobody can guarantee a #1 position: rankings depend on competition, content quality, reviews and
links over time. This setup removes the technical barriers so the content can rank.
