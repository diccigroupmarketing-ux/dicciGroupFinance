# Panduan Finance Dicci, Cara Guna App

Hai team finance. Ini panduan ringkas cara guna app rekonsiliasi kewangan Dicci. Tak perlu tahu apa apa pasal koding, cukup ikut langkah bawah ni. Baca sekali, simpan, rujuk bila perlu.

Apa app ni buat, dalam satu ayat: dia ambil semua fail duit masuk (bil kurier, statement gateway) dan padankan dengan order Fighter, supaya kita nampak berapa sebenarnya duit yang patut masuk bank, dan mana yang tak kena.

***

## 1. Login

App ni tertutup, bukan sesiapa boleh masuk. Kita guna sistem login yang hanya benarkan email yang dah didaftarkan (owner yang daftar email awak dulu).

Langkah:

1. Buka link app yang owner bagi kat awak (owner hantar secara peribadi, bukan dalam panduan ni).
2. Sistem akan minta email. Guna email yang awak dah bagi pada owner untuk didaftarkan.
3. Ikut cara sahkan yang sistem minta (kod ke email, atau butang masuk).
4. Kalau muncul mesej macam "tak dibenarkan" atau tak boleh masuk, maksudnya email awak belum masuk senarai. Bagitahu owner, dia tambah email awak, cuba semula.

Nota: satu email satu orang. Jangan kongsi login. Kalau ramai nak guna, minta owner daftar email masing masing.

***

## 2. Upload Fail

Ini kerja utama awak. App tak reti apa apa sampai kita bagi dia data. Data tu datang dari fail yang awak export dari sistem lain (Fighter, kurier, gateway), lepas tu upload masuk sini.

### Mana butang upload

Kat atas app ada butang **Upload data**. Klik, satu kotak akan muncul. Dalam kotak tu:

1. Klik **Choose files**, pilih satu atau banyak fail sekali gus.
2. Klik **Ingest**.
3. Tunggu setiap fail siap. Ada label warna sebelah nama fail: **hijau** (berjaya masuk), **kuning** (fail tak dikenali, atau ada benda dalam dia yang app belum tahu kira), **merah** (fail sepatutnya boleh diproses, tapi ada masalah dalam fail tu sendiri).

**Penting**: kuning dan merah dua duanya bermaksud **tiada apa apa ditulis masuk sistem**, jadi tiada data rosak, tiada duit tersalah kira. Beza dia cuma siapa yang kena bertindak: **merah** biasanya awak sendiri boleh betulkan (download semula fail, ambil export penuh), **kuning** selalunya kena naikkan pada finance lead atau owner. Setiap tolakan datang dengan **ayat sebab** dalam bahasa biasa, jangan skip, baca ayat tu dulu sebelum cuba upload semula benda yang sama.

### Jenis fail yang diterima

App terima format **.xlsx, .xls, .csv** sahaja. App **kenal sendiri** jenis fail dari isi kandungan dia, jadi awak tak perlu tag atau namakan apa apa. Cuma pastikan awak upload fail yang betul betul export penuh, bukan yang dah ditapis.

Ini senarai jenis yang app faham dan dari mana ambil:

| Jenis | Dari mana export | Fungsi dalam recon |
| --- | --- | --- |
| **Fighter orders** | Export senarai order dari Fighter | Tulang belakang. Semua duit masuk dipadankan balik pada order ni. |
| **Fighter Wallet** | Export Wallet dari Fighter | Rekod transaksi wallet (komisen, pergerakan duit dalam Fighter). |
| **J&T COD bill** | Bil COD dari J&T | Duit COD yang J&T kutip dan patut remit, tolak fee dia. |
| **DHL payment advice** | Payment advice atau advice bayaran dari DHL | Sama macam atas, tapi untuk parsel DHL. |
| **Ninja Van SOA** | Statement of Account (SOA) dari Ninja Van | Sama, untuk parsel Ninja Van. |
| **CHIP statement** | Statement dari gateway CHIP | Duit masuk melalui gateway CHIP (bukan COD). |

Kalau app kata "format not recognised", maksudnya fail tu bukan salah satu jenis atas, atau lajur dalam dia dah berubah. Jangan risau, tiada apa rosak, app tak tulis apa apa. Semak balik fail tu export penuh dan betul, cuba semula, atau tanya owner.

### Sebab tolakan, apa maksud setiap satu

App sekarang **semak fail lebih ketat dari dulu**. Sebabnya senang: lebih baik satu fail ditolak di pintu masuk daripada duit tersalah kira senyap senyap dalam laporan. Kalau upload jadi merah atau kuning, cari ayat sebab dia dalam jadual ni.

| Ayat yang awak nampak (permulaannya) | Warna | Maksud dalam bahasa biasa | Apa perlu buat |
| --- | --- | --- | --- |
| "The rows we could read don't add up to the total printed in this file..." | Merah | Fail tu ada **jumlah besar tercetak dalam dia sendiri** (GRAND TOTAL, Sum Total, baris TOTAL kaki SOA), dan bila app campur baris satu satu, hasilnya **tak sama** dengan jumlah tu. Maknanya sebahagian duit hilang masa fail dibuat atau didownload. | Download semula fail tu dari kurier, upload sekali lagi. Kalau masih tak tally, hantar pada finance lead. |
| "This file lists the same tracking number more than once with different amounts..." | Merah | Satu **nombor tracking sama muncul dua kali dalam fail yang sama, tapi amaunnya berbeza**. App tak boleh teka mana yang betul, dan kalau disimpan, satu baris akan tulis ganti duit baris satu lagi. | Semak fail tu dengan kurier, minta versi betul. Jangan edit sendiri. |
| "Some money cells in this file can't be read as numbers..." | Merah | Ada sel duit yang **kosong atau berisi teks**, jadi kalau disimpan ia akan dikira **RM 0**. Semakan ni sekarang jalan untuk **semua jenis fail** (dulu fail Fighter sahaja). | Buka fail, tengok sel duit yang kosong atau pelik, download semula export penuh, upload semula. |
| "This file is missing expected column(s)..." | Merah | Lajur wajib tiada. Biasanya sebab export ditapis, atau format export dari vendor dah berubah. | Ambil export **penuh** semula. Kalau format vendor memang dah berubah, bagitahu owner. |
| "This bill looks damaged..." | Merah | Fail dikenali sebagai bil, tapi kandungan dia rosak atau terpotong (selalunya download tak habis). | Download semula dari kurier, upload semula. |
| "This file contains a charge this page doesn't know how to record yet..." | Kuning | Untuk advice DHL: ada **"Total deduction" yang bukan sifar**, iaitu potongan yang app belum tahu cara rekod. Kalau disimpan, app akan **lapor duit lebih dari sebenar**. | **Jangan cuba betulkan sendiri**, ni bukan kerja kerani. Naikkan fail tu pada finance lead atau owner. |
| "This file was read fine, but none of its rows are payments this page can save..." | Kuning | Fail boleh dibaca, cuma **semua barisnya tertapis keluar** (contoh statement CHIP yang isinya disbursement sahaja, atau bayaran masih pending atau gagal). Bukan fail rosak, cuma tiada bayaran berjaya di dalamnya. | Semak tempoh statement tu betul ke tak, atau download semula bila bayaran dah settle. Kalau awak yakin sepatutnya ada bayaran, bagitahu finance lead. |
| "This is a delivery status report, not a payment bill." | Kuning | Fail tu laporan status penghantaran, bukan bil duit. | Abaikan, upload bil bayaran yang betul. |
| "This file isn't recognised as a bill from any courier..." | Kuning | Betul betul tak dikenali. | Semak awak upload fail yang betul. Kalau awak pasti ia bil, hantar pada owner. |

### Nota khas ikut jenis fail

**Statement CHIP mesti ada lajur "Status".** Kalau lajur tu tiada dalam fail, app akan tolak terus. Bukan app cerewet: lajur Status yang bagitahu bayaran tu **berjaya**, pending, atau gagal. Tanpa dia, app terpaksa anggap semua baris sebagai duit sah, dan order yang bayarannya belum jadi akan tersalah tanda "confirmed". Jadi bila export dari CHIP, pastikan lajur Status ada dalam export.

**Bil J&T sekarang dikira ikut HARI, bukan ikut fail.** J&T settle duit COD ikut hari penghantaran, jadi satu fail export yang merangkumi beberapa hari (contoh 20 hingga 30 Mei) akan **pecah jadi beberapa bil harian** dalam sistem, satu bil untuk satu hari. Awak akan nampak lebih banyak baris bil dari jumlah fail yang awak upload. **Itu memang jangkaan, bukan pepijat.** Dulu semua statement J&T runtuh jadi satu bil, sebab tu tarikh dan amaun nampak bercampur aduk.

Sebab tu juga: **upload fail J&T guna nama fail asal dari J&T, jangan rename.** Nama asal ada nombor akaun (contoh `JTMY031691`) yang app guna untuk kenal bil tu milik akaun mana. Kalau fail dinamakan semula jadi macam "jnt jul 2026.xlsx", app terpaksa guna nama fail tu sebagai identiti, dan id bil akan jadi pelik. Dua fail nama berlainan pun tak akan bergabung walaupun harinya sama, jadi baris bertindih akan masuk kuarantin (lihat seksyen "N quarantined" bawah). Sengaja begitu: lebih selamat nampak pelik di skrin daripada duit bergabung senyap. Kalau ada PDF statement, PDF lagi bagus, sebab nombor akaun tercetak dalam kandungan dia.

### Tip export

Selalunya export **penuh dan terkini**, bukan export yang awak dah tapis ikut tarikh atau status. Sebab kenapa, lihat seksyen 4.

### Bila upload kata "N quarantined", parcel disebut dua kali

Kadang lepas ingest, label hijau fail tu ada tambahan macam **"... · 3 quarantined (see Uploads)"**. Maksudnya app jumpa parcel (nombor tracking) yang muncul dalam **dua bil kurier berbeza**. Daripada main timpa, app parkir baris kedua tu supaya duit **tak dikira dua kali**, dan letak dia di halaman Uploads untuk awak semak.

Pergi halaman **Uploads**. Kalau ada kes, satu kad muncul kat atas berlabel **"Needs attention · parcels billed twice"**. Dia senaraikan setiap parcel yang bertindih dengan kolum: **Order**, **Stockist**, **Tracking**, **Existing bill** dan **Existing COD** (baris asal yang app dah simpan), pastu **New bill**, **New COD** dan **New fee** (baris baru yang diparkir), serta tarikh **Detected**.

Apa maksudnya: parcel sama disebut dalam dua bil boleh jadi **bayaran berganda** (double payout), atau satu **bil pembetulan** untuk bil lama. App **tak** ganti baris lama dengan yang baru secara senyap, jadi tiada duit tertimpa. **Apa awak perlu buat**: bandingkan dua amaun COD tu (Existing COD lawan New COD), tentukan mana bil yang betul, dan bagitahu owner untuk kes yang nampak macam bayaran berganda betul betul.

***

## 3. Baca Dashboard

Lepas upload, angka kat muka depan akan berubah sendiri. Ini maksud setiap benda dalam bahasa biasa.

### Nombor besar kat atas (Net remit)

**Net remit** = jumlah duit yang sepatutnya betul betul mendarat dalam bank kita, lepas ditolak fee kurier. Ini bukan jualan kasar, ini duit bersih yang kita expect nampak dalam akaun.

Sebelah nombor besar ada label:

* **Clean books** (hijau) = semua elok, semua duit padan dengan order. Buku bersih.
* **X exceptions to investigate** (kuning) = ada X benda yang tak kena, kena siasat. "Exception" tu maksudnya kes pelik, dua jenis utama:
  * **Duit hantu (ghost money)**: ada duit masuk dalam bil kurier, tapi tiada order yang sepadan. Macam ada duit datang entah dari mana.
  * **Tak padan (amount mismatch)**: ada order dan ada duit, tapi jumlah tak sama dengan yang sepatutnya.

### Kotak angka (KPI)

* **COD collected** = jumlah duit COD yang kurier dah kutip dari pelanggan, ikut semua bil yang dah settle.
* **Courier fees** = jumlah caj yang kurier potong (upah hantar). Peratus di bawah tu menunjukkan berapa besar fee berbanding COD.
* **Parcels settled** = bilangan parsel yang dah ada bil (dah selesai kira duit). Di bawah tu ada jumlah order dalam store sebagai perbandingan.
* **Bottles confirmed** = bilangan botol yang dikira **hanya selepas duit disahkan masuk**. Jadi kalau order belum ada duit sah, botol dia belum dikira lagi.

### Jadual Income streams

Setiap baris satu sumber duit (satu kurier atau gateway). Status setiap satu:

* **Clean** (hijau) = sumber tu semua padan, tiada masalah.
* **X exceptions** (merah) = ada kes tak kena, klik masuk untuk siasat.
* **Awaiting bill** (kuning) = sumber tu tersambung, tapi **belum ada bil untuk tempoh ni** (belum remit lagi, tengah tunggu bil dari kurier). Ini bukan error, cuma belum sampai masanya.

Klik mana mana baris untuk masuk halaman terperinci sumber tu.

### Kad Payment confirmation (5 baldi bayaran jujur)

Kat halaman Impact ada satu kad **Payment confirmation** yang ambil semua order Completed dan pecah jadi **5 baldi** ikut cara pelanggan bayar. Ini seksyen yang paling penting sebab dia hentikan satu salah faham besar: order yang dibayar guna **CHIP** selalu disangka "duit tak tally" atau "duit hilang", padahal ia cuma tengah **tunggu statement CHIP** diupload. Duit dah masuk, kita cuma belum ada kertas untuk padan.

Setiap baldi ada label warna (chip) dan tag saluran bayaran (COD, CHIP, atau Bank Transfer). Ini lima lima baldi macam yang awak nampak kat skrin:

| Baldi (macam di skrin) | Maksud dalam bahasa biasa | Apa perlu buat |
| --- | --- | --- |
| **Confirmed COD** (chip hijau, tag COD) | Order COD dah padan dengan bil kurier, duit COD memang dah disahkan masuk. | **Abaikan**, dah settle. |
| **Confirmed prepaid (CHIP)** (chip biru, tag CHIP) | Order yang bayar guna CHIP dah padan dengan baris statement CHIP yang berjaya, duit dah disahkan masuk. | **Abaikan**, dah settle. |
| **Awaiting COD remittance** (chip kuning, tag COD) | Order COD belum muncul dalam mana mana bil kurier. Normal sampai bil kurier sampai. | **Tunggu** bil kurier. Tengok kolum Aging, kalau umur dah lama baru risau. |
| **Awaiting CHIP statement** (chip biru, tag CHIP) | Order bayar CHIP masa checkout, cuma statement CHIP belum diupload. Auto sahkan sendiri bila statement masuk. **BUKAN duit bocor.** | **Tunggu**, atau upload statement CHIP terkini. |
| **No payment feed · cannot verify** (chip merah, tag Bank Transfer) | Kaedah bayaran ni belum ada feed disambung (contoh Bank Transfer), jadi app memang tak boleh sahkan duit masuk lagi. | **Siasat**, atau bagitahu owner (feed belum wujud). |

Dua baldi Confirmed (COD + CHIP) dicampur = jumlah botol "confirmed" yang awak nampak di tempat lain. Dua baldi **Awaiting bukan duit bocor**, dia cuma tunggu kertas: COD tunggu bil kurier, CHIP tunggu statement diupload. Kolum **Aging** tunjuk umur order paling lama yang masih tersangkut dalam baldi tu, supaya apa yang betul betul lambat tak hilang dari mata.

### Kenapa hanya baldi COD boleh dibuka

Dua baldi COD (Confirmed COD dan Awaiting COD remittance) ada anak panah kecil, klik dia terbuka satu jadual pecahan **per kurier** (J&T, DHL, Ninja Van). Sebabnya duit COD mengalir lalu tiga kurier berlainan, jadi kita perlu tahu kurier mana yang belum remit. Baldi CHIP dan Bank Transfer pula satu saluran je seorang, tiada apa nak pecah, sebab tu takde anak panah untuk dia.

### Banner semak SKU (bukan duit hilang)

Kadang kat halaman SKU (atau dalam modal stokis) muncul banner kuning macam **"X SKUs in orders are not mapped"**. Maksudnya: ada SKU dalam order yang **belum masuk katalog botol** kita, jadi order tu dikira **0 botol** buat sementara. Ini **bukan** tanda duit hilang, duit tetap tally macam biasa, cuma kiraan botol nampak kurang sampai SKU tu didaftarkan. Cara betulkan: pergi halaman SKU, tambah SKU yang tertinggal tu dengan bilangan botol dia, angka botol terus naik semula.

### Price change dalam Activity

Kat halaman **Activity** kadang muncul baris berlabel **Price change**. Maksudnya harga jualan sesuatu order **berubah antara dua upload**, contoh baris tu tulis "Order 12345: RM 100.00 -> RM 120.00". Ini berlaku bila awak upload export Fighter terkini dan harga sesuatu order dah lain dari kali sebelum.

Ini **log sahaja**, bukan masalah automatik, app tak buat apa apa selain catat perubahan tu. Gunanya untuk **siasat**: kalau ada kemusykilan kenapa duit sesuatu order nampak lain, awak boleh rujuk Activity dan nampak bila serta berapa harga dia berubah.

### Ringkas cara faham exception

Angka "exceptions" tu bukan salah awak upload, dan dia **berbeza** dengan baldi Awaiting di atas. Exception cuma dua jenis: **duit hantu** (ada duit dalam bil, tiada order padan) dan **tak padan** (order ada, duit ada, tapi jumlah tak sama). Baldi Awaiting (tunggu bil kurier atau tunggu statement CHIP) **bukan** exception, dia normal dan akan sahkan sendiri bila kertas sampai. Jadi kalau nampak exception, itu baru kes betul betul kena kejar puncanya, klik masuk stream berkenaan untuk lihat satu satu.

### Label "Amount unreadable" (ini BUKAN RM 0.00)

Kadang dalam kolum duit awak nampak label **"Amount unreadable"** ganti angka. Maksudnya: **ada baris bayaran** untuk order tu dalam bil atau statement, cuma **nilai duit dalam sel tu tak boleh dibaca** masa fail diupload (sel kosong, atau berisi teks bukan nombor).

Kenapa ni penting: dulu kes macam ni dipapar sebagai **RM 0.00**, dan itu menipu. Orang baca RM 0.00 lepas tu buat diagnosis salah, "customer bayar kurang" atau "duit bocor", sedangkan yang rosak sebenarnya **nilai dalam fail**, bukan duit. Sekarang app **tak** anggap ia sifar, dia beri label jujur "saya tak tahu berapa".

Apa perlu buat: **upload semula statement yang bersih** untuk baris tu, lepas tu semak balik. Satu lagi perkara nak tahu: dalam halaman **Review** (tempat kes exception ditandakan settle), baris berlabel "Amount unreadable" **wajib diputuskan finance lead (admin)**, bukan rakan sekerja biasa (peer). Sebabnya nilai yang kita tak tahu tak boleh dikira "kes kecil", jadi ia sentiasa naik satu tingkat.

### Kenapa exception Ninja Van tiba tiba turun banyak

Mulai hujung Julai 2026, angka exception untuk Ninja Van akan **turun mendadak**. Puncanya: SOA Ninja Van ada baris caj bukan COD (contoh **Returned to Sender**) yang nilai COD dia **RM 0**. Dulu app terima baris tu sebagai bukti "duit dah masuk", jadi banyak order tersalah tanda dan muncul dalam senarai siasatan sebagai kes pelik. Sekarang baris RM 0 **tak lagi mengesahkan duit masuk**, dan lebih kurang **96 kes palsu** terus hilang dari senarai siasatan.

Ini **pembetulan, bukan data hilang**. Tiada bil dipadam, tiada duit dibuang, cuma app berhenti mengira baris kosong sebagai bayaran. Kalau awak simpan screenshot angka lama, jangan risau bila nombor baru nampak jauh lebih kecil.

***

## 4. Perkara Selamat vs Jangan Sentuh

### Selamat, buat bila bila

* **Upload fail berulang kali**: app pandai, dia takkan kira dua kali (double count). Kalau awak upload fail yang sama dua kali, atau upload versi baru fail yang sama, dia hanya kemas kini rekod, bukan tambah baru. Jadi jangan takut nak re-upload.
* **Upload banyak fail sekali gus**: boleh, pilih semua sekali, dia proses satu satu.
* **Klik masuk keluar halaman, tekan link stream, tukar paparan**: semua ni cuma tengok, tak ubah data. Bebas explore.

### Hati hati, walau selamat

* **Selalu upload export PENUH dan TERKINI.** Kalau awak upload fail lama atau fail yang dah ditapis (contoh tapis satu tarikh je), app akan **tulis ganti** status order, tracking, dan harga dengan yang lama tu. Jadi bukan dia tambah, dia timpa. Sebab tu, ambil export penuh setiap kali, jangan yang separuh.

### Padam fail di halaman Uploads

Kat halaman **Uploads** setiap fail ada butang **Delete**. Ini untuk buang data satu fail yang tersilap upload, lepas tu awak boleh upload versi betul (re-upload tak pernah double count). Klik Delete tak terus padam, dia buka panel sahkan dulu (kena tick kotak akui) dan padam satu fail satu masa.

Lepas padam, app papar mesej hasil macam **"Removed 320 rows from ..."**. Kadang ada ayat tambahan selepas tu, dan itu **bukan tanda padam gagal**, ia tanda app lindungi baris yang bukan milik fail tu seorang:

* **"N orders kept (still claimed by another file)"**, ada baris yang **turut datang dari fail upload lain**, jadi app kekalkan. Kalau dibuang, awak akan hilang data yang fail lain masih tuntut sebagai milik dia.
* **"N older orders kept (no upload record, re-upload the file then delete to remove)"**, baris lama yang diupload **sebelum app mula jejak fail asal**, jadi app tak tahu ia datang dari fail mana dan tak berani buang. Nak buang betul betul: **upload semula fail tu sekali** (selamat, tak pernah double count) supaya app ada jejaknya, lepas tu baru tekan Delete.

Ayat sama ni boleh keluar untuk tiga jenis baris: **orders**, **gateway payments** (bayaran CHIP) dan **wallet transactions**.

### JANGAN SENTUH

* **Kad "Store admin"** (ada label "Admin only" dan kotak merah amaran). Kad ni ada butang untuk **kosongkan semua data store** (padam semua order, bil, wallet). Ini untuk owner sahaja, bukan kerja harian finance. **Jangan klik butang reset dalam kad tu.** Kalau tersilap masuk situ, keluar je, jangan sahkan apa apa.

***

## Kalau tersangkut

* Fail tak masuk atau "format not recognised" -> semak fail tu export penuh dan jenis yang betul (rujuk jadual seksyen 2), cuba semula.
* Upload jadi merah atau kuning -> **baca ayat sebab dia dulu**, pastu rujuk jadual "Sebab tolakan" dalam seksyen 2. Merah selalunya awak boleh betulkan sendiri (download semula, ambil export penuh), kuning kena naikkan pada finance lead atau owner. Tiada apa ditulis masuk sistem, jadi tiada data rosak.
* Statement CHIP ditolak -> semak lajur **Status** ada dalam export tu.
* Bil J&T nampak pecah jadi banyak baris -> normal, bil J&T dikira ikut hari. Pastikan awak upload guna **nama fail asal** dari J&T.
* Angka nampak pelik atau ada banyak exception -> bukan error app, itu data minta disiasat. Klik masuk stream berkenaan, atau bagitahu owner.
* Tak boleh login -> minta owner sahkan email awak dah didaftar.
* Apa apa yang awak tak pasti -> berhenti, tanya owner dulu. Lagi lagi apa apa berkaitan kad Store admin.

Selamat bekerja.
