import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare } from 'lucide-react';
import FeedbackModal from './FeedbackModal';

export interface FeedbackModalHostProps {
  authorEmail: string | null;
}

/**
 * Owns modal open state so toggling does not re-render the large `App` tree.
 * Renders the dialog via a portal to `document.body` for layout isolation.
 */
const FeedbackModalHost = React.memo(function FeedbackModalHost({ authorEmail }: FeedbackModalHostProps) {
  const [open, setOpen] = useState(false);
  const onClose = useCallback(() => setOpen(false), []);

  const portalRoot = typeof document !== 'undefined' ? document.body : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-2 text-sm font-medium rounded-md flex items-center gap-1.5 text-zinc-600 hover:text-zinc-800 bg-white border border-zinc-200 shadow-sm"
      >
        <MessageSquare className="w-3.5 h-3.5" />
        Send feedback
      </button>
      {open &&
        portalRoot != null &&
        createPortal(
          <FeedbackModal isOpen onClose={onClose} authorEmail={authorEmail} />,
          portalRoot,
        )}
    </>
  );
});

export default FeedbackModalHost;
