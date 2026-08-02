# DLsite Ajax parser change

## Purpose

- Keep existing `products.salesCount` semantics edition-scoped by using Ajax `dl_count`.
- Save the all-language/all-edition total separately as `products.totalSalesCount` from `dl_count_total`.
- Save current-edition and language/edition breakdown data for future information-site features.
- Save rating counts, text review count, rating breakdown, and DLsite official rankings.
- Keep existing ranking, seller, genre, site-stat, list-view, and estimated-revenue calculations on `salesCount` to avoid duplicate counting and price mismatch.
- Keep the existing `reviewCount` meaning for backward compatibility.
- Do not mix DLsite official rankings into existing `latestRankings`.

## Product fields

- `salesCount`: current product ID / current edition count (`dl_count`). Existing calculations continue to use this field.
- `totalSalesCount`: all editions/languages total (`dl_count_total`). Product detail display uses this field with `salesCount` fallback.
- `currentEditionSalesCount`: explicit copy of the current edition count.
- `salesEditionGroupId`: shared edition group identifier when available.
- `salesEditions`: language/edition count breakdown from `dl_count_items`.
- `ratingCount`: rating count (`rate_count`).
- `textReviewCount`: text-review count (`review_count`).
- `ratingBreakdown`: star-count breakdown (`rate_count_detail`).
- `sourceRankings`: DLsite official rankings from the product Ajax payload.

Existing fields remain compatible:

- `reviewCount`: rating count, retained for existing UI and compact/list documents.
- `latestRankings`: existing Doujin Info ranking summaries, unchanged.

## Daily metric additions

- `totalSalesCount`
- `currentEditionSalesCount`
- `salesEditionCounts` (stored only for multi-edition products)
- `ratingCount`
- `textReviewCount`

`sourceRankings` are intentionally not copied into daily metrics in this change.

## Dynamic-source rule

Price, sales, rating, rating breakdown, and DLsite official ranking values are read from the product-scoped Ajax payload. They do not fall back to broad HTML number matching. When Ajax is unavailable, those fields are omitted from the merge write so existing stored values are retained.

Static fields such as title, seller, genres, images, description, and release date continue to use HTML parsing. Release date may use the Ajax date when available and HTML as fallback.

## Duplicate edition groups

The same edition group can appear as multiple product documents. This is expected. Duplicate-group logs are informational because existing seller/genre/ranking/revenue calculations remain edition-scoped through `salesCount`.

The new `totalSalesCount` must not be substituted into existing aggregate calculations without a separate group-level aggregation design.

## Validation

```powershell
cd C:\dev\doujin-info-mvp-node24\functions
npm run build
npm run test:dlsite-ajax-parser
```

Then inspect the known product without Firestore writes:

```powershell
npm run inspect:dlsite-product-sources -- `
  --execute `
  --product-id=RJ01504617 `
  --floor=auto
```

Expected relationships:

- `salesCount` equals Ajax `dl_count`.
- `totalSalesCount` equals Ajax `dl_count_total`.
- `currentEditionSalesCount` equals `salesCount`.
- `salesEditions` sum equals `totalSalesCount` when the breakdown is complete.
- `ratingCount` equals the sum of `ratingBreakdown` when breakdown data is valid.
- `textReviewCount` comes from `review_count`.
- `sourceRankings` remains separate from `latestRankings`.

## Deployment order

1. Run Functions build and parser tests locally.
2. Clear the validation Emulator data and run one TL and one BL validation without overlapping executions.
3. Verify representative Firestore Emulator documents and existing pages.
4. Run Web typecheck and production build on the Windows development machine.
5. Pause the production Scheduler.
6. Build and deploy a new Cloud Run image.
7. Deploy Firestore index overrides.
8. Manually deploy App Hosting.
9. Delete pre-production Firestore documents.
10. Resume the Scheduler for the first clean collection.
