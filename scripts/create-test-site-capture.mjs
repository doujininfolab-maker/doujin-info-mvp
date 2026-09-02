#!/usr/bin/env node

import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "web", "package.json"));
const sharp = require("sharp");

const captureDir = join(process.cwd(), "artifacts", "test-site-capture");
const output = join(captureDir, "test-site-validation.gif");
const framePaths = [
  join(captureDir, "02-detail-top.png"),
  join(captureDir, "03-chart-30d.png"),
  join(captureDir, "04-chart-half-year.png"),
  join(captureDir, "03-chart-30d.png"),
];

const metadata = await Promise.all(framePaths.map((path) => sharp(path).metadata()));
const width = metadata[0]?.width;
const pageHeight = metadata[0]?.height;
if (!width || !pageHeight) throw new Error("capture frame dimensions are unavailable");

const frames = await Promise.all(framePaths.map((path) =>
  sharp(path)
    .resize(width, pageHeight, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer(),
));

const stacked = Buffer.concat(frames);
await sharp(stacked, {
  raw: {
    width,
    height: pageHeight * frames.length,
    pageHeight,
    channels: 3,
  },
  animated: true,
})
  .gif({
    loop: 0,
    delay: [1800, 2200, 2200, 1200],
    colours: 256,
    effort: 7,
  })
  .toFile(output);

const result = await sharp(output, { animated: true }).metadata();
if (result.pages !== frames.length || result.pageHeight !== pageHeight) {
  throw new Error(`animated GIF validation failed: ${JSON.stringify(result)}`);
}

console.log(JSON.stringify({ output, width, pageHeight, frames: result.pages }, null, 2));
