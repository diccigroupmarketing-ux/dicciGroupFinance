// Sel duit yang JUJUR bila nilainya NULL.
//
// Nilai amount NULL ada DUA maksud yang jauh berbeza, dan sebelum ni UI campur
// aduk kedua duanya:
//   1. Tiada baris bayaran langsung (belum bayar / belum ada bil) -> "—" betul.
//   2. ADA baris bayaran padan, tapi nilainya gagal dibaca masa ingest. Parser
//      sengaja simpan NULL (bukan 0.0, lihat _amount_or_none dalam ingest.py)
//      supaya "gagal baca" tak jadi "RM0 disahkan" senyap.
//
// Kes 2 dipapar sebagai "RM 0.00" atau "—" = penipuan senyap: finance baca baris
// Amount mismatch berharga RM 0.00 dan buat diagnosis salah ("customer bayar
// kurang"), sedangkan yang rosak ialah nilai dalam fail. Komponen ni memberi kes
// 2 label sendiri.
//
// Isyarat `hasPayment` = ada baris bayaran padan untuk baris ni (awb / order_ref
// dari bil atau statement bukan NULL). Ia datang dari data, bukan tekaan
// kategori: kategori recon tak boleh membezakan dua kes di atas.
//
// PENTING: komponen ni TIDAK mengubah apa apa angka mahupun kategori. Enjin
// recon kekal seperti sedia ada; ini semata mata lapisan paparan.
import { fmtRM } from "@/lib/format";
import InfoTip from "@/components/InfoTip";

export const AMOUNT_UNREADABLE = "Amount unreadable";

const WHY = "The settlement file has a line for this order, but its amount could "
  + "not be read when the file was uploaded (the cell was blank or not a number). "
  + "This is NOT RM 0.00 and it is NOT proof the customer paid less. Re-upload a "
  + "clean statement for this line, then check the row again.";

export default function AmountCell({
  value, hasPayment = false, bold = false,
}: {
  value: number | null | undefined;
  // true = baris bayaran padan memang wujud (bil / statement), jadi amount NULL
  // bermakna nilai gagal dibaca, bukan "tiada bayaran".
  hasPayment?: boolean;
  bold?: boolean;
}) {
  if (value != null) return bold ? <b>{fmtRM(value)}</b> : <>{fmtRM(value)}</>;
  if (!hasPayment) return <>—</>;
  return (
    <span className="amtUnread">
      {AMOUNT_UNREADABLE}
      <InfoTip text={WHY} label="Why this amount is missing" />
    </span>
  );
}
