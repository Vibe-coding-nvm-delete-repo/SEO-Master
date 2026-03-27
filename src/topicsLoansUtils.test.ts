import { describe, expect, it } from 'vitest';
import {
  buildDefaultRows,
  resolveLoanTopicsRows,
  type LoanTopicRow,
  type SeedLoanTopicLeadRow,
} from './topicsLoansUtils';

const tinySeed: SeedLoanTopicLeadRow[] = [
  { subtopic: 'Installment loans', rank: 3, leadIntent: 'Medium', rationale: 'One row for installment.' },
  { subtopic: 'Business loans', rank: 2, leadIntent: 'Low', rationale: 'One row for business.' },
];

const SCHEMA = 3;

describe('resolveLoanTopicsRows', () => {
  it('keeps existing rows when stored version matches schema and rows are non-empty', () => {
    const existing = buildDefaultRows(tinySeed);
    const out = resolveLoanTopicsRows(existing, SCHEMA, tinySeed, SCHEMA);
    expect(out).toBe(existing);
    expect(out).toHaveLength(2);
  });

  it('replaces with seed defaults when stored version is missing or mismatched', () => {
    const existing = buildDefaultRows(tinySeed);
    const outOld = resolveLoanTopicsRows(existing, undefined, tinySeed, SCHEMA);
    expect(outOld).not.toBe(existing);
    expect(outOld.map((r) => r.subtopic)).toEqual(['Installment loans', 'Business loans']);

    const outMismatch = resolveLoanTopicsRows(existing, SCHEMA - 1, tinySeed, SCHEMA);
    expect(outMismatch).not.toBe(existing);
    expect(outMismatch).toHaveLength(2);
  });

  it('replaces when existing is empty or null (migration / first run)', () => {
    const outNull = resolveLoanTopicsRows(null, SCHEMA, tinySeed, SCHEMA);
    expect(outNull).toHaveLength(2);

    const outEmpty = resolveLoanTopicsRows([], SCHEMA, tinySeed, SCHEMA);
    expect(outEmpty).toHaveLength(2);
  });

  it('drops legacy duplicate subtopics by rebuilding from canonical seed only', () => {
    const dupes: LoanTopicRow[] = [
      ...buildDefaultRows([tinySeed[0]!]),
      {
        ...buildDefaultRows([tinySeed[0]!])[0]!,
        id: 'loan_topic_installment_loans_alt',
        subtopic: 'Installment loans online',
      },
    ];
    const out = resolveLoanTopicsRows(dupes, SCHEMA - 1, tinySeed, SCHEMA);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((r) => r.subtopic)).size).toBe(2);
  });
});
