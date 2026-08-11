import React from 'react';

export interface TokenChipLabelColor {
  border: string;
  sectionName: string;
}

interface TokenChipProps {
  token: string;
  isSelected: boolean;
  labelColor?: TokenChipLabelColor | null;
  onClick: (e: React.MouseEvent, token: string) => void;
}

const TokenChip = React.memo(({ token, isSelected, labelColor, onClick }: TokenChipProps) => (
  <button
    onClick={(e) => onClick(e, token)}
    className={`${isSelected ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
    style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
    title={labelColor ? `${labelColor.sectionName} · Ctrl+click to block` : 'Ctrl+click to block'}
  >
    {token}
  </button>
));

TokenChip.displayName = 'TokenChip';
export default TokenChip;
