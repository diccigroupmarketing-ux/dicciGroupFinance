# Doktrin Fleet , dicciGroupFinance

Lapisan TAMBAHAN atas doktrin induk `~/.claude/doktrinOrkestrasi.md` (7 peraturan fan-out).
Doktrin induk kekal terpakai penuh. Fail ni khusus untuk repo pegang duit ni.

**Untuk siapa**: mana mana fleet subagent yang TULIS kod dalam repo ni (mod tangan).
Mod mata (baca dan lapor sahaja) tak terikat gate ujian, tapi terikat skop dan zon haram.

Status: mod tangan LULUS BERSYARAT oleh Jarvis 2026-07-28. Penggera terbukti menggigit
lewat mutation check bebas (enjin lama dipasang balik: 11/18 `testReconEdgeCases.py` gagal,
guard dimatikan: 11 ujian parser gagal, `recon.ts` lama: 2/7 gagal). Baseline direproduksi
tepat, parity 3 enjin lulus. Doktrin induk peraturan 7 (zon haram tulis) kini dibuka
BERSYARAT untuk repo ni, syaratnya seksyen 1 dan 2 di bawah.

## 1. Gate ujian WAJIB (haram commit tanpa ni)

HARAM commit apa apa perubahan kod tanpa ketiga tiga ni hijau, dijalankan sendiri,
bukan diandaikan:

1. **`cd webApp && npm test`** hijau PENUH, 15 langkah, dengan dev PG embedded 5433 hidup
   (`node scripts/devDb.mjs` dalam terminal lain). Separa hijau = gagal.
2. **`cd webApp && npm run check:engine`** lulus (salinan enjin Python dalam `webApp/api/engine`
   selaras dengan root).
3. **Baseline byte identik**:
   `DATABASE_URL="sqlite:///$PWD/data/baselineRecon.db" python3 reconcile.py`
   mesti keluar `Nilai tally ... RM 63,912.00 (369 order)`. Bandingkan output, bukan pandang
   sekilas. Nota ketepatan: "byte identik" tepat untuk baseline + trio dump Python sahaja,
   `e3.json` dibanding sebagai multiset, bukan byte.

**Sebab gate ni wujud**: repo ni TIADA CI. Build Vercel TIDAK jalankan ujian. Penggera yang
dipasang susah payah hanya berbunyi kalau ada orang tekan butang. Fleet lah butang tu.

## 2. Skop mod tangan (zon boleh tulis)

Fleet tulis HANYA boleh sentuh:

- Enjin recon: `reconcile.py` (rujukan kebenaran), `reconSql.py`, `webApp/lib/recon.ts`
- Laluan Fighter dalam ingest (`ingest.py` bahagian Fighter + guard pintu Fighter)
- Ujian dan harness yang mengiringi dua zon atas

**Perlu approval owner dulu** (jangan sentuh sendiri walau nampak remeh):

- Parser ingest lain: wallet, jnt, dhl, ninja, chip. Laluan ni masih TIADA guard pintu,
  jadi kerosakan senyap tak akan ditangkap ujian.

**Zon haram mutlak** (jangan sentuh, walau owner nampak setuju dalam sembang):

- Schema DB dan migrasi
- Secrets: `.streamlit/secrets.toml`, `.env*`, env Vercel, kredential Neon
- Apa apa yang menulis ke Neon PRODUKSI. Kerja dev atas dev PG 5433 sahaja
- Fail dalam `.gitignore` (data sebenar, `peta/`, runbook ops, `CLAUDE.md`)

## 3. Harness parity 3 enjin

- Lokasi: `parityHarness/` di root repo (bukan lagi scratchpad `/tmp`, ia lenyap bila Mac restart)
- Jalan: `bash parityHarness/jalan.sh`
- WAJIB LULUS setiap kali logik recon diubah, sebelum commit. Ia yang banding E1 `reconcile.py`
  lawan E2 `reconSql.py` lawan E3 `recon.ts` baris demi baris
- Fail data harness (`parityHarness/data/`) GITIGNORED sebab repo ni PUBLIC. Jangan commit
  fixture berisi data sebenar, jangan "betulkan" gitignore supaya ia masuk

## 4. Amaran ops (baca sebelum tekan apa apa)

- **`npm test` MEMADAM data dev PG 5433.** Ia restore snapshot dan jalankan `testMutations`.
  Jangan jalankan suite bila ada kerja dev belum simpan dalam DB dev. Simpan atau buang dulu,
  baru test
- **Parity recon perlu `RECON_TODAY=2026-06-18`.** Tanpa dia, angka aging bergerak ikut hari
  sebenar dan parity "gagal" secara palsu. Rujuk memori projek dan HANDOVER
- Deploy Vercel decoupled dari git. Fleet JANGAN deploy. Sesi utama yang deploy
- Fleet JANGAN commit dan JANGAN push. Serahkan diff pada sesi utama, sesi utama yang commit

## 5. Peraturan sedia ada yang kekal (bukan baru, jangan langgar)

- Ubah logik recon = ubah `reconcile.py` DULU (ia rujukan kebenaran), lulus harness parity
  lawan `reconSql.py` + `recon.ts`, baru sync salinan enjin dan deploy. Bukan sebaliknya
- Repo ni PUBLIC. Jangan commit data sebenar, secrets, atau apa apa dalam senarai gitignore
- Ciri view baru (penapis, papar, susun) = lapisan read only ATAS output recon. Jangan
  ubah enjin untuk hal persembahan
- HARAM tulis "DC" dalam kod, UI, komen, atau dokumen. Sentiasa "Dicci" penuh
- Bahasa: dokumen dan komen dalaman BM santai tiada dash, UI app English penuh

## 6. Bila fleet kena BERHENTI dan tanya

Berhenti terus, lapor pada sesi utama, jangan teruskan sendiri, bila:

- Ujian gagal dan puncanya nampak macam "ujian yang salah". Jangan sekali kali longgarkan
  ujian atau baseline untuk buat kod lulus. Ujian ni yang jaga duit
- Kerja tu perlu sentuh zon perlu approval atau zon haram (seksyen 2)
- Baseline RM 63,912.00 berubah walau satu sen. Itu isyarat merah, bukan "sikit je"
- Anchor putus: fail atau fungsi yang spec kerja andaikan wujud, tapi tak jumpa dalam repo
  (doktrin induk peraturan 6, gagal terus, lapor anchor mana putus)

## 7. Baki peta yang belum lengkap (sedar, jangan anggap repo bersih)

- 42 finding audit `duitAnchor` mati dalam log, belum ditapis satu satu
- 2 divergen `reconTrust` belum diverify (corak sama, belum disahkan skeptik bebas)

Rujukan: `HANDOVER.md` seksyen nota Jarvis 2026-07-26 dan 2026-07-28,
`docs/enjinReconDivergen.md`, `CLAUDE.md` seksyen peraturan recon.
