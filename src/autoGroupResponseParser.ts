import type { ClusterSummary } from './types';

export function escapeJsonFromModelResponse(content: string): string | null {
  const trimmed = content.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : null;
}

export function parseFilteredAutoGroupResponse(
  content: string,
  pages: ClusterSummary[]
): ClusterSummary[][] {
  const json = escapeJsonFromModelResponse(content);
  if (!json) return [];

  const idToPage = new Map<string, ClusterSummary>(pages.map((page, idx) => [`P${idx + 1}`, page]));
  const nameToPages = new Map<string, ClusterSummary[]>();
  for (const page of pages) {
    const key = page.pageName.trim().toLowerCase();
    const existing = nameToPages.get(key);
    if (existing) existing.push(page);
    else nameToPages.set(key, [page]);
  }

  const consumed = new Set<string>();
  const resolvedGroups: ClusterSummary[][] = [];

  const takePageByRef = (pageRef: unknown): ClusterSummary | null => {
    const pageKey = String(pageRef ?? '').trim();
    if (!pageKey) return null;
    const byId = idToPage.get(pageKey);
    if (byId && !consumed.has(byId.tokens)) return byId;
    const candidates = nameToPages.get(pageKey.toLowerCase()) || [];
    return candidates.find(candidate => !consumed.has(candidate.tokens)) || null;
  };

  const parsed = JSON.parse(json) as {
    groups?: Array<{ pageIds?: string[]; pages?: string[]; pageNames?: string[]; page_names?: string[] }>;
    assignments?: Array<{
      pageId?: string;
      page?: string;
      targetGroupName?: string;
      groupName?: string;
    }>;
  };

  if (!Array.isArray(parsed.groups) && !Array.isArray(parsed.assignments)) return [];

  if (Array.isArray(parsed.groups)) {
    for (const group of parsed.groups) {
      let resolvedPages: ClusterSummary[] = [];

      if (Array.isArray(group.pageIds) && group.pageIds.length > 0) {
        resolvedPages = group.pageIds
          .map(pageId => takePageByRef(pageId))
          .filter((page): page is ClusterSummary => !!page);
      } else {
        const refs = Array.isArray(group.pages) && group.pages.length > 0
          ? group.pages
          : Array.isArray(group.pageNames) && group.pageNames.length > 0
            ? group.pageNames
            : Array.isArray(group.page_names) && group.page_names.length > 0
              ? group.page_names
              : [];
        for (const pageName of refs) {
          const nextPage = takePageByRef(pageName);
          if (nextPage) resolvedPages.push(nextPage);
        }
      }

      const dedupedPages = resolvedPages.filter(page => {
        if (consumed.has(page.tokens)) return false;
        consumed.add(page.tokens);
        return true;
      });

      if (dedupedPages.length > 0) resolvedGroups.push(dedupedPages);
    }
  }

  if (resolvedGroups.length === 0 && Array.isArray(parsed.assignments)) {
    const groupedAssignments = new Map<string, ClusterSummary[]>();
    for (const assignment of parsed.assignments) {
      const page = takePageByRef(assignment.pageId || assignment.page);
      if (!page) continue;
      const rawTarget = String(assignment.targetGroupName || assignment.groupName || page.pageName).trim();
      const key = rawTarget.toLowerCase();
      const existing = groupedAssignments.get(key) || [];
      existing.push(page);
      groupedAssignments.set(key, existing);
      consumed.add(page.tokens);
    }
    for (const groupPages of groupedAssignments.values()) {
      if (groupPages.length > 0) resolvedGroups.push(groupPages);
    }
  }

  return resolvedGroups;
}
