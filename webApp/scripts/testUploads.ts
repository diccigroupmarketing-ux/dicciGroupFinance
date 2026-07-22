// Test uploadedFiles + deleteUpload atas dev PG (port 5433). MEMADAM data,
// restore selepas via loadDevDb.py + backfillAutoSkus.py.
//   DATABASE_URL=postgresql://dev:dev@localhost:5433/dicci npx tsx scripts/testUploads.ts
import { deleteUpload } from "../lib/mutations";
import { uploadedFiles, stockistDetail, billLineConflicts } from "../lib/recon";
import { getPool } from "../lib/db";

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost). Skrip ni memadam data.");
  process.exit(1);
}

let fail = 0;
function ok(cond: boolean, label: string) {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) fail++;
}

async function main() {
  const pool = getPool();

  // 1) Senarai fail
  const files = await uploadedFiles();
  console.log("uploadedFiles:", files.map((f) => `${f.kind}:${f.file} (${f.rows})`));
  const ordersFile = files.find((f) => f.kind === "orders");
  const codFile = files.find((f) => f.kind === "cod");
  ok(!!ordersFile, "ada fail orders");
  ok(!!codFile, "ada fail cod");
  if (!ordersFile || !codFile) process.exit(1);

  // 2) Popup stokis: unmappedSkus keluar bila mapping hilang
  const sb = await pool.query("SELECT sku, product_name, paid, free FROM sku_bottles LIMIT 1");
  const victim = sb.rows[0];
  await pool.query("DELETE FROM sku_bottles WHERE sku = $1", [victim.sku]);
  const who = await pool.query(
    `SELECT COALESCE(o.seller_name, '(no stockist)') AS s FROM orders o
     JOIN order_skus os ON os.order_id = o.order_id
     WHERE os.sku = UPPER(TRIM($1)) LIMIT 1`, [victim.sku]);
  if (who.rows.length) {
    const d = await stockistDetail(who.rows[0].s, "0001-01-01", "9999-12-31");
    ok(d.unmappedSkus.includes(victim.sku.toUpperCase().trim()),
      `stockistDetail laporkan '${victim.sku}' unmapped untuk ${who.rows[0].s}`);
  } else {
    console.log("  SKIP: tiada order guna SKU mangsa");
  }
  await pool.query(
    `INSERT INTO sku_bottles (sku, product_name, paid, free) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sku) DO NOTHING`,
    [victim.sku, victim.product_name, victim.paid, victim.free]);

  // 3) Padam fail cod: baris bil hilang, orders tak disentuh
  const before = {
    lines: Number((await pool.query("SELECT COUNT(*) n FROM cod_bill_lines")).rows[0].n),
    orders: Number((await pool.query("SELECT COUNT(*) n FROM orders")).rows[0].n),
  };
  const r1 = await deleteUpload(codFile.file);
  ok(r1.billLines === codFile.rows, `padam cod: ${r1.billLines} baris = ${codFile.rows} dijangka`);
  ok(r1.orders === 0, "padam cod: orders tak disentuh");
  const afterLines = Number((await pool.query("SELECT COUNT(*) n FROM cod_bill_lines")).rows[0].n);
  ok(afterLines === before.lines - codFile.rows, "kiraan cod_bill_lines betul");
  const list2 = await uploadedFiles();
  ok(!list2.some((f) => f.file === codFile.file && f.kind === "cod"), "fail cod hilang dari senarai");

  // 4a) B1 legacy guard atas DATA SEBENAR: snapshot dev tiada baris order_uploads,
  //     jadi order sedia ada = "legacy". Padam fail orders TIDAK buang order,
  //     semua dikekalkan (elak buang duit sah yang tiada jejak untuk disahkan).
  const r2legacy = await deleteUpload(ordersFile.file);
  ok(r2legacy.orders === 0, "legacy: padam fail orders tak buang order (tiada jejak)");
  ok(r2legacy.ordersKeptLegacy === ordersFile.rows,
    `legacy: ${r2legacy.ordersKeptLegacy} order dikekalkan = ${ordersFile.rows} dijangka`);
  const stillThere = Number((await pool.query(
    "SELECT COUNT(*) n FROM orders WHERE source_file = $1", [ordersFile.file])).rows[0].n);
  ok(stillThere === ordersFile.rows, "legacy: order masih ada dalam DB");

  // 4b) Isi jejak (simulasi ingest ber-jejak): order jadi EXCLUSIVE ke failnya,
  //     lepas tu padam betul betul membuang order + order_skus (perangai lama,
  //     kini SELAMAT sebab jejak sahkan ia eksklusif fail ni).
  await pool.query(
    `INSERT INTO order_uploads (order_id, source_file, ingested_at)
       SELECT order_id, source_file, ingested_at FROM orders WHERE source_file = $1
     ON CONFLICT DO NOTHING`, [ordersFile.file]);
  const r2 = await deleteUpload(ordersFile.file);
  ok(r2.orders === ordersFile.rows, `padam orders (ber-jejak): ${r2.orders} = ${ordersFile.rows} dijangka`);
  ok(r2.orderSkus > 0, `order_skus ikut terpadam (${r2.orderSkus})`);
  const leftSkus = Number((await pool.query("SELECT COUNT(*) n FROM order_skus")).rows[0].n);
  const leftOrders = Number((await pool.query("SELECT COUNT(*) n FROM orders")).rows[0].n);
  ok(leftOrders === before.orders - ordersFile.rows, "kiraan orders betul");
  ok(leftSkus === 0 || leftOrders > 0, "tiada order_skus yatim");

  // 5) Fail tak wujud: 0 baris, tak throw
  const r3 = await deleteUpload("failTakWujud.xlsx");
  ok(r3.total === 0, "fail tak wujud = 0 baris");

  // =====================================================================
  // 6-8) FIX B1: vouch many-to-many (order_uploads). Data SINTETIK berasingan
  // (prefix B1*) supaya tak bergantung/mengganggu data snapshot. Situasi: dua
  // fail Fighter bertindih , B1SHARED wujud dalam KEDUA fail (source_file tuding
  // fail TERAKHIR, fileB), B1ONLYA/B1ONLYB eksklusif satu fail, B1LEGACY tiada
  // jejak (kes lama).
  // =====================================================================
  const B1_IDS = ["B1SHARED", "B1ONLYA", "B1ONLYB", "B1LEGACY", "B1LEGACY2"];
  const cleanB1 = async () => {
    await pool.query("DELETE FROM order_skus WHERE order_id = ANY($1::text[])", [B1_IDS]);
    await pool.query("DELETE FROM order_uploads WHERE order_id = ANY($1::text[])", [B1_IDS]);
    await pool.query("DELETE FROM orders WHERE order_id = ANY($1::text[])", [B1_IDS]);
  };
  const existsOrder = async (oid: string) =>
    (await pool.query("SELECT 1 FROM orders WHERE order_id = $1", [oid])).rowCount! > 0;
  const sfOf = async (oid: string): Promise<string | null> =>
    (await pool.query("SELECT source_file FROM orders WHERE order_id = $1", [oid]))
      .rows[0]?.source_file ?? null;
  const skuCount = async (oid: string) => Number((await pool.query(
    "SELECT COUNT(*) n FROM order_skus WHERE order_id = $1", [oid])).rows[0].n);

  const seedB1 = async () => {
    await cleanB1();
    const ins = (oid: string, sf: string) => pool.query(
      `INSERT INTO orders (order_id, source_file, status, payment_method,
                           shipping_provider, selling_price)
       VALUES ($1, $2, 'Completed', 'COD', 'J&T Express', 100)`, [oid, sf]);
    await ins("B1SHARED", "b1FileB.xlsx");   // source_file = fail terakhir (B)
    await ins("B1ONLYA", "b1FileA.xlsx");
    await ins("B1ONLYB", "b1FileB.xlsx");
    await ins("B1LEGACY", "b1FileB.xlsx");   // SENGAJA tiada order_uploads
    const ou = (oid: string, sf: string, t: string) => pool.query(
      `INSERT INTO order_uploads (order_id, source_file, ingested_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [oid, sf, t]);
    await ou("B1SHARED", "b1FileA.xlsx", "2026-06-01 00:00:00");
    await ou("B1SHARED", "b1FileB.xlsx", "2026-06-02 00:00:00");
    await ou("B1ONLYA", "b1FileA.xlsx", "2026-06-01 00:00:00");
    await ou("B1ONLYB", "b1FileB.xlsx", "2026-06-02 00:00:00");
    await pool.query(
      `INSERT INTO order_skus (order_id, sku, sku_raw, qty) VALUES
         ('B1SHARED', 'JAG-MY-1', 'JAG-MY-1', 1),
         ('B1ONLYB', 'JAG-MY-1', 'JAG-MY-1', 1)
       ON CONFLICT DO NOTHING`);
  };

  // 6) Padam fail KEDUA (fileB): order kongsi KEKAL (+ re-point), eksklusif-B padam.
  await seedB1();
  const d1 = await deleteUpload("b1FileB.xlsx");
  ok(await existsOrder("B1SHARED"), "(i) order kongsi KEKAL selepas padam fileB");
  ok((await sfOf("B1SHARED")) === "b1FileA.xlsx", "(i) source_file kongsi di-re-point ke fileA");
  ok(!(await existsOrder("B1ONLYB")), "(i) order eksklusif fileB terpadam");
  ok(await existsOrder("B1ONLYA"), "(i) order fileA tak disentuh");
  ok(await existsOrder("B1LEGACY"), "(i) order legacy KEKAL (tiada jejak)");
  ok(d1.orders === 1, `(i) orders deleted = 1 (dapat ${d1.orders})`);
  ok(d1.ordersKeptShared === 1, `(i) ordersKeptShared = 1 (dapat ${d1.ordersKeptShared})`);
  ok(d1.ordersKeptLegacy === 1, `(i) ordersKeptLegacy = 1 (dapat ${d1.ordersKeptLegacy})`);
  ok((await skuCount("B1SHARED")) === 1, "(i) order_skus kongsi kekal");
  ok((await skuCount("B1ONLYB")) === 0, "(i) order_skus eksklusif terpadam");

  // 7) Padam fail PERTAMA (fileA) dari keadaan segar: eksklusif-A padam, kongsi kekal.
  await seedB1();
  const d2 = await deleteUpload("b1FileA.xlsx");
  ok(!(await existsOrder("B1ONLYA")), "(ii) order eksklusif fileA terpadam");
  ok(await existsOrder("B1SHARED"), "(ii) order kongsi KEKAL bila padam fileA (masih ada fileB)");
  ok((await sfOf("B1SHARED")) === "b1FileB.xlsx", "(ii) order kongsi kekal tuding fileB");
  ok(await existsOrder("B1ONLYB"), "(ii) order fileB tak disentuh");
  ok(d2.orders === 1, `(ii) orders deleted = 1 (dapat ${d2.orders})`);

  // 8) Legacy tulen: order tanpa langsung jejak order_uploads TIDAK dipadam senyap.
  await cleanB1();
  await pool.query(
    `INSERT INTO orders (order_id, source_file, status, payment_method,
                         shipping_provider, selling_price)
     VALUES ('B1LEGACY2', 'b1FileC.xlsx', 'Completed', 'COD', 'J&T Express', 100)`);
  const d3 = await deleteUpload("b1FileC.xlsx");
  ok(await existsOrder("B1LEGACY2"), "(iii) order legacy TIDAK dipadam senyap");
  ok(d3.orders === 0, `(iii) orders deleted = 0 (dapat ${d3.orders})`);
  ok(d3.ordersKeptLegacy === 1, `(iii) ordersKeptLegacy = 1 (dapat ${d3.ordersKeptLegacy})`);
  await cleanB1();

  // =====================================================================
  // 9) D3: billLineConflicts() baca bill_line_conflicts + join ke order ikut
  //    tracking = awb. Data SINTETIK (prefix D3*), dibersih selepas. Enjin Python
  //    yang MENGISI jadual ni (diuji dalam testIngestParsers); sini uji lapisan
  //    baca webApp: baris keluar, join order betul, order tiada tetap dipapar.
  // =====================================================================
  const D3_AWBS = ["9990000001", "9990000002"];
  const cleanD3 = async () => {
    await pool.query("DELETE FROM bill_line_conflicts WHERE awb = ANY($1::text[])", [D3_AWBS]);
    await pool.query("DELETE FROM orders WHERE order_id = 'D3ORDER'");
  };
  await cleanD3();
  // Satu konflik ADA order padanan (tracking = awb), satu TIADA order.
  await pool.query(
    `INSERT INTO orders (order_id, tracking, seller_name, status, payment_method,
                         shipping_provider, selling_price)
     VALUES ('D3ORDER', '9990000001', 'Rekaan Stockist', 'Completed', 'COD',
             'J&T Express', 100)`);
  await pool.query(
    `INSERT INTO bill_line_conflicts (awb, bill_id_new, bill_id_existing, cod_new,
                                      cod_existing, fee_new, delivered_date,
                                      source_file, detected_at)
     VALUES ('9990000001', 'D3BILLB', 'D3BILLA', 200, 100, 7, '2026-06-18',
             'd3FileB.csv', '2026-07-23T00:00:00Z'),
            ('9990000002', 'D3BILLB', 'D3BILLA', 55, 50, 2, '2026-06-18',
             'd3FileB.csv', '2026-07-23T00:00:01Z')`);
  const conf = await billLineConflicts();
  const withOrder = conf.find((c) => c.awb === "9990000001");
  const noOrder = conf.find((c) => c.awb === "9990000002");
  ok(!!withOrder && withOrder.order_id === "D3ORDER",
    "(D3) konflik dengan order padanan bawa order_id");
  ok(!!withOrder && withOrder.seller_name === "Rekaan Stockist",
    "(D3) konflik bawa nama stokis dari order");
  ok(!!withOrder && withOrder.cod_existing === 100 && withOrder.cod_new === 200,
    "(D3) dua dua amaun bil dibawa untuk banding");
  ok(!!withOrder && withOrder.bill_id_existing === "D3BILLA" && withOrder.bill_id_new === "D3BILLB",
    "(D3) dua dua bill_id dibawa");
  ok(!!noOrder && noOrder.order_id === null,
    "(D3) konflik tanpa order tetap dipapar (order_id null)");
  await cleanD3();

  // =====================================================================
  // 10) deleteUpload buang baris parkir bill_line_conflicts fail penyebab supaya
  //     tak jadi yatim dalam seksyen "Needs attention". Kes songsang: konflik dari
  //     fail LAIN (source_file != fail dipadam) KEKAL (rekod fail lain, isyarat sah).
  //     Data SINTETIK (prefix DEL*), dibersih selepas.
  // =====================================================================
  const DEL_AWBS = ["9991000001", "9991000002"];
  const cleanDel = async () => {
    await pool.query("DELETE FROM bill_line_conflicts WHERE awb = ANY($1::text[])", [DEL_AWBS]);
  };
  await cleanDel();
  // Dua konflik: satu dari delConflictFile.csv (fail penyebab yang akan dipadam),
  // satu dari fail LAIN (delOtherFile.csv) yang kena kekal.
  await pool.query(
    `INSERT INTO bill_line_conflicts (awb, bill_id_new, bill_id_existing, cod_new,
                                      cod_existing, fee_new, delivered_date,
                                      source_file, detected_at)
     VALUES ('9991000001', 'DELBILLB', 'DELBILLA', 200, 100, 7, '2026-06-18',
             'delConflictFile.csv', '2026-07-23T01:00:00Z'),
            ('9991000002', 'DELBILLD', 'DELBILLC', 55, 50, 2, '2026-06-18',
             'delOtherFile.csv', '2026-07-23T01:00:01Z')`);
  const confBefore = await billLineConflicts();
  ok(confBefore.some((c) => c.awb === "9991000001"),
    "(DEL) konflik fail penyebab wujud sebelum padam");
  const dDel = await deleteUpload("delConflictFile.csv");
  ok(dDel.conflicts === 1, `(DEL) deleteUpload lapor 1 konflik dibuang (dapat ${dDel.conflicts})`);
  const confAfter = await billLineConflicts();
  ok(!confAfter.some((c) => c.awb === "9991000001"),
    "(DEL) konflik fail penyebab HILANG dari Needs attention selepas padam");
  ok(confAfter.some((c) => c.awb === "9991000002"),
    "(DEL) konflik dari fail LAIN KEKAL (source_file != fail dipadam)");
  await cleanDel();

  console.log(fail ? `\n${fail} GAGAL` : "\nSEMUA PASS");
  console.log("NOTA: dev DB dah diubah. Restore: python3 scripts/loadDevDb.py + backfillAutoSkus.py");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
