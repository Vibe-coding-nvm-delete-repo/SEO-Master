type OutputLike = {
  status?: string;
  output?: string;
};

export function cleanGeneratedContent(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const answerMatch = trimmed.match(/^<answer>\s*([\s\S]*?)\s*<\/answer>$/i);
  return (answerMatch ? answerMatch[1] : trimmed).trim();
}

export function hasMeaningfulContent(value: unknown): boolean {
  return cleanGeneratedContent(value).length > 0;
}

export function hasGeneratedPrimaryOutput(row: OutputLike | undefined): boolean {
  return row?.status === 'generated' && hasMeaningfulContent(row.output);
}

export function hasGeneratedSlotOutput(slot: OutputLike | undefined): boolean {
  return slot?.status === 'generated' && hasMeaningfulContent(slot.output);
}
