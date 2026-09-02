# Compact search index rollout

## Scope

The compact index replaces the in-memory representation used by direct product
search and the legacy new/sale fallback paths. It preserves the legacy search
fields exactly, stores tuple rows in bounded gzip blocks, and fetches complete
product documents only for the selected page IDs.

Seller-name search reuses the generated `sellerListViews` data instead of
loading `sellerIndexes` entries containing every seller's product-ID array.

## Firestore structure

```text
compactSearchIndexes/{segmentId}
  activeVersion
  previousVersion
  productCount
  blockCount
  blocks[]

compactSearchIndexes/{segmentId}/compactSearchIndexVersions/{versionId}
  status: building | ready
  blocks[]

compactSearchIndexes/{segmentId}/compactSearchIndexVersions/{versionId}/compactSearchIndexBlocks/{blockId}
  encoding: gzip-json-v1
  payload: Bytes
  checksum
```

Payload documents are protected by compressed and uncompressed size limits,
per-block checksums, a whole-index checksum, item-count checks, and active to
previous version fallback. Their fields are exempted from Firestore indexes.

## Flags

- `SEARCH_INDEX_WRITE_MODE=legacy` (default): build only the existing index.
- `SEARCH_INDEX_WRITE_MODE=dual`: build legacy then compact sequentially for a
  short comparison period.
- `SEARCH_INDEX_WRITE_MODE=compact`: build only compact. The sale list-view
  source-version guard follows the compact root in this mode.
- `SEARCH_INDEX_READ_MODE=legacy` (default): use the existing index.
- `SEARCH_INDEX_READ_MODE=compact`: use compact and automatically fall back to
  legacy when compact metadata, blocks, sizes, or checksums are invalid.

The code defaults are deliberately legacy. The checked-in App Hosting config
also remains legacy until a separate production rollout is authorized.

## Verified local baseline (13,544 active products)

- Exact reconstructed candidate equality: all products and all search fields.
- Existing imported legacy index equality: exact.
- Legacy first-load search reads: 30 documents.
- Compact first-load search reads: 7 documents.
- Warm process-cache search reads: 0 documents until the 60-second refresh.
- Legacy seller-name search first load: 66 documents.
- Seller-list name search first load: 3 documents; warm cache: 0.
- Compact payload: 1,503,250 bytes across 5 blocks.
- HTTP parity: product ID, title, seller, genre, TL/BL, pagination, new, sale,
  seller-name search, seller sort, and seller scope all matched visible output
  and item ordering.
- Missing compact active version: legacy fallback returned identical pages.

## Safe rollout order (not executed by local validation)

1. Deploy code and index exemptions while both flags remain `legacy`.
2. Set the index-rebuild job to `dual` and run it once.
3. Run the emulator/test-environment parity scripts and inspect checksums,
   product counts, block sizes, memory, errors, and read counts.
4. Set App Hosting `SEARCH_INDEX_READ_MODE=compact`.
5. Observe at least one normal batch cycle.
6. Set the batch to `compact` only after the rollback window.

Rollback is immediate on the read side: set `SEARCH_INDEX_READ_MODE=legacy`.
If compact-only writes have already begun, first switch the batch to `dual`,
run one successful rebuild, and then switch reads to legacy so the legacy data
is current. No product or history documents are changed by this rollout.
