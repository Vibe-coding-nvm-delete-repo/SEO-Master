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
  /** LLM keyword relevance: 1 = relevant, 2 = unsure, 3 = not relevant (optional until rated) */
  kwRating?: 1 | 2 | 3 | null;
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
  /** Average keyword relevance rating (1–3) over keywords that have a rating; omitted/null if none */
  avgKwRating?: number | null;
  label: string;
  labelArr: string[];
  locationCity: string | null;
  locationState: string | null;
  keywords: { keyword: string; volume: number, kd: number | null, locationCity: string | null, locationState: string | null; kwRating?: 1 | 2 | 3 | null }[];
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
  /** Weighted average of member clusters' avgKwRating (1–3); omitted/null if none */
  avgKwRating?: number | null;
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
  /** From results when available (e.g. token-block rows) */
  kwRating?: 1 | 2 | 3 | null;
  reason: string;
  tokenArr?: string[];
}

export interface LabelSection {
  id: string;
  name: string;
  tokens: string[];
  colorIndex: number;
}

/** User-created folder on the Projects tab (not the same as filesystem folders). */
export interface ProjectFolder {
  id: string;
  name: string;
  /** Sort order (lower first). */
  order: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  uid: string;
  fileName?: string;
  /** When set, project appears inside this folder on the Projects tab. */
  folderId?: string | null;
  /** ISO timestamp — when set, project is in the deleted list (data retained until permanent delete). */
  deletedAt?: string | null;
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

export type AutoGroupSuggestionSource =
  | 'llm-v1'
  | 'v1-singleton'
  | 'cosine'
  | 'cosine-singleton'
  | 'two-token-llm'
  | 'two-token-standalone'
  | 'single-token';

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
  source?: AutoGroupSuggestionSource;
  assignmentConfidence?: number;
  assignmentReason?: string;
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
  source?: 'manual' | 'auto-merge';
  recommendationId?: string;
}

export interface AutoMergeRecommendation {
  id: string;
  sourceToken: string;
  canonicalToken: string;
  mergeTokens: string[];
  confidence: number;
  reason: string;
  affectedKeywordCount: number;
  affectedPageCount: number;
  affectedKeywords: string[];
  status: 'pending' | 'approved' | 'declined';
  createdAt: string;
  reviewedAt?: string;
}

export interface GroupMergeRecommendationGroup {
  id: string;
  name: string;
  pageCount: number;
  totalVolume: number;
  locationSummary: string;
}

export interface GroupMergeRecommendation {
  id: string;
  sourceFingerprint: string;
  groupA: GroupMergeRecommendationGroup;
  groupB: GroupMergeRecommendationGroup;
  similarity: number;
  exactNameMatch: boolean;
  sharedPageNameCount: number;
  locationCompatible: boolean;
  status: 'pending' | 'dismissed' | 'accepted';
  createdAt: string;
  reviewedAt?: string;
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

/** User-submitted product feedback (issues / features). Stored in Firestore + IndexedDB. */
export interface FeedbackEntry {
  id: string;
  kind: 'issue' | 'feature';
  body: string;
  /** Lower = higher priority (listed first). */
  priority: number;
  createdAt: string;
  authorEmail: string | null;
  /** Normalized tags (e.g. csv-import, mobile). */
  tags: string[];
  /** Issue: 1–4 severity (disruption). Null on legacy docs. */
  issueSeverity: 1 | 2 | 3 | 4 | null;
  /** Feature: 1–4 impact / importance. Null on legacy docs. */
  featureImpact: 1 | 2 | 3 | 4 | null;
  /** Up to 3 screenshot URLs (Firebase Storage). */
  attachmentUrls?: string[];
}
