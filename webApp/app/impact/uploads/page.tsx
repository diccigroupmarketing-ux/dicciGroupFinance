import { uploadedFiles, billLineConflicts } from "@/lib/recon";
import UploadsManager from "@/components/UploadsManager";
import BillConflicts from "@/components/BillConflicts";

export const dynamic = "force-dynamic";

export default async function UploadsPage() {
  const [files, conflicts] = await Promise.all([
    uploadedFiles(), billLineConflicts(),
  ]);

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

      {conflicts.length > 0 && <BillConflicts rows={conflicts} />}

      <UploadsManager files={files} />

      <div className="footNote">
        Deletes are permanent, logged to Activity, and update every dashboard immediately.
      </div>
    </>
  );
}
