// types.ts — Shared TypeScript type definitions for the KWG application
// These types are used across App.tsx, test files, and other modules.

export interface ProcessedRow {
  pageName: string;
  pageNameLower: string;
  pageNameLen: number;
  tokens: string;
  tokenArr: string[];
  keyword: string;
  keywordLower: string;
  searchVolume: number;
  kd: number | null;
  label: string;
  labelArr: string[];
  locationCity: string | null;
  locationState: string | null;
  originalTokenArr?: string[];  // Pre-merge tokens, set on first merge for undo support
}

export interface Cluster {
  signature: string;
  pageName: string;
  pageNameLower: string;
  pageNameLen: number;
  maxVolume: number;
  locationCity: string | null;
  locationState: string | null;
  rows: { keyword: string; keywordLower: string; volume: number, kd: number | null, locationCity: string | null, locationState: string | null }[];
}

export interface ClusterSummary {
  pageName: string;
  pageNameLower: string;
  pageNameLen: number;
  tokens: string;
  tokenArr: string[];
  keywordCount: number;
  totalVolume: number;
  avgKd: number | null;
  label: string;
  labelArr: string[];
  locationCity: string | null;
  locationState: string | null;
  keywords: { keyword: string; volume: number, kd: number | null, locationCity: string | null, locationState: string | null }[];
}

export interface TokenSummary {
  token: string;
  length: number;
  frequency: number;
  totalVolume: number;
  avgKd: number | null;
  label: string;
  labelArr: string[];
  locationCity: string;
  locationState: string;
}

export interface GroupedCluster {
  id: string;
  groupName: string;
  clusters: ClusterSummary[];
  totalVolume: number;
  keywordCount: number;
  avgKd: number | null;
  // AI semantic review fields (auto-populated when group is created)
  reviewStatus?: 'pending' | 'reviewing' | 'approve' | 'mismatch' | 'error';
  reviewMismatchedPages?: string[];
  reviewReason?: string;
  reviewCost?: number;
  reviewedAt?: string;
  mergeAffected?: boolean;  // Set when token merge auto-unapproves this group
}

export interface BlockedKeyword {
  keyword: string;
  volume: number;
  kd: number | null;
  reason: string;
  tokenArr?: string[];
}

export interface LabelSection {
  id: string;
  name: string;
  tokens: string[];
  colorIndex: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  uid: string;
  fileName?: string;
}

// Activity log types
export type ActivityAction = 'group' | 'ungroup' | 'approve' | 'unapprove' | 'block' | 'unblock' | 'qa-review' | 'remove-approved' | 'merge' | 'unmerge' | 'auto-group';

// Auto-group types
export interface AutoGroupCluster {
  id: string;
  sharedTokens: string[];
  pages: ClusterSummary[];
  totalVolume: number;
  keywordCount: number;
  avgKd: number | null;
  pageCount: number;
  confidence: 'high' | 'medium' | 'review';
  isIdentical: boolean;  // true if all pages have 100% token overlap
  stage: number;         // token overlap stage (e.g., 6 = 6 shared tokens, 2 = 2 shared tokens)
}

export interface ReconciliationCandidate {
  id: string;
  groupA: { name: string; idx: number; volume: number; pages: number };
  groupB: { name: string; idx: number; volume: number; pages: number };
  confidence: number;
  reason: string;
  merged?: boolean;
  dismissed?: boolean;
}

export interface AutoGroupSuggestion {
  id: string;
  sourceClusterId: string;
  groupName: string;
  pages: ClusterSummary[];
  totalVolume: number;
  keywordCount: number;
  avgKd: number | null;
  status: 'pending' | 'processing' | 'approved' | 'mismatch' | 'error' | 'manual-review';
  retryCount: number;
  stage?: number;  // which cascade stage produced this group
  reviewReason?: string;
  reviewMismatchedPages?: string[];
  reviewCost?: number;
  qaStatus?: 'approve' | 'mismatch' | 'error';
  qaMismatchedPages?: string[];
}

export interface TokenMergeRule {
  id: string;
  parentToken: string;
  childTokens: string[];
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;  // ISO 8601
  action: ActivityAction;
  details: string;
  count: number;
}

export interface Stats {
  original: number;
  valid: number;
  clusters: number;
  tokens: number;
  totalVolume: number;
}
