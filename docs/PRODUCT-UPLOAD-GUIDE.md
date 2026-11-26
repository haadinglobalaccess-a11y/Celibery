# Adding products: the fast way

Two teams can work at the same time without overwriting each other. The **SKU** links everything.

## 1. Details team: CSV

1. Start from `docs/product-import-template.csv` (or Admin → Products → **Export CSV**). Keep it in a shared Google Sheet.
2. Fill one row per product. A new product needs at least: `sku`, `category_slug`, `name_ar`, `name_en`, `price_sar`.
   - `slug` can stay empty: it is made from the English name.
   - Leave `image_urls` empty: photos come from the graphics team (step 2).
3. Download as **CSV (UTF-8)** (Google Sheets: File → Download → CSV).
4. Admin → Products → **Import CSV** → **Validate** → fix any row listed → **Import**.

**Updating existing products:** only filled-in cells change anything. An empty cell, or a column that is
not in the file, keeps the current value. A file with just `sku,price_sar` changes only prices; a file
with just `sku,stock` changes only stock. To remove a value (e.g. end a sale price), edit the product in Admin.

Valid `category_slug`: headphones, power-banks, car-essentials, cables, charging-adapters, tech-essentials.
Multiple values (connectors, tags) are separated with `|`.

## 2. Graphics team: Bulk photos

1. Name every photo after the SKU and its number: `CEL-PB-20000-1.jpg`, `CEL-PB-20000-2.jpg`, …
   Photo 1 is the main photo. `SKU_2`, `SKU 2` and `SKU (2)` also work.
2. Admin → Products → **Bulk photos** → drop all files at once (up to 500).
3. Check the list: files whose SKU does not exist are shown in red. Rename them and drop them again.
4. Choose **Replace their photos** (final photos) or **Add after them**, then **Upload and attach**.

Only the photos change: names, prices, stock and status stay as they are. A product whose photos did not
all upload is left unchanged; press the button again to retry. The product must exist first (step 1),
so the details team imports the CSV before the photos are attached.
