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
3. Tunggu setiap fail siap. Ada label warna sebelah nama fail: hijau (berjaya masuk), kuning (format tak dikenali, tiada apa ditulis), merah (ada masalah).

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

### Tip export

Selalunya export **penuh dan terkini**, bukan export yang awak dah tapis ikut tarikh atau status. Sebab kenapa, lihat seksyen 4.

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

### Ringkas cara faham exception

Angka "exceptions" tu bukan salah awak upload. Dia jujur tunjuk mana data tak lengkap atau tak padan, supaya kita boleh kejar punca (contoh bil kurier tertinggal, atau order salah rekod). Kalau nampak exception, klik masuk stream berkenaan untuk lihat kes satu satu.

***

## 4. Perkara Selamat vs Jangan Sentuh

### Selamat, buat bila bila

* **Upload fail berulang kali**: app pandai, dia takkan kira dua kali (double count). Kalau awak upload fail yang sama dua kali, atau upload versi baru fail yang sama, dia hanya kemas kini rekod, bukan tambah baru. Jadi jangan takut nak re-upload.
* **Upload banyak fail sekali gus**: boleh, pilih semua sekali, dia proses satu satu.
* **Klik masuk keluar halaman, tekan link stream, tukar paparan**: semua ni cuma tengok, tak ubah data. Bebas explore.

### Hati hati, walau selamat

* **Selalu upload export PENUH dan TERKINI.** Kalau awak upload fail lama atau fail yang dah ditapis (contoh tapis satu tarikh je), app akan **tulis ganti** status order, tracking, dan harga dengan yang lama tu. Jadi bukan dia tambah, dia timpa. Sebab tu, ambil export penuh setiap kali, jangan yang separuh.

### JANGAN SENTUH

* **Kad "Store admin"** (ada label "Admin only" dan kotak merah amaran). Kad ni ada butang untuk **kosongkan semua data store** (padam semua order, bil, wallet). Ini untuk owner sahaja, bukan kerja harian finance. **Jangan klik butang reset dalam kad tu.** Kalau tersilap masuk situ, keluar je, jangan sahkan apa apa.

***

## Kalau tersangkut

* Fail tak masuk atau "format not recognised" -> semak fail tu export penuh dan jenis yang betul (rujuk jadual seksyen 2), cuba semula.
* Angka nampak pelik atau ada banyak exception -> bukan error app, itu data minta disiasat. Klik masuk stream berkenaan, atau bagitahu owner.
* Tak boleh login -> minta owner sahkan email awak dah didaftar.
* Apa apa yang awak tak pasti -> berhenti, tanya owner dulu. Lagi lagi apa apa berkaitan kad Store admin.

Selamat bekerja.
