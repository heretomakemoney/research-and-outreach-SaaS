import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function withExtension(absolutePath) {
  for (const candidate of [absolutePath + ".ts", absolutePath + ".tsx", path.join(absolutePath, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let target = null;
  if (specifier.startsWith("@/")) {
    target = path.join(srcDir, specifier.slice(2));
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (target && !path.extname(target)) {
    const found = withExtension(target);
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }
  if (target && path.extname(target) === ".ts") return nextResolve(pathToFileURL(target).href, context);
  return nextResolve(specifier, context);
}
