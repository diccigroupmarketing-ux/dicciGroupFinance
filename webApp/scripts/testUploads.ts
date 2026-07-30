// Test uploadedFiles + deleteUpload atas dev PG (port 5433). MEMADAM data,
// restore selepas via loadDevDb.py + backfillAutoSkus.py.
//   DATABASE_URL=postgresql://dev:dev@localhost:5433/dicci npx tsx scripts/testUploads.ts
import { deleteUpload } from "../lib/mutations";
import { uploadedFiles, stockistDetail, billLineConflicts } from "../lib/recon";
import { getPool } from "../lib/db";
import { ensureUploadVouchTables } from "../lib/uploadVouchSchema";

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

  // =====================================================================
  // 11) FIX F05: vouch many-to-many untuk WALLET (wallet_uploads) dan PREPAID
  //     (prepaid_uploads). Lubang yang SAMA macam B1: upsert mengalihkan
  //     source_file ke fail TERBARU, jadi padam fail A boleh buang baris duit
  //     yang fail B masih tuntut. Data SINTETIK (prefix F05*), dibersih selepas,
  //     jadi blok ni tak bergantung pada snapshot dev.
  // =====================================================================
  // Jadual vouch dicipta MALAS (ensure*), dan blok ni menyentuhnya SEBELUM
  // deleteUpload pertama, jadi jamin ia wujud dulu.
  await ensureUploadVouchTables();
  const W_IDS = ["F05WSHARED", "F05WONLYA", "F05WONLYB", "F05WLEGACY"];
  const P_REFS = ["F05PSHARED", "F05PONLYA", "F05PONLYB", "F05PLEGACY"];
  const cleanF05 = async () => {
    await pool.query("DELETE FROM wallet_uploads WHERE txn_id = ANY($1::text[])", [W_IDS]);
    await pool.query("DELETE FROM wallet_txns WHERE txn_id = ANY($1::text[])", [W_IDS]);
    await pool.query("DELETE FROM prepaid_uploads WHERE order_ref = ANY($1::text[])", [P_REFS]);
    await pool.query("DELETE FROM prepaid_payments WHERE order_ref = ANY($1::text[])", [P_REFS]);
  };
  const hasWallet = async (id: string) =>
    (await pool.query("SELECT 1 FROM wallet_txns WHERE txn_id = $1", [id])).rowCount! > 0;
  const wSf = async (id: string): Promise<string | null> =>
    (await pool.query("SELECT source_file FROM wallet_txns WHERE txn_id = $1", [id]))
      .rows[0]?.source_file ?? null;
  const hasPrepaid = async (ref: string) =>
    (await pool.query("SELECT 1 FROM prepaid_payments WHERE order_ref = $1", [ref])).rowCount! > 0;
  const pSf = async (ref: string): Promise<string | null> =>
    (await pool.query("SELECT source_file FROM prepaid_payments WHERE order_ref = $1", [ref]))
      .rows[0]?.source_file ?? null;

  // Semai keadaan yang ingest sebenar hasilkan: fileA + fileB bertindih pada
  // satu baris, source_file = penulis TERAKHIR (fileB), plus satu baris LEGACY
  // (tuding fileB tapi langsung tiada pasangan vouch, iaitu data pra-fix F05).
  const seedF05 = async () => {
    await cleanF05();
    const w = (id: string, sf: string) => pool.query(
      `INSERT INTO wallet_txns (txn_id, txn_date, order_id, seller_name, txn_type,
                                source, status, amount, source_file, ingested_at)
       VALUES ($1, '2026-06-18 10:00:00', 'F05ORDER', 'Rekaan Stockist', 'IN',
               'Sales', 'Approved', 10, $2, $3)`, [id, sf, "2026-06-02 00:00:00"]);
    await w("F05WSHARED", "f05WalletB.xlsx");
    await w("F05WONLYA", "f05WalletA.xlsx");
    await w("F05WONLYB", "f05WalletB.xlsx");
    await w("F05WLEGACY", "f05WalletB.xlsx");   // SENGAJA tiada wallet_uploads
    const wu = (id: string, sf: string, t: string) => pool.query(
      `INSERT INTO wallet_uploads (txn_id, source_file, ingested_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, sf, t]);
    await wu("F05WSHARED", "f05WalletA.xlsx", "2026-06-01 00:00:00");
    await wu("F05WSHARED", "f05WalletB.xlsx", "2026-06-02 00:00:00");
    await wu("F05WONLYA", "f05WalletA.xlsx", "2026-06-01 00:00:00");
    await wu("F05WONLYB", "f05WalletB.xlsx", "2026-06-02 00:00:00");

    const p = (ref: string, sf: string) => pool.query(
      `INSERT INTO prepaid_payments (gateway, order_ref, amount, fee, status,
                                     paid_on, source_file, ingested_at)
       VALUES ('chip', $1, 100, 2, 'paid', '2026-06-18 09:00:00', $2, $3)`,
      [ref, sf, "2026-06-02 00:00:00"]);
    await p("F05PSHARED", "f05ChipB.xlsx");
    await p("F05PONLYA", "f05ChipA.xlsx");
    await p("F05PONLYB", "f05ChipB.xlsx");
    await p("F05PLEGACY", "f05ChipB.xlsx");     // SENGAJA tiada prepaid_uploads
    const pu = (ref: string, sf: string, t: string) => pool.query(
      `INSERT INTO prepaid_uploads (gateway, order_ref, source_file, ingested_at)
       VALUES ('chip', $1, $2, $3) ON CONFLICT DO NOTHING`, [ref, sf, t]);
    await pu("F05PSHARED", "f05ChipA.xlsx", "2026-06-01 00:00:00");
    await pu("F05PSHARED", "f05ChipB.xlsx", "2026-06-02 00:00:00");
    await pu("F05PONLYA", "f05ChipA.xlsx", "2026-06-01 00:00:00");
    await pu("F05PONLYB", "f05ChipB.xlsx", "2026-06-02 00:00:00");
  };

  // (F05-i) Padam fail KEDUA (B): baris kongsi KEKAL + re-point ke A, baris
  // eksklusif-B padam, baris fail A tak disentuh, baris legacy KEKAL.
  await seedF05();
  const w1 = await deleteUpload("f05WalletB.xlsx");
  ok(await hasWallet("F05WSHARED"), "(F05-i) txn wallet kongsi KEKAL selepas padam fileB");
  ok((await wSf("F05WSHARED")) === "f05WalletA.xlsx",
    "(F05-i) source_file wallet kongsi di-re-point ke fileA");
  ok(!(await hasWallet("F05WONLYB")), "(F05-i) txn wallet eksklusif fileB terpadam");
  ok(await hasWallet("F05WONLYA"), "(F05-i) txn wallet fileA tak disentuh");
  ok(await hasWallet("F05WLEGACY"), "(F05-i) txn wallet legacy KEKAL (tiada jejak)");
  ok(w1.wallet === 1, `(F05-i) wallet deleted = 1 (dapat ${w1.wallet})`);
  ok(w1.walletKeptShared === 1, `(F05-i) walletKeptShared = 1 (dapat ${w1.walletKeptShared})`);
  ok(w1.walletKeptLegacy === 1, `(F05-i) walletKeptLegacy = 1 (dapat ${w1.walletKeptLegacy})`);

  const p1 = await deleteUpload("f05ChipB.xlsx");
  ok(await hasPrepaid("F05PSHARED"), "(F05-i) bayaran prepaid kongsi KEKAL selepas padam fileB");
  ok((await pSf("F05PSHARED")) === "f05ChipA.xlsx",
    "(F05-i) source_file prepaid kongsi di-re-point ke fileA");
  ok(!(await hasPrepaid("F05PONLYB")), "(F05-i) bayaran eksklusif fileB terpadam");
  ok(await hasPrepaid("F05PONLYA"), "(F05-i) bayaran fileA tak disentuh");
  ok(await hasPrepaid("F05PLEGACY"), "(F05-i) bayaran legacy KEKAL (tiada jejak)");
  ok(p1.prepaid === 1, `(F05-i) prepaid deleted = 1 (dapat ${p1.prepaid})`);
  ok(p1.prepaidKeptShared === 1, `(F05-i) prepaidKeptShared = 1 (dapat ${p1.prepaidKeptShared})`);
  ok(p1.prepaidKeptLegacy === 1, `(F05-i) prepaidKeptLegacy = 1 (dapat ${p1.prepaidKeptLegacy})`);

  // (F05-ii) Dari keadaan SEGAR, padam fail PERTAMA (A): eksklusif-A padam,
  // baris kongsi KEKAL (masih dituntut fileB) dan tetap tuding fileB.
  await seedF05();
  const w2 = await deleteUpload("f05WalletA.xlsx");
  ok(!(await hasWallet("F05WONLYA")), "(F05-ii) txn wallet eksklusif fileA terpadam");
  ok(await hasWallet("F05WSHARED"), "(F05-ii) txn wallet kongsi KEKAL bila padam fileA");
  ok((await wSf("F05WSHARED")) === "f05WalletB.xlsx", "(F05-ii) kongsi kekal tuding fileB");
  ok(w2.wallet === 1, `(F05-ii) wallet deleted = 1 (dapat ${w2.wallet})`);
  ok(w2.walletKeptLegacy === 0, `(F05-ii) tiada legacy tuding fileA (dapat ${w2.walletKeptLegacy})`);
  const p2 = await deleteUpload("f05ChipA.xlsx");
  ok(!(await hasPrepaid("F05PONLYA")), "(F05-ii) bayaran eksklusif fileA terpadam");
  ok(await hasPrepaid("F05PSHARED"), "(F05-ii) bayaran kongsi KEKAL bila padam fileA");
  ok((await pSf("F05PSHARED")) === "f05ChipB.xlsx", "(F05-ii) kongsi kekal tuding fileB");
  ok(p2.prepaid === 1, `(F05-ii) prepaid deleted = 1 (dapat ${p2.prepaid})`);

  // (F05-iii) Padam fail TERAKHIR selepas (ii): baris kongsi kini dituntut fileB
  // SAHAJA, jadi ia mesti BENAR benar hilang (bukan tinggal yatim).
  const w3 = await deleteUpload("f05WalletB.xlsx");
  ok(!(await hasWallet("F05WSHARED")), "(F05-iii) padam fail terakhir buang txn kongsi betul betul");
  ok(w3.wallet === 2, `(F05-iii) wallet deleted = 2 kongsi+eksklusifB (dapat ${w3.wallet})`);
  const p3 = await deleteUpload("f05ChipB.xlsx");
  ok(!(await hasPrepaid("F05PSHARED")), "(F05-iii) padam fail terakhir buang bayaran kongsi betul betul");
  ok(p3.prepaid === 2, `(F05-iii) prepaid deleted = 2 (dapat ${p3.prepaid})`);
  const leftVouch = Number((await pool.query(
    `SELECT (SELECT COUNT(*) FROM wallet_uploads WHERE txn_id = ANY($1::text[]))
          + (SELECT COUNT(*) FROM prepaid_uploads WHERE order_ref = ANY($2::text[])) AS n`,
    [W_IDS, P_REFS])).rows[0].n);
  ok(leftVouch === 0, `(F05-iii) tiada baris vouch yatim tertinggal (dapat ${leftVouch})`);

  // (F05-iv) Data LAMA tanpa vouch (fail yang cuma ada baris legacy): TIDAK
  // dipadam senyap, dikira dan dilapor supaya finance tahu perlu re-upload dulu.
  await cleanF05();
  await pool.query(
    `INSERT INTO wallet_txns (txn_id, txn_date, seller_name, txn_type, source,
                              status, amount, source_file, ingested_at)
     VALUES ('F05WLEGACY', '2026-06-18 10:00:00', 'Rekaan Stockist', 'IN', 'Sales',
             'Approved', 10, 'f05LegacyOnly.xlsx', '2026-06-02 00:00:00')`);
  await pool.query(
    `INSERT INTO prepaid_payments (gateway, order_ref, amount, fee, status, paid_on,
                                   source_file, ingested_at)
     VALUES ('chip', 'F05PLEGACY', 100, 2, 'paid', '2026-06-18 09:00:00',
             'f05LegacyOnly.xlsx', '2026-06-02 00:00:00')`);
  const d4 = await deleteUpload("f05LegacyOnly.xlsx");
  ok(await hasWallet("F05WLEGACY"), "(F05-iv) txn wallet legacy TIDAK dipadam senyap");
  ok(await hasPrepaid("F05PLEGACY"), "(F05-iv) bayaran prepaid legacy TIDAK dipadam senyap");
  ok(d4.wallet === 0 && d4.prepaid === 0,
    `(F05-iv) tiada baris dipadam (wallet=${d4.wallet} prepaid=${d4.prepaid})`);
  ok(d4.walletKeptLegacy === 1 && d4.prepaidKeptLegacy === 1,
    `(F05-iv) legacy dilapor (wallet=${d4.walletKeptLegacy} prepaid=${d4.prepaidKeptLegacy})`);
  await cleanF05();

  console.log(fail ? `\n${fail} GAGAL` : "\nSEMUA PASS");
  console.log("NOTA: dev DB dah diubah. Restore: python3 scripts/loadDevDb.py + backfillAutoSkus.py");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
