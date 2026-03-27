/**
 * Pure helpers for Pages / Grouped expanded cluster keyword sub-rows.
 * Keeps column alignment logic testable outside App.tsx.
 */

import type { ClusterSummary } from './types';

export type ClusterKeywordEntry = ClusterSummary['keywords'][number];

/** Stable React key for Ungrouped (Pages) tab child rows. */
export function pagesTabChildRowKey(pageName: string, index: number, keyword: string): string {
  return `${pageName}\0kw\0${index}\0${keyword}`;
}

/** Stable React key for Grouped tab sub-cluster child rows. */
export function groupedTabChildRowKey(subId: string, index: number, keyword: string): string {
  return `${subId}-kw-${index}-${keyword}`;
}

export function keywordLenForCell(keyword: string): number {
  return keyword.length;
}

export function kdCellDisplay(kd: number | null): number | '-' {
  return kd !== null ? kd : '-';
}

export function volumeCellDisplay(volume: number): string {
  return volume.toLocaleString();
}

export function pagesTabChildCity(
  kw: ClusterKeywordEntry,
  parent: Pick<ClusterSummary, 'locationCity'>
): string {
  return kw.locationCity ?? parent.locationCity ?? '-';
}

export function pagesTabChildState(
  kw: ClusterKeywordEntry,
  parent: Pick<ClusterSummary, 'locationState'>
): string {
  return kw.locationState ?? parent.locationState ?? '-';
}

export function groupedTabChildCity(
  kw: ClusterKeywordEntry,
  cluster: Pick<ClusterSummary, 'locationCity'>
): string {
  return kw.locationCity ?? cluster.locationCity ?? '-';
}

export function groupedTabChildState(
  kw: ClusterKeywordEntry,
  cluster: Pick<ClusterSummary, 'locationState'>
): string {
  return kw.locationState ?? cluster.locationState ?? '-';
}
