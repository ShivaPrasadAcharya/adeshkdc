import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import parser from "./order-text-parser.cjs";

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

// Read only the JSON payload; uploaded scripts are never executed by the workflow.
export function readOrderScript(source, filename) {
  const match = /\b(?:const|let|var)\s+categoryOrders\s*=\s*\[/.exec(source);
  if (!match) throw new Error(`${filename}: categoryOrders JSON array भेटिएन। Input/Output बाट बनाएको order_data_*.js राख्नुहोस्।`);
  const start = match.index + match[0].length - 1;
  let depth = 0, inString = false, escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]" && --depth === 0) {
      const orders = JSON.parse(source.slice(start, index + 1));
      if (!Array.isArray(orders)) throw new Error(`${filename}: आदेशको सूची array हुनुपर्छ।`);
      return orders;
    }
  }
  throw new Error(`${filename}: categoryOrders JSON array पूरा छैन।`);
}

function uploadFiles(directory, prefix = "orders") {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory() && !entry.name.startsWith(".")) return uploadFiles(path.join(directory, entry.name), relative);
    if (!entry.isFile()) return [];
    return /\.txt$/i.test(entry.name) || /^order_data_.*\.js$/i.test(entry.name) ? [relative] : [];
  });
}

export function buildOrderIndex(root, now = new Date().toISOString()) {
  const scripts = fs.readdirSync(root).filter(file => /^order_data_.*\.js$/i.test(file) && fs.statSync(path.join(root, file)).isFile());
  const sources = [...scripts, ...uploadFiles(path.join(root, "orders"))].sort();
  const records = new Map(), ids = new Set(), sourceFiles = [];
  for (const filename of sources) {
    const raw = fs.readFileSync(path.join(root, filename), "utf8").replace(/^\uFEFF/, "");
    const isText = /\.txt$/i.test(filename);
    let entries;
    try {
      entries = isText ? parser.parseCourtOrders(raw, path.basename(filename)) : readOrderScript(raw, filename);
    } catch (error) {
      throw new Error(`${filename}: ${error.message}`);
    }
    sourceFiles.push({ path: filename, sha256: sha256(raw), orderCount: entries.length });
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== "object" || typeof entry.content !== "string" || !entry.content.trim() || typeof entry.category !== "string" || !entry.category.trim() || typeof entry.file !== "string" || !entry.file.trim()) {
        throw new Error(`${filename}: आदेश ${index + 1} मा category, file वा content छैन।`);
      }
      const order = { ...entry, sourceFile: filename };
      if (isText && entries.length === 1) {
        order.file = path.basename(filename);
        order.path = filename;
      }
      const key = `${order.category}\0${order.file}`;
      const previous = records.get(key);
      if (previous) ids.delete(previous.id);
      const preferredId = String(order.id || "uploaded-" + sha256(key).slice(0, 16));
      order.id = ids.has(preferredId) ? preferredId + "-" + sha256(key).slice(0, 12) : preferredId;
      ids.add(order.id);
      records.set(key, order);
    }
  }
  const orders = [...records.values()];
  const index = {
    schemaVersion: 7,
    title: "काठमाडौं जिल्ला अदालत — आदेश प्रकारअनुसार अभिलेख",
    court: "काठमाडौं जिल्ला अदालत",
    sourceFiles,
    categoryCount: new Set(orders.map(order => order.category)).size,
    orders
  };
  const destination = path.join(root, "order-index.json");
  let previous;
  try { previous = JSON.parse(fs.readFileSync(destination, "utf8")); } catch { /* first build */ }
  const { generatedAt, ...previousContent } = previous || {};
  index.generatedAt = JSON.stringify(previousContent) === JSON.stringify(index) ? generatedAt : now;
  fs.writeFileSync(destination, JSON.stringify(index, null, 2) + "\n");
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = buildOrderIndex(process.cwd());
    console.log(`${index.sourceFiles.length} files → ${index.orders.length} orders, ${index.categoryCount} categories`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
