# 13 — SEO, Accessibility and Customer Trust

## 1. SEO (LIVE + code)
| Item | Status | Evidence |
|---|---|---|
| `robots.txt` | PASS | Allows the site; disallows `/admin`, `/api/`, checkout and account; explicit AI-crawler groups |
| Sitemap | PASS | `/sitemap.xml` 200, ~83 KB, generated from live data |
| Canonical host | **FAIL** | Every URL is on `celiberyclient-production.up.railway.app`. Moving to a custom domain later means a full re-index. Set the domain **before** promoting the site |
| Server-rendered pages for crawlers | PASS | `modules/seo/prerender.ts`: titles, descriptions, Open Graph, JSON-LD (escaped); correct 404 for bots |
| Titles / meta in the SPA | PASS | `lib/useSeo.ts` |
| `llms.txt` / `llms-full.txt` | PASS | Served |
| Soft 404 for people | LOW (L-01) | |
| Broken-link crawl | NOT RUN | |

## 2. Accessibility
Playwright `accessibility.spec.ts` uses `@axe-core/playwright`. See the E2E results in [11](11_QA_AND_TEST_RESULTS.md). No manual screen-reader or keyboard walkthrough was done: **manual accessibility NOT VERIFIED**. The RTL Arabic layout is covered by the `encoding` and `responsive` specs.

## 3. Customer trust and legal information (LIVE, H-05)
| Item | Live value |
|---|---|
| Commercial registration (CR) | empty |
| VAT number | empty |
| Store email | empty |
| Store phone | empty |
| WhatsApp | set |
| SBC (Saudi Business Center) verification | `false` |
| Privacy policy | **Draft** ("awaiting counsel review and approval") |
| Terms and conditions | **Draft** |
| Shipping policy | **Draft** |
| Returns / refund policy | **Draft** |
| Warranty | **Draft** |
| Social links | Instagram, Snapchat set |

The policy texts were **not** evaluated for legal adequacy. This audit does not invent or judge legal requirements. The client's counsel must approve them and confirm the disclosure obligations under Saudi e-commerce regulations. The privacy policy should also mention the visitor-IP country lookup (L-07) and the processors in use (email, WhatsApp, payment gateway, hosting).

**Status: SEO PASS with a domain caveat · Accessibility PARTIAL · Trust/legal FAIL (H-05).**
