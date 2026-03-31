import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterRow from './ClusterRow';
import type { ClusterSummary } from './types';

describe('ClusterRow', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(),
      },
    });
  });

  it('passes row tokens and checked state to onSelect', () => {
    const onSelect = vi.fn();
    const row: ClusterSummary = {
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
    };

    render(
      <table>
        <tbody>
          <ClusterRow
            row={row}
            isExpanded={false}
            isSelected={false}
            selectedTokens={new Set()}
            toggleCluster={vi.fn()}
            onSelect={onSelect}
            setSelectedTokens={vi.fn()}
            setCurrentPage={vi.fn()}
            onMiddleClick={vi.fn()}
            labelColorMap={new Map()}
          />
        </tbody>
      </table>,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onSelect).toHaveBeenCalledWith('alpha beta', true);
  });
});
