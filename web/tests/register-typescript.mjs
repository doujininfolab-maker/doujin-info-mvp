import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: new URL("./shims/server-only/index.js", import.meta.url).href, shortCircuit: true };
    let candidate;
    if (specifier.startsWith("@/")) candidate = pathToFileURL(resolve(webRoot, specifier.slice(2))).href;
    else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) candidate = new URL(specifier, context.parentURL).href;
    if (candidate) for (const suffix of ["", ".ts", ".tsx"]) {
      const url = candidate + suffix;
      if (/\.tsx?$/.test(url) && existsSync(fileURLToPath(url))) return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, fileName: fileURLToPath(url),
      }).outputText;
      return { source, format: "module", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
