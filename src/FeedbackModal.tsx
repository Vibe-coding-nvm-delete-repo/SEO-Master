import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, Bug, Lightbulb, ImagePlus, Trash2 } from 'lucide-react';
import { addFeedback } from './feedbackStorage';
import { addNotificationEntry } from './notificationStorage';
import {
  FEEDBACK_MAX_ATTACHMENTS,
  FEEDBACK_MAX_IMAGE_BYTES,
  isAcceptableFeedbackImage,
} from './feedbackConstants';
import { useToast } from './ToastContext';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  authorEmail: string | null;
}

const fmtMb = (n: number) => (n / (1024 * 1024)).toFixed(0);

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, authorEmail }) => {
  const { addToast } = useToast();
  const [kind, setKind] = useState<'issue' | 'feature'>('issue');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewUrls = useMemo(() => attachments.map((f) => URL.createObjectURL(f)), [attachments]);

  useEffect(() => {
    return () => {
      previewUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [previewUrls]);

  useEffect(() => {
    if (!isOpen) {
      setKind('issue');
      setDescription('');
      setAttachments([]);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const rejectedNames: string[] = [];
      const accepted: File[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList.item(i);
        if (!f) continue;
        if (isAcceptableFeedbackImage(f)) accepted.push(f);
        else rejectedNames.push(f.name);
      }
      setAttachments((prev) => {
        const next = [...prev];
        for (const f of accepted) {
          if (next.length >= FEEDBACK_MAX_ATTACHMENTS) break;
          next.push(f);
        }
        return next;
      });
      if (rejectedNames.length > 0) {
        addToast(
          `Skipped ${rejectedNames.length} file(s) — images only, max ${fmtMb(FEEDBACK_MAX_IMAGE_BYTES)} MB each.`,
          'error',
          {
            notification: {
              mode: 'none',
              source: 'feedback',
            },
          },
        );
      }
    },
    [addToast],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!description.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const body = description.trim();
      const feedbackCopyText = [
        `Type: ${kind === 'issue' ? 'Issue' : 'Feature'}`,
        `Author: ${authorEmail || 'â€”'}`,
        '',
        'Feedback:',
        body,
      ].join('\n');
      const feedbackCopyTextClean = feedbackCopyText.replace(/Ã¢â‚¬â€/g, '-');
      const successNotificationMessage = 'Thanks - feedback saved!';
      const result = await addFeedback(kind, body, authorEmail, {
        tags: ['other'],
        rating: 2,
        imageFiles: attachments,
      });
      if (!(result.imagesRequested > 0 && !result.imagesSaved)) {
        const successNotificationPayload = {
          createdAt: new Date().toISOString(),
          type: 'success' as const,
          source: 'feedback' as const,
          message: 'Thanks â€” feedback saved!',
          copyText: feedbackCopyTextClean,
          projectId: null,
          projectName: null,
        };
        successNotificationPayload.message = successNotificationMessage;
        void addNotificationEntry(successNotificationPayload).catch((err) => {
          console.warn('Failed to persist feedback success notification:', err);
        });
      }
      if (result.imagesRequested > 0 && !result.imagesSaved) {
        addToast('Feedback saved, but screenshot upload failed.', 'error', {
          notification: {
            mode: 'shared',
            source: 'feedback',
            copyText: feedbackCopyTextClean,
          },
        });
      } else {
        addToast('Thanks — feedback saved!', 'success');
      }
      onClose();
    } catch (e) {
      console.warn('Feedback submit failed:', e);
      addToast('Could not save feedback. Try again.', 'error', {
        notification: {
          mode: 'shared',
          source: 'feedback',
          copyText: description.trim() || 'Feedback submission failed before any body was saved.',
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [description, isSubmitting, kind, authorEmail, attachments, addToast, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/35" onClick={() => !isSubmitting && onClose()} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        className="relative bg-white border border-zinc-200 rounded-xl shadow-xl max-w-md w-full p-0 max-h-[80vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-zinc-200 bg-zinc-50/80">
          <button
            type="button"
            onClick={() => !isSubmitting && onClose()}
            className="absolute top-3 right-3 p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <h3 id="feedback-modal-title" className="text-sm font-semibold text-zinc-900">
            Send feedback
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">Bug or feature idea — keep it short.</p>
        </div>

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto space-y-3">
          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind('issue')}
              disabled={isSubmitting}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                kind === 'issue'
                  ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm'
                  : 'border-zinc-200 text-zinc-500 hover:border-amber-200 hover:bg-amber-50/40'
              }`}
            >
              <Bug className="w-3.5 h-3.5" />
              Bug
            </button>
            <button
              type="button"
              onClick={() => setKind('feature')}
              disabled={isSubmitting}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                kind === 'feature'
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-900 shadow-sm'
                  : 'border-zinc-200 text-zinc-500 hover:border-indigo-200 hover:bg-indigo-50/40'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              Feature idea
            </button>
          </div>

          {/* Description */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            disabled={isSubmitting}
            placeholder={
              kind === 'issue'
                ? 'What happened? What did you expect?'
                : 'What would you like to see?'
            }
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400/60 resize-y min-h-[80px]"
          />

          {/* Screenshots */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
              multiple
              className="hidden"
              disabled={isSubmitting || attachments.length >= FEEDBACK_MAX_ATTACHMENTS}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />

            {attachments.map((file, i) => (
              <div
                key={`${file.name}-${file.size}-${i}`}
                className="relative group w-10 h-10 rounded-md border border-zinc-200 overflow-hidden bg-white"
              >
                <img src={previewUrls[i]} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => removeAttachment(i)}
                  className="absolute inset-0 flex items-center justify-center bg-zinc-900/50 opacity-0 group-hover:opacity-100"
                  aria-label={`Remove image ${i + 1}`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
            ))}

            {attachments.length < FEEDBACK_MAX_ATTACHMENTS && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Screenshot
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-zinc-200 bg-zinc-50/90 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => !isSubmitting && onClose()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-zinc-500 hover:bg-zinc-200/80"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !description.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:pointer-events-none shadow-sm"
          >
            {isSubmitting ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
