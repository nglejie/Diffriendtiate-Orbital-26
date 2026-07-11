import { useState } from "react";
import { createPortal } from "react-dom";
import SmallSettingsDialog from "./SmallSettingsDialog.tsx";

/**
 * Reusable destructive-action confirmation modal.
 * The async submit path keeps delete buttons disabled while the request is in flight.
 */
function ConfirmDialog({
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  submittingLabel = "Deleting",
  title,
}) {
  const [submitting, setSubmitting] = useState(false);

  /** Runs the caller's destructive action while locking the dialog controls. */
  async function handleConfirm() {
    setSubmitting(true);
    await onConfirm();
    setSubmitting(false);
  }

  const dialog = (
    <SmallSettingsDialog
      ariaLabel={title}
      className="confirm-dialog"
      footer={
        <button
          className="danger-button compact"
          disabled={submitting}
          onClick={handleConfirm}
          type="button"
        >
          {submitting ? submittingLabel : confirmLabel}
        </button>
      }
      onClose={onCancel}
      role="alertdialog"
      title={title}
    >
      <p className="dialog-copy">{message}</p>
    </SmallSettingsDialog>
  );

  return createPortal(dialog, document.body);
}

export default ConfirmDialog;
