import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  X,
  MessageSquare,
  Bug,
  Lightbulb,
  MapPin,
  ImagePlus,
  Camera,
  Trash2,
  ListChecks,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { addFeedback } from './feedbackStorage';
import {
  BUG_SEVERITY_LABELS,
  FEATURE_IMPACT_LABELS,
  FEEDBACK_AREA_GROUPS,
  FEEDBACK_MAX_ATTACHMENTS,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_RATING_LEVEL_STYLES,
  composeFeatureFeedbackBody,
  composeIssueFeedbackBody,
  isAcceptableFeedbackImage,
} from './feedbackConstants';
import { useToast } from './ToastContext';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  authorEmail: string | null;
}

const fmtMb = (n: number) => (n / (1024 * 1024)).toFixed(0);

function RequiredStar() {
  return (
    <>
      <span className="text-red-600 font-semibold" title="Required" aria-hidden>
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, authorEmail }) => {
  const { addToast } = useToast();
  const [kind, setKind] = useState<'issue' | 'feature'>('issue');
  const [areaId, setAreaId] = useState('');
  const [rating, setRating] = useState<1 | 2 | 3 | 4>(2);

  const [issueTryingTo, setIssueTryingTo] = useState('');
  const [issueWhatHappened, setIssueWhatHappened] = useState('');
  const [issueExpected, setIssueExpected] = useState('');
  const [issueSteps, setIssueSteps] = useState('');

  const [featureNeed, setFeatureNeed] = useState('');
  const [featureIdea, setFeatureIdea] = useState('');
  const [featureExtra, setFeatureExtra] = useState('');

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
      setAreaId('');
      setRating(2);
      setIssueTryingTo('');
      setIssueWhatHappened('');
      setIssueExpected('');
      setIssueSteps('');
      setFeatureNeed('');
      setFeatureIdea('');
      setFeatureExtra('');
      setAttachments([]);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const formComplete = useMemo(() => {
    if (!areaId.trim()) return false;
    if (kind === 'issue') {
      return issueTryingTo.trim().length > 0 && issueWhatHappened.trim().length > 0;
    }
    return featureNeed.trim().length > 0 && featureIdea.trim().length > 0;
  }, [
    areaId,
    kind,
    issueTryingTo,
    issueWhatHappened,
    featureNeed,
    featureIdea,
  ]);

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
          `Skipped ${rejectedNames.length} file(s): ${rejectedNames.slice(0, 4).join(', ')}${
            rejectedNames.length > 4 ? '…' : ''
          } — images only, max ${fmtMb(FEEDBACK_MAX_IMAGE_BYTES)} MB each (JPEG, PNG, GIF, WebP).`,
          'error',
        );
      }
    },
    [addToast],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!formComplete || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const body =
        kind === 'issue'
          ? composeIssueFeedbackBody(areaId, {
              tryingTo: issueTryingTo,
              whatHappened: issueWhatHappened,
              expected: issueExpected,
              steps: issueSteps,
            })
          : composeFeatureFeedbackBody(areaId, {
              need: featureNeed,
              idea: featureIdea,
              extra: featureExtra,
            });

      const tags = [areaId.trim()];
      const result = await addFeedback(kind, body, authorEmail, { tags, rating, imageFiles: attachments });
      if (result.imagesRequested > 0 && !result.imagesSaved) {
        addToast(
          'Feedback was saved, but screenshot upload failed. Enable Anonymous auth in Firebase (or sign in with Google) and try images again.',
          'error',
        );
      } else {
        addToast('Thanks — your feedback was saved.', 'success');
      }
      onClose();
    } catch (e) {
      console.warn('Feedback submit failed:', e);
      const msg =
        e instanceof Error && e.message.startsWith('AUTH_ANONYMOUS_DISABLED:')
          ? e.message.replace(/^AUTH_ANONYMOUS_DISABLED:\s*/, '')
          : 'Could not save feedback. Try again.';
      addToast(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    formComplete,
    isSubmitting,
    kind,
    areaId,
    issueTryingTo,
    issueWhatHappened,
    issueExpected,
    issueSteps,
    featureNeed,
    featureIdea,
    featureExtra,
    authorEmail,
    rating,
    attachments,
    addToast,
    onClose,
  ]);

  if (!isOpen) return null;

  const scale = kind === 'issue' ? BUG_SEVERITY_LABELS : FEATURE_IMPACT_LABELS;
  const scaleTitle = kind === 'issue' ? 'Severity' : 'Importance / impact';
  const scaleHint =
    kind === 'issue'
      ? 'How disruptive is the problem? (1 = minor … 4 = critical)'
      : 'How valuable would this be? (1 = low … 4 = critical importance)';
  const accentIssue = kind === 'issue';
  const sectionRing = accentIssue ? 'ring-amber-200/80' : 'ring-indigo-200/80';
  const sectionBg = accentIssue ? 'bg-amber-50/60' : 'bg-indigo-50/50';
  const sectionBorder = accentIssue ? 'border-amber-200/90' : 'border-indigo-200/90';

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/35" onClick={() => !isSubmitting && onClose()} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        className={`relative bg-white border border-zinc-200 rounded-xl shadow-xl max-w-xl w-full p-0 max-h-[92vh] overflow-hidden flex flex-col ring-1 ${sectionRing}`}
      >
        <div className={`shrink-0 px-5 pt-5 pb-3 border-b ${sectionBorder} ${sectionBg}`}>
          <button
            type="button"
            onClick={() => !isSubmitting && onClose()}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-white/80"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3 pr-8">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm ${
                accentIssue ? 'bg-amber-100 border-amber-200 text-amber-800' : 'bg-indigo-100 border-indigo-200 text-indigo-800'
              }`}
            >
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 id="feedback-modal-title" className="text-sm font-semibold text-zinc-900 tracking-tight">
                Send feedback
              </h3>
              <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">
                Fields marked with <span className="text-red-600 font-semibold">*</span> are required. Screenshots are optional.
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 flex items-start gap-2"
            role="note"
          >
            <ListChecks className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
            <span>
              <span className="font-medium text-zinc-800">Required:</span> where in the app,{' '}
              {kind === 'issue' ? 'severity' : 'impact'}, and the questions below. This keeps reports consistent.
            </span>
          </div>

          <fieldset disabled={isSubmitting} className="border-0 p-0 m-0 min-w-0">
            <legend className="text-[11px] font-medium text-zinc-500 mb-2 flex items-center gap-1.5 w-full">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" aria-hidden />
              Type
            </legend>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Feedback type">
              <button
                type="button"
                onClick={() => setKind('issue')}
                disabled={isSubmitting}
                aria-pressed={kind === 'issue'}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-xs font-medium ${
                  kind === 'issue'
                    ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm ring-1 ring-amber-200'
                    : 'border-zinc-200 bg-zinc-50/80 text-zinc-600 hover:border-amber-200 hover:bg-amber-50/40'
                }`}
              >
                <Bug className={`w-4 h-4 shrink-0 ${kind === 'issue' ? 'text-amber-700' : 'text-zinc-400'}`} />
                <span>
                  <span className="block">Issue / bug</span>
                  <span className="block text-[10px] font-normal text-zinc-500 mt-0.5">Something wrong</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setKind('feature')}
                disabled={isSubmitting}
                aria-pressed={kind === 'feature'}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-xs font-medium ${
                  kind === 'feature'
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-900 shadow-sm ring-1 ring-indigo-200'
                    : 'border-zinc-200 bg-zinc-50/80 text-zinc-600 hover:border-indigo-200 hover:bg-indigo-50/40'
                }`}
              >
                <Lightbulb className={`w-4 h-4 shrink-0 ${kind === 'feature' ? 'text-indigo-700' : 'text-zinc-400'}`} />
                <span>
                  <span className="block">Feature idea</span>
                  <span className="block text-[10px] font-normal text-zinc-500 mt-0.5">Suggestion</span>
                </span>
              </button>
            </div>
          </fieldset>

          <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3">
            <label htmlFor="feedback-area" className="text-[11px] font-medium text-zinc-800 mb-1.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-sky-600" aria-hidden />
              Where in the app?
              <RequiredStar />
            </label>
            <select
              id="feedback-area"
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              disabled={isSubmitting}
              required
              aria-required="true"
              className="w-full px-3 py-2 text-sm border border-sky-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-400/80 text-zinc-900"
            >
              <option value="">Select an area…</option>
              {FEEDBACK_AREA_GROUPS.map((g) => (
                <optgroup key={g.groupLabel} label={g.groupLabel}>
                  {g.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-[10px] text-zinc-500 mt-1.5">Choose the screen or flow that best matches what you’re reporting.</p>
          </div>

          <fieldset
            disabled={isSubmitting}
            className={`rounded-lg border p-3 ${accentIssue ? 'border-amber-200 bg-amber-50/30' : 'border-indigo-200 bg-indigo-50/30'}`}
            aria-required="true"
          >
            <legend
              id="feedback-rating-label"
              className="text-[11px] font-medium text-zinc-800 mb-0.5 flex items-center gap-1.5 flex-wrap w-full"
            >
              {accentIssue ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" aria-hidden />
              )}
              {scaleTitle}
              <RequiredStar />
            </legend>
            <p id="feedback-rating-hint" className="text-[10px] text-zinc-600 mb-2">
              {scaleHint}
            </p>
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
              role="radiogroup"
              aria-labelledby="feedback-rating-label"
              aria-describedby="feedback-rating-hint"
            >
              {([1, 2, 3, 4] as const).map((n) => {
                const st = FEEDBACK_RATING_LEVEL_STYLES[n];
                const selected = rating === n;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setRating(n)}
                    disabled={isSubmitting}
                    className={`text-left px-2 py-2 rounded-lg border text-[11px] ${
                      selected ? st.selected : st.unselected
                    }`}
                  >
                    <span className="font-semibold tabular-nums">{n}</span>
                    <span className="block text-zinc-800 mt-0.5 leading-snug font-medium">{scale[n].short}</span>
                    <span className="block text-zinc-500 mt-1 text-[10px] leading-snug">{scale[n].hint}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset
            disabled={isSubmitting}
            className="rounded-lg border border-violet-200/90 bg-violet-50/30 p-3 space-y-3 min-w-0"
            aria-required="true"
          >
            <legend className="text-[11px] font-medium text-violet-900 flex items-center gap-1.5 w-full mb-2">
              Details
              <RequiredStar />
            </legend>

            {kind === 'issue' ? (
              <>
                <div>
                  <label htmlFor="feedback-issue-trying" className="text-[11px] font-medium text-zinc-700 block mb-1">
                    What were you trying to do? <RequiredStar />
                  </label>
                  <textarea
                    id="feedback-issue-trying"
                    value={issueTryingTo}
                    onChange={(e) => setIssueTryingTo(e.target.value)}
                    rows={2}
                    disabled={isSubmitting}
                    required
                    aria-required="true"
                    placeholder="e.g. Export grouped keywords to CSV"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/80 resize-y min-h-[52px]"
                  />
                </div>
                <div>
                  <label htmlFor="feedback-issue-wrong" className="text-[11px] font-medium text-zinc-700 block mb-1">
                    What went wrong? <RequiredStar />
                  </label>
                  <textarea
                    id="feedback-issue-wrong"
                    value={issueWhatHappened}
                    onChange={(e) => setIssueWhatHappened(e.target.value)}
                    rows={3}
                    disabled={isSubmitting}
                    required
                    aria-required="true"
                    placeholder="What actually happened on screen or in the data?"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/80 resize-y min-h-[72px]"
                  />
                </div>
                <div>
                  <label htmlFor="feedback-issue-expected" className="text-[11px] font-medium text-zinc-700 block mb-1">
                    What did you expect instead? <span className="text-zinc-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="feedback-issue-expected"
                    value={issueExpected}
                    onChange={(e) => setIssueExpected(e.target.value)}
                    rows={2}
                    disabled={isSubmitting}
                    aria-required="false"
                    placeholder="Correct behavior or outcome you expected"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/80 resize-y min-h-[52px]"
                  />
                </div>
                <div>
                  <label htmlFor="feedback-issue-steps" className="text-[11px] font-medium text-zinc-700 block mb-1">
                    Steps to reproduce <span className="text-zinc-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="feedback-issue-steps"
                    value={issueSteps}
                    onChange={(e) => setIssueSteps(e.target.value)}
                    rows={3}
                    disabled={isSubmitting}
                    aria-required="false"
                    placeholder="1. … 2. … (helps us reproduce the bug)"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/80 resize-y min-h-[72px]"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="feedback-feature-need" className="text-[11px] font-medium text-zinc-700 block mb-1">
                    What problem or need does this address? <RequiredStar />
                  </label>
                  <textarea
                    id="feedback-feature-need"
                    value={featureNeed}
                    onChange={(e) => setFeatureNeed(e.target.value)}
                    rows={2}
                    disabled={isSubmitting}
                    required
                    aria-required="true"
                    placeholder="The frustration, gap, or goal"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/80 resize-y min-h-[52px]"
                  />
                </div>
                <div>
                  <label htmlFor="feedback-feature-idea" className="text-[11px] font-medium text-zinc-700 block mb-1">
                    Describe the idea or change <RequiredStar />
                  </label>
                  <textarea
                    id="feedback-feature-idea"
                    value={featureIdea}
                    onChange={(e) => setFeatureIdea(e.target.value)}
                    rows={4}
                    disabled={isSubmitting}
                    required
                    aria-required="true"
                    placeholder="How should it work? What should we build or change?"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/80 resize-y min-h-[96px]"
                  />
                </div>
                <div>
                  <label htmlFor="feedback-feature-extra" className="text-[11px] font-medium text-zinc-700 block mb-1">
                    Anything else? <span className="text-zinc-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="feedback-feature-extra"
                    value={featureExtra}
                    onChange={(e) => setFeatureExtra(e.target.value)}
                    rows={2}
                    disabled={isSubmitting}
                    aria-required="false"
                    placeholder="Constraints, examples, or links"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/80 resize-y min-h-[52px]"
                  />
                </div>
              </>
            )}
          </fieldset>

          <div className="rounded-lg border border-emerald-200/90 bg-emerald-50/40 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <label htmlFor="feedback-screenshots-input" className="text-[11px] font-medium text-emerald-900 flex items-center gap-1.5 cursor-pointer">
                <Camera className="w-3.5 h-3.5 text-emerald-600" aria-hidden />
                Screenshots <span className="text-emerald-700/80 font-normal">(optional, max {FEEDBACK_MAX_ATTACHMENTS})</span>
              </label>
              <span className="text-[10px] text-emerald-800/80">
                {attachments.length}/{FEEDBACK_MAX_ATTACHMENTS}
              </span>
            </div>
            <p className="text-[10px] text-emerald-900/70 mb-2">
              Add up to {FEEDBACK_MAX_ATTACHMENTS} photos (max {fmtMb(FEEDBACK_MAX_IMAGE_BYTES)} MB each).
            </p>

            <input
              id="feedback-screenshots-input"
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
              multiple
              className="hidden"
              disabled={isSubmitting || attachments.length >= FEEDBACK_MAX_ATTACHMENTS}
              aria-label="Choose screenshot images"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />

            <div className="flex flex-wrap gap-2">
              {attachments.map((file, i) => (
                <div
                  key={`${file.name}-${file.size}-${i}`}
                  className="relative group w-[76px] h-[76px] rounded-lg border border-emerald-200 overflow-hidden bg-white shadow-sm"
                >
                  <img src={previewUrls[i]} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => removeAttachment(i)}
                    className="absolute inset-0 flex items-center justify-center bg-zinc-900/50 opacity-0 group-hover:opacity-100"
                    aria-label={`Remove image ${i + 1}`}
                  >
                    <Trash2 className="w-5 h-5 text-white" />
                  </button>
                </div>
              ))}

              {attachments.length < FEEDBACK_MAX_ATTACHMENTS && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add screenshot"
                  className="w-[76px] h-[76px] rounded-lg border-2 border-dashed border-emerald-300 bg-white/80 hover:bg-emerald-50/80 hover:border-emerald-400 flex flex-col items-center justify-center gap-1 text-emerald-700 disabled:opacity-50"
                >
                  <ImagePlus className="w-5 h-5" />
                  <span className="text-[9px] font-medium">Add</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-zinc-200 bg-zinc-50/90 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => !isSubmitting && onClose()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-zinc-600 hover:bg-zinc-200/80"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !formComplete}
            aria-busy={isSubmitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:pointer-events-none shadow-sm"
          >
            <MessageSquare className="w-3.5 h-3.5 opacity-90" />
            {isSubmitting ? 'Saving…' : 'Submit feedback'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
