import { redirect } from "next/navigation";

// Fasa 1 = Dicci Impact sahaja; landing pemilih syarikat datang bila
// subsidiary lain diaktifkan.
export default function Home() {
  redirect("/impact");
}
