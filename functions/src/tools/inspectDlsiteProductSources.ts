import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  inspectDlsiteProductDataSources,
  type DlsiteProductDebugFloor,
} from "../adapters/dlsite/dlsiteFemaleDoujinAdapter";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseFloor(value: string | undefined): DlsiteProductDebugFloor {
  const normalized = value?.trim().toLowerCase() ?? "auto";
  if (
    normalized === "auto" ||
    normalized === "girls" ||
    normalized === "tl" ||
    normalized === "bl"
  ) {
    return normalized;
  }
  throw new Error(`invalid --floor value: ${value}`);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main(): Promise<void> {
  if (!hasFlag("execute")) {
    throw new Error(
      "DLsiteへの実アクセスを伴うため --execute が必要です。" +
        " 例: npm run inspect:dlsite-product-sources -- --execute --product-id=RJ01504617 --floor=auto --include-array-ajax",
    );
  }

  const productId = readArg("product-id")?.trim().toUpperCase();
  if (!productId) {
    throw new Error("--product-id=RJ... を指定してください");
  }

  const floor = parseFloor(readArg("floor"));
  const includeArrayAjaxEndpoint = hasFlag("include-array-ajax");
  const outputDir = path.resolve(
    readArg("output-dir") ??
      path.join(process.cwd(), "inspection-output", productId),
  );

  console.log("DLsite data-source inspection request plan", {
    productId,
    floor,
    includeArrayAjaxEndpoint,
    expectedRequestCount: includeArrayAjaxEndpoint ? 3 : 2,
    outputDir,
    firestoreWrites: 0,
  });

  const result = await inspectDlsiteProductDataSources({
    sourceProductId: productId,
    floor,
    includeArrayAjaxEndpoint,
  });

  await mkdir(outputDir, { recursive: true });

  await writeFile(
    path.join(outputDir, "raw-product.html"),
    result.rawHtml,
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "raw-product-ajax.json"),
    json(
      result.ajaxEndpoints.map((endpoint) => ({
        url: endpoint.url,
        status: endpoint.status,
        ok: endpoint.ok,
        contentType: endpoint.contentType,
        parsedJson: endpoint.parsedJson,
        rawText:
          endpoint.parsedJson === undefined ? endpoint.rawText : undefined,
        error: endpoint.error,
      })),
    ),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "parsed-html.json"),
    json(result.html),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "parsed-ajax.json"),
    json(result.ajax),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "comparison.json"),
    json(result.comparison),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "manifest.json"),
    json({
      sourceProductId: result.sourceProductId,
      requestedFloor: result.requestedFloor,
      selectedFloor: result.selectedFloor,
      sourceUrl: result.sourceUrl,
      fetchedAt: result.fetchedAt,
      requestCount: result.requestCount,
      firestoreWrites: 0,
      files: [
        "raw-product.html",
        "raw-product-ajax.json",
        "parsed-html.json",
        "parsed-ajax.json",
        "comparison.json",
      ],
    }),
    "utf8",
  );

  console.log("DLsite data-source inspection completed", {
    outputDir,
    requestCount: result.requestCount,
    htmlSalesCount: result.html.salesCount,
    comparison: result.comparison,
  });
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
  process.exitCode = 1;
});
