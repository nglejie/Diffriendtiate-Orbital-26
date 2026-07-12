import SmallSettingsDialog from "./SmallSettingsDialog.tsx";

/**
 * Shows a small acknowledgement modal for validation and recoverable user errors.
 * Keeping this shared prevents each feature from inventing its own error surface.
 */
function AlertDialog({ message, onClose }) {
  return (
    <SmallSettingsDialog
      ariaLabel="Notice"
      backdropClassName="alert-modal-backdrop"
      className="alert-modal compact-dialog"
      footer={
        <button className="primary-button compact" onClick={onClose} type="button">
          OK
        </button>
      }
      onClose={onClose}
      role="alertdialog"
      title="Notice"
    >
      <p className="dialog-copy">{message}</p>
    </SmallSettingsDialog>
  );
}

export default AlertDialog;
