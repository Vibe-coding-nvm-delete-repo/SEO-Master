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

export interface Stats {
  original: number;
  valid: number;
  clusters: number;
  tokens: number;
  totalVolume: number;
}
