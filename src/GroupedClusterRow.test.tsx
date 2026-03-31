import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GroupedClusterRow from './GroupedClusterRow';
import type { GroupedCluster } from './types';

describe('GroupedClusterRow', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(),
      },
    });
  });

  it('passes group id, clusters, and checked state to onGroupSelect', () => {
    const onGroupSelect = vi.fn();
    const row: GroupedCluster = {
      id: 'group-1',
      groupName: 'Alpha Group',
      clusters: [
        {
          pageName: 'Alpha Page',
          pageNameLower: 'alpha page',
          pageNameLen: 10,
          tokens: 'alpha beta',
          tokenArr: ['alpha', 'beta'],
          keywordCount: 1,
          totalVolume: 100,
          avgKd: 12,
          avgKwRating: 2,
          label: '',
          labelArr: [],
          locationCity: '',
          locationState: '',
          keywords: [],
        },
      ],
      keywordCount: 1,
      totalVolume: 100,
      avgKd: 12,
      avgKwRating: 2,
    };

    render(
      <table>
        <tbody>
          <GroupedClusterRow
            row={row}
            isExpanded={false}
            expandedSubClusters={new Set()}
            toggleGroup={vi.fn()}
            toggleSubCluster={vi.fn()}
            selectedTokens={new Set()}
            setSelectedTokens={vi.fn()}
            setCurrentPage={vi.fn()}
            isGroupSelected={false}
            selectedSubClusters={new Set()}
            onGroupSelect={onGroupSelect}
            onSubClusterSelect={vi.fn()}
            labelColorMap={new Map()}
          />
        </tbody>
      </table>,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onGroupSelect).toHaveBeenCalledWith('group-1', row.clusters, true);
  });
});
