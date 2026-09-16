import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import FormSiswa from "@/pages/akademik/FormSiswa";
import { SpmbVerificationPanel } from "@/components/akademik/SpmbVerificationPanel";

function EditSiswaPage() {
  const { id } = Route.useParams();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Native inputs bubble through the wrapper. Radix Select options are rendered in
  // a portal, so listen for option clicks as well. This intentionally stays dirty
  // after a failed save; a successful edit currently navigates back to detail.
  useEffect(() => {
    const markPortalSelectDirty = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="option"]')) setHasUnsavedChanges(true);
    };
    document.addEventListener("click", markPortalSelectDirty, true);
    return () => document.removeEventListener("click", markPortalSelectDirty, true);
  }, []);

  return (
    <div className="space-y-6">
      <div
        onInputCapture={() => setHasUnsavedChanges(true)}
        onChangeCapture={() => setHasUnsavedChanges(true)}
      >
        <FormSiswa />
      </div>
      <SpmbVerificationPanel siswaId={id} isDirty={hasUnsavedChanges} />
    </div>
  );
}

export const Route = createFileRoute("/_protected/_app/akademik/siswa/$id/edit")({
  component: EditSiswaPage,
});
