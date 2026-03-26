# Plan: Technical Debt Prevention — Status + Current Source of Truth

## Problem

The codebase still has concentrated technical debt in high-change files:
- `App.tsx`: **6,217 lines**
- `AutoGroupPanel.tsx`: **3,867 lines**
- `GenerateTab.tsx`: **1,852 lines**
- `AutoGroupEngine.ts`: **1,203 lines**
- `useProjectPersistence.ts`: **840 lines**

The rules in CONTRIBUTING.md say "max ~400 lines per component" but were never enforced.

## Status

This plan has been superseded by the concrete, actively maintained roadmap in:
- `REFACTOR_PLAN.md` (repo root)

That file now defines:
- current priority tiers (P0-P3)
- execution sequence based on newest product demand
- acceptance criteria per phase
- mandatory verification gates

## Why this update was needed

Current demand profile shifted from "generic cleanup" to:
- strict multi-user data integrity under rapid collaboration
- high-frequency changes in Feedback, Auto-Group, and Generate flows
- need for safer iteration boundaries before additional feature expansion

The active plan in `REFACTOR_PLAN.md` reflects that demand shift and prioritizes:
1. P0 correctness and sync reliability
2. P1 refactors on active demand paths
3. P2/P3 optimization and polish
