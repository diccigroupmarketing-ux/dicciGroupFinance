import { uploadedFiles } from "@/lib/recon";
import UploadsManager from "@/components/UploadsManager";

export const dynamic = "force-dynamic";

export default async function UploadsPage() {
  const files = await uploadedFiles();

  return (
    <>
      <div className="pageHead">
        <div>
          <div className="eyebrow">Dicci Impact · Governance</div>
          <h1>Uploads</h1>
          <div className="pageSub">
            Every file the team has uploaded, and what it contributed to the store.
            Uploaded the wrong file? Delete it here, then upload the corrected
            version , re-uploads never double count.
          </div>
        </div>
      </div>

      <UploadsManager files={files} />

      <div className="footNote">
        Deletes are permanent, logged to Activity, and update every dashboard immediately.
      </div>
    </>
  );
}
