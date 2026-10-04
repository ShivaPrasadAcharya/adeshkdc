import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOrderIndex, readOrderScript } from "./build-order-index.mjs";

const content = "श्री\nकाठमाडौं जिल्ला अदालत\nमाननीय न्यायाधीश श्री परीक्षण\nआदेश\nनिवेदन नः ०८३-FN-१२३\nमुद्दा नं. ०८३-CP-४५६\nविषयः प्रमाण बुझ्ने\nपक्ष क........निवेदक\nविरुद्ध\nपक्ष ख........विपक्षी\nमुद्दाः लेनदेन\nयसमा प्रमाण पेश गर्नू।\nन्यायाधीश\nइति संवत् २०८३ साल असोज महिना १६ गते रोज ६ शुभम्।";
const record = (overrides = {}) => ({ id: "first", category: "प्रमाणबुझ्ने_pramanbujhne", categoryNepali: "प्रमाणबुझ्ने", file: "first.txt", content, ...overrides });
const script = records => `throw new Error("Uploaded code must not run"); const categoryOrders = ${JSON.stringify(records)};`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kdc-order-index-"));
  fs.mkdirSync(path.join(root, "orders"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "order_data_base.js"), script([record()]));
  return root;
}

test("reads JSON without executing uploaded scripts and preserves special characters", () => {
  const records = [record({ content: 'brackets [ ] and "quoted text" नेपाली <नाम>' })];
  assert.deepEqual(readOrderScript(script(records), "file.js"), records);
});

test("discovers new scripts, handles duplicate IDs, and keeps unchanged indexes stable", t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "orders", "nested"));
  fs.writeFileSync(path.join(root, "orders", "nested", "order_data_new.js"), script([record({ file: "second.txt" })]));
  const first = buildOrderIndex(root, "2026-10-04T00:00:00Z");
  assert.equal(first.orders.length, 2);
  assert.equal(new Set(first.orders.map(order => order.id)).size, 2);
  const bytes = fs.readFileSync(path.join(root, "order-index.json"), "utf8");
  buildOrderIndex(root, "2026-10-05T00:00:00Z");
  assert.equal(fs.readFileSync(path.join(root, "order-index.json"), "utf8"), bytes);
});

test("new TXT uploads parse dates, numbers and multiple orders; updates and deletions are reflected", t => {
  const root = fixture(t);
  const file = path.join(root, "orders", "new.txt");
  fs.writeFileSync(file, content);
  let index = buildOrderIndex(root);
  assert.equal(index.orders.length, 2);
  const added = index.orders.find(order => order.sourceFile === "orders/new.txt");
  assert.equal(added.petitionNumber, "०८३-FN-१२३");
  assert.equal(added.caseNumber, "०८३-CP-४५६");
  assert.equal(added.orderDate, "२०८३।०६।१६");
  assert.equal(added.path, "orders/new.txt");
  fs.writeFileSync(file, content + "\n\n" + content.replace("पक्ष क", "पक्ष ग"));
  index = buildOrderIndex(root);
  assert.equal(index.orders.length, 3);
  assert.equal(index.orders.filter(order => order.sourceFile === "orders/new.txt").length, 2);
  fs.unlinkSync(file);
  assert.equal(buildOrderIndex(root).orders.length, 1);
});

test("invalid uploads fail with their filename and do not overwrite the published index", t => {
  const root = fixture(t);
  buildOrderIndex(root);
  const previous = fs.readFileSync(path.join(root, "order-index.json"), "utf8");
  fs.writeFileSync(path.join(root, "orders", "order_data_bad.js"), "const categoryOrders = [ invalid ];");
  assert.throws(() => buildOrderIndex(root), /orders\/order_data_bad\.js/);
  assert.equal(fs.readFileSync(path.join(root, "order-index.json"), "utf8"), previous);
});
