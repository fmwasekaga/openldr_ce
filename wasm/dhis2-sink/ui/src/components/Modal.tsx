import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { t } from '../i18n';

/**
 * A minimal, dependency-free overlay dialog. Replaces shadcn's Dialog inside the
 * iframe (no host CSS). Renders nothing when closed; otherwise an overlay + a
 * panel with a title, a close (×) button, and the children. Closes on overlay
 * click and on Escape. Reused by the Mappings run/delete dialogs (Task 10) and
 * later by the Mapping editor (Task 11).
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  testId,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  testId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div class="modal-overlay" onClick={() => onClose()}>
      <div
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="modal-head">
          <h2 class="modal-title">{title}</h2>
          <button type="button" class="modal-close" aria-label={t('modal.close')} onClick={() => onClose()}>
            ×
          </button>
        </div>
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}
