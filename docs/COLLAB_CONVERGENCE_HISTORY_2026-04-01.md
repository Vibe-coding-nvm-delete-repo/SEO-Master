# Collaboration Convergence History (2026-04-01)

This document records the reasoning-level implementation history for the
shared-collaboration hardening work completed on 2026-04-01.

It is intentionally explicit about:
- evaluated failure classes
- design choices and tradeoffs
- code-level conclusions
- validation outcomes

## 1) Problem statement

Users reported inconsistent multi-user propagation in shared projects:
- some edits converged
- some edits did not appear on other clients
- browser restart was not a reliable recovery

Required outcome:
- shared state changes must converge through authoritative Firestore paths
- clients must not remain editable while non-authoritative
- release process must block regressions before ship

## 2) Evaluations performed

### 2.1 Shared V2 bootstrap/listener lifecycle

Hypothesis:
- initial actionable `collab/meta` snapshots could be skipped during bootstrap
- entity listener attach/reload could depend on later meta events

Conclusion:
- this race class was valid and required deterministic queue-and-drain behavior

### 2.2 Shared readiness and edit gating

Hypothesis:
- shared writes could become available before full authoritative readiness

Conclusion:
- strict fail-closed gating is required for shared projects until readiness is
  authoritative

### 2.3 Process-level coverage

Hypothesis:
- static Firestore census/audit checks can pass while runtime multi-user
  convergence still regresses

Conclusion:
- runtime convergence checks must be mandatory in the collab gate (not optional)

### 2.4 Incident forensics capability

Hypothesis:
- existing observability was strong for prevention but weak for post-incident
  timeline reconstruction

Conclusion:
- durable local diagnostics journaling with correlation IDs was required

## 3) Design decisions and tradeoffs

### Decision A: queue-and-drain bootstrap meta

Why:
- prevents skip-and-forget behavior for early actionable meta snapshots

Tradeoff:
- slightly more state management complexity in bootstrap path

### Decision B: deterministic listener reattach trigger

Why:
- avoids dependence on future meta events after authoritative canonical activation

Tradeoff:
- requires careful generation/project-switch guard handling to avoid stale attach

### Decision C: shared fail-closed edit policy

Why:
- prevents editable-but-desynced windows

Tradeoff:
- shared projects may remain read-only longer during convergence under poor network

### Decision D: release gate must include runtime convergence matrix

Why:
- static callsite checks do not prove runtime convergence correctness

Tradeoff:
- longer gate runtime; accepted as required quality bar

### Decision E: durable diagnostics journal with correlation IDs

Why:
- allows incident timeline reconstruction across users/sessions

Tradeoff:
- bounded localStorage footprint; implemented via capped ring buffer

## 4) Implemented changes summary

## Runtime convergence hardening
- `src/useProjectPersistence.ts`
  - bootstrap meta queue/drain
  - deterministic post-authoritative listener attach
  - authoritative readiness preservation across reattach
  - strict shared fail-closed gating until authoritative readiness

## Regression coverage
- `src/useProjectPersistence.v2.test.tsx`
  - queued bootstrap meta drain coverage
  - shared provisional fallback behavior coverage
  - readiness and mutation-guard regressions

## Process/gate hardening
- `package.json`
  - added `collab:convergence`
  - `collab:gate` now enforces convergence matrix
  - `collab:release-gate` starts from hardened collab gate

## Forensics/observability hardening
- `src/collabDiagnosticsLog.ts`
  - durable bounded diagnostics journal
- `src/cloudSyncStatus.ts`
  - diagnostics emission at critical convergence transitions
- `src/runtimeTrace.ts`
  - exported runtime session/run correlation context
- `src/collabDiagnosticsLog.test.ts`
- `src/cloudSyncStatus.diagnostics.test.ts`

## 5) Validation outcomes

Validated through:
- `npm run collab:convergence`
- `npm run collab:gate`
- `npm run collab:release-gate`

Gate coverage includes:
- shared app settings convergence integration tests
- project metadata convergence tests
- shared project app integration convergence tests
- shared V2 persistence convergence/race tests
- Firestore rules emulator tests
- two-session browser collaboration E2E tests
- full repo typecheck/tests/build in release gate

## 6) Operational usage notes

For incident debugging in a live browser session:
- read recent diagnostics:
  - `window.__kwgCollabDiagnostics.read(300)`
- clear diagnostics after export:
  - `window.__kwgCollabDiagnostics.clear()`

Journal entries include:
- event kind
- timestamp
- optional project/channel/action identifiers
- `sessionId` and `runId` correlation metadata

## 7) Practical guarantee statement

No distributed system can claim literal absolute certainty against every future
network/runtime failure.

This hardening provides the strongest practical guarantee in this codebase:
- known shared-desync classes addressed in runtime logic
- shared edits blocked while non-authoritative
- release blocked unless convergence matrix passes
- durable incident diagnostics available for post-mortem reconstruction
