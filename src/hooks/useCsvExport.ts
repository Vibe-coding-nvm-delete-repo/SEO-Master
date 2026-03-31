import { useCallback } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { GroupedCluster, Project, ClusterSummary, ProcessedRow, TokenSummary } from '../types';

interface UseCsvExportParams {
  results: ProcessedRow[] | null;
  clusterSummary: ClusterSummary[] | null;
  tokenSummary: TokenSummary[] | null;
  groupedClusters: GroupedCluster[];
  approvedGroups: GroupedCluster[];
  activeTab: string;
  activeProjectId: string | null;
  projects: Project[];
  blockedTokens: Set<string>;
  universalBlockedTokens: Set<string>;
  logAndToast: (action: any, details: string, count: number, toastMsg: string, toastType: any) => void;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadCSV(csv: string, filename: string) {
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

function downloadXlsx(workbook: XLSX.WorkBook, filename: string) {
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
}

function groupLabelsToString(group: GroupedCluster) {
  const labels = new Set<string>();
  group.clusters.forEach((cluster) => {
    if (Array.isArray(cluster.labelArr) && cluster.labelArr.length > 0) {
      cluster.labelArr.forEach((label) => labels.add(label));
    } else if (cluster.label) {
      labels.add(cluster.label);
    }
  });
  return Array.from(labels).sort((a, b) => a.localeCompare(b)).join('; ');
}

export function useCsvExport({
  results,
  clusterSummary,
  tokenSummary,
  groupedClusters,
  approvedGroups,
  activeTab,
  activeProjectId,
  projects,
  blockedTokens,
  universalBlockedTokens,
  logAndToast,
}: UseCsvExportParams) {
  const exportCSV = useCallback(() => {
    if (!results || !clusterSummary || !tokenSummary) return;

    const timestamp = Date.now();
    const appNamePart = 'seo-magic';
    const rawProjectName = activeProjectId ? projects.find((project) => project.id === activeProjectId)?.name : null;
    const slugifyFilePart = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const projectNamePart = slugifyFilePart(rawProjectName || 'project');
    const iso = new Date(timestamp).toISOString();
    const datePart = iso.slice(0, 10);

    if (activeTab === 'pages') {
      const csv = Papa.unparse({
        fields: ['Page Name', 'Len', 'Tokens', 'KWs', 'Vol.', 'KD', 'Rating', 'Label', 'City', 'State'],
        data: clusterSummary.map((row) => [
          row.pageName,
          row.pageNameLen,
          row.tokens,
          row.keywordCount,
          row.totalVolume,
          row.avgKd !== null ? row.avgKd : '',
          row.avgKwRating != null ? row.avgKwRating : '',
          row.label,
          row.locationCity || '',
          row.locationState || '',
        ]),
      });
      downloadCSV(csv, `${appNamePart}_${projectNamePart}_${activeTab}_export_${datePart}_${timestamp}.csv`);
      return;
    }

    const renderGroupedWorkbook = (groups: GroupedCluster[], filename: string) => {
      const rowsHeader = ['Group Name', 'Page Name', 'Len', 'Tokens', 'KWs', 'Vol.', 'KD', 'Rating', 'Label', 'City', 'State'];
      const rowsData: any[][] = [];
      groups.forEach((group) => {
        group.clusters.forEach((cluster) => {
          rowsData.push([
            group.groupName,
            cluster.pageName,
            cluster.pageNameLen,
            cluster.tokens,
            cluster.keywordCount,
            cluster.totalVolume,
            cluster.avgKd !== null ? cluster.avgKd : '',
            cluster.avgKwRating != null ? cluster.avgKwRating : '',
            cluster.label,
            cluster.locationCity || '',
            cluster.locationState || '',
          ]);
        });
      });

      const groupsHeader = ['Group Name', 'Page #', 'Summed KWs', 'Volume', 'Avg KD', 'Avg Rating', 'Labels'];
      const groupsData: any[][] = groups.map((group) => [
        group.groupName,
        group.clusters?.length ?? 0,
        group.keywordCount,
        group.totalVolume,
        group.avgKd !== null ? group.avgKd : '',
        group.avgKwRating != null ? group.avgKwRating : '',
        groupLabelsToString(group),
      ]);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([rowsHeader, ...rowsData]), 'Rows');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([groupsHeader, ...groupsData]), 'Unique Groups');
      downloadXlsx(workbook, filename);
    };

    if (activeTab === 'grouped') {
      renderGroupedWorkbook(groupedClusters, `${appNamePart}_${projectNamePart}_grouped_export_${datePart}_${timestamp}.xlsx`);
      return;
    }

    if (activeTab === 'approved') {
      renderGroupedWorkbook(approvedGroups, `${appNamePart}_${projectNamePart}_approved_export_${datePart}_${timestamp}.xlsx`);
    }
  }, [activeProjectId, activeTab, approvedGroups, clusterSummary, groupedClusters, projects, results, tokenSummary]);

  const exportTokensCSV = useCallback(() => {
    if (!tokenSummary || tokenSummary.length === 0) return;

    const csv = Papa.unparse({
      fields: ['Token', 'Vol.', 'Frequency', 'Avg KD', 'Length', 'Label', 'Labels', 'City', 'State', 'Blocked', 'Universal Blocked'],
      data: tokenSummary.map((token) => [
        token.token,
        token.totalVolume,
        token.frequency,
        token.avgKd !== null ? token.avgKd : '',
        token.length,
        token.label || '',
        token.labelArr.join(', '),
        token.locationCity || '',
        token.locationState || '',
        blockedTokens.has(token.token) ? 'Yes' : 'No',
        universalBlockedTokens.has(token.token) ? 'Yes' : 'No',
      ]),
    });

    downloadCSV(csv, `token-management_${Date.now()}.csv`);
    logAndToast(
      'export',
      `Exported ${tokenSummary.length} tokens from token management`,
      tokenSummary.length,
      `Exported ${tokenSummary.length} tokens`,
      'success',
    );
  }, [blockedTokens, logAndToast, tokenSummary, universalBlockedTokens]);

  return { exportCSV, exportTokensCSV };
}
