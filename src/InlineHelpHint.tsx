import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Shared visual style for all portal tooltips (matches app light cards). */
const TOOLTIP_PANEL_BASE =
  'z-[100] bg-white border border-zinc-200 rounded-md shadow-sm text-zinc-700 text-[10px] px-2 py-1.5 whitespace-pre-wrap leading-relaxed pointer-events-none';

export const DEFAULT_TOOLTIP_CLASS = `${TOOLTIP_PANEL_BASE} max-w-[260px]`;

/** Same as default, wider max-width (long diagnostics) — still one visual system. */
export const WIDE_TOOLTIP_CLASS = `${TOOLTIP_PANEL_BASE} max-w-[min(22rem,calc(100vw-1.5rem))]`;

export interface InlineHelpHintProps {
  /** Plain string (used when `tooltipContent` is not set). */
  text?: string;
  /** Rich tooltip body; when set, shown instead of `text`. */
  tooltipContent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Override tooltip panel classes (e.g. wider max-width for long diagnostics). */
  tooltipClassName?: string;
  /** Use `group` for non-button hints (e.g. status chips). Default `button` keeps keyboard affordance. */
  triggerRole?: 'button' | 'group';
  /** Gap between anchor and tooltip (px). Default 8; use 4 for tighter status popovers. */
  tooltipGap?: number;
}

type Placement = 'bottom' | 'top';

const VIEWPORT_PAD = 8;

/**
 * Small inline help tooltip.
 * Uses a portal to avoid being clipped by parent `overflow: hidden`.
 * Positions with horizontal clamp so wide panels don’t clip off-screen; z-index above typical sticky rows.
 */
export default function InlineHelpHint({
  text = '',
  tooltipContent,
  children,
  className,
  ariaLabel,
  tooltipClassName,
  triggerRole = 'button',
  tooltipGap = 8,
}: InlineHelpHintProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const portalRoot = typeof document !== 'undefined' ? document.body : null;

  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>('bottom');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el || typeof window === 'undefined') return;

    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Taller panels (e.g. connection diagnostics) need more clearance before flipping above.
    const nextPlacement: Placement = spaceBelow < 200 && spaceAbove > spaceBelow ? 'top' : 'bottom';

    const vw = window.innerWidth;
    const estimatedHalfW = Math.min(176, (vw - 2 * VIEWPORT_PAD) / 2);

    let centerX = rect.left + rect.width / 2;
    centerX = Math.max(
      VIEWPORT_PAD + estimatedHalfW,
      Math.min(vw - VIEWPORT_PAD - estimatedHalfW, centerX),
    );

    const top =
      nextPlacement === 'bottom' ? rect.bottom + tooltipGap : rect.top - tooltipGap;

    setPlacement(nextPlacement);
    setPos({ left: centerX, top });
  }, [tooltipGap]);

  /** After paint, measure real tooltip width and clamp center so nothing clips at viewport edges. */
  useLayoutEffect(() => {
    if (!open || !pos || !anchorRef.current || !tooltipRef.current) return;

    const tip = tooltipRef.current;
    const anchor = anchorRef.current;
    const tipRect = tip.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();

    const vw = window.innerWidth;
    const halfW = tipRect.width / 2;
    let centerX = ar.left + ar.width / 2;
    centerX = Math.max(
      VIEWPORT_PAD + halfW,
      Math.min(vw - VIEWPORT_PAD - halfW, centerX),
    );

    if (Math.abs(centerX - pos.left) > 0.5) {
      setPos((p) => (p ? { ...p, left: centerX } : p));
    }
  }, [open, pos, text, tooltipContent, tooltipClassName, placement]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const requestOpen = useCallback(() => {
    clearHideTimer();
    setOpen(true);
    updatePosition();
  }, [clearHideTimer, updatePosition]);

  const requestClose = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }, [clearHideTimer]);

  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;

    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, updatePosition]);

  const tooltip = useMemo(() => {
    if (!open || !pos || !portalRoot) return null;

    const transform =
      placement === 'bottom'
        ? 'translateX(-50%)'
        : 'translateX(-50%) translateY(-100%)';

    const body = tooltipContent ?? text;

    return createPortal(
      <div
        ref={tooltipRef}
        role="tooltip"
        className={tooltipClassName ?? DEFAULT_TOOLTIP_CLASS}
        style={{ position: 'fixed', left: pos.left, top: pos.top, transform }}
      >
        {body}
      </div>,
      portalRoot,
    );
  }, [open, pos, portalRoot, placement, text, tooltipContent, tooltipClassName]);

  const triggerAria =
    ariaLabel ?? (typeof text === 'string' && text.length > 0 ? text : 'Help');

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        tabIndex={0}
        role={triggerRole === 'group' ? 'group' : 'button'}
        aria-label={triggerAria}
        onMouseEnter={requestOpen}
        onMouseLeave={requestClose}
        onFocus={requestOpen}
        onBlur={requestClose}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) setOpen(false);
          else requestOpen();
        }}
      >
        {children}
      </span>
      {tooltip}
    </>
  );
}
