import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import FormSiswa from "@/pages/akademik/FormSiswa";
import { SpmbVerificationPanel } from "@/components/akademik/SpmbVerificationPanel";

function EditSiswaPage() {
  const { id } = Route.useParams();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track only genuine user interaction. Radix Select uses a hidden native select
  // and dispatches programmatic change events while the edit form is hydrated;
  // those events have isTrusted=false and must not disable the verification panel.
  // Actual option clicks are rendered in a portal, so they are tracked separately.
  useEffect(() => {
    const markPortalSelectDirty = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="option"]')) setHasUnsavedChanges(true);
    };
    document.addEventListener("click", markPortalSelectDirty, true);
    return () => document.removeEventListener("click", markPortalSelectDirty, true);
  }, []);

  const markNativeFieldDirty = (event: React.SyntheticEvent) => {
    if (event.nativeEvent.isTrusted) setHasUnsavedChanges(true);
  };

  return (
    <div className="space-y-6">
      <div
        onInputCapture={markNativeFieldDirty}
        onChangeCapture={markNativeFieldDirty}
      >
        <FormSiswa onSaved={() => setHasUnsavedChanges(false)} />
      </div>
      <SpmbVerificationPanel siswaId={id} isDirty={hasUnsavedChanges} />
    </div>
  );
}

export const Route = createFileRoute("/_protected/_app/akademik/siswa/$id/edit")({
  component: EditSiswaPage,
});
