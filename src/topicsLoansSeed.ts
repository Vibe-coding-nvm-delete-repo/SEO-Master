/**
 * Canonical loan topics for Group > Topics > Loans.
 * One row per loan category; long-tail and intent variants belong in seed keyword columns, not duplicate rows.
 */
import type { SeedLoanTopicLeadRow } from './topicsLoansUtils';

/** Bump when the canonical topic list changes so clients migrate to the new default set. */
export const LOAN_TOPICS_SCHEMA_VERSION = 3;

export const CANONICAL_LOAN_TOPICS_SEED: SeedLoanTopicLeadRow[] = [
  // Consumer — general
  { subtopic: 'Personal loans', rank: 3, leadIntent: 'Medium', rationale: 'Broad unsecured consumer borrowing; capture all personal-loan intent in one topic.' },
  { subtopic: 'Installment loans', rank: 3, leadIntent: 'Medium', rationale: 'Fixed-payment installment products; single umbrella for all installment intent.' },
  { subtopic: 'Lines of credit', rank: 3, leadIntent: 'Medium', rationale: 'Revolving credit lines (personal LOC, etc.); distinct from term loans.' },
  { subtopic: 'Payday loans', rank: 4, leadIntent: 'High', rationale: 'High subprime overlap and urgent cash intent.' },
  { subtopic: 'Short-term loans', rank: 3, leadIntent: 'Medium', rationale: 'Short duration borrowing as its own product class.' },
  { subtopic: 'Title loans', rank: 4, leadIntent: 'High', rationale: 'Collateralized high-risk segment with strong credit-distress signal.' },
  { subtopic: 'Bad credit loans', rank: 4, leadIntent: 'High', rationale: 'Explicit credit-challenged borrower intent.' },
  { subtopic: 'Debt consolidation loans', rank: 4, leadIntent: 'High', rationale: 'Debt payoff and restructuring; strong repair-adjacent demand.' },
  { subtopic: 'Cash advance loans', rank: 4, leadIntent: 'High', rationale: 'Cash-flow urgency and alternative lending channels.' },
  { subtopic: 'Credit builder loans', rank: 4, leadIntent: 'High', rationale: 'Users actively improving credit profile.' },
  { subtopic: 'Emergency loans', rank: 4, leadIntent: 'High', rationale: 'Urgent need financing across channels.' },

  // Auto
  { subtopic: 'Auto loans', rank: 3, leadIntent: 'Medium', rationale: 'Vehicle purchase financing; one topic for new, used, dealer, and private party variants.' },
  { subtopic: 'Car refinance loans', rank: 3, leadIntent: 'Medium', rationale: 'Auto refi and rate/payment optimization in one bucket.' },

  // Housing / mortgage
  { subtopic: 'Mortgage loans', rank: 3, leadIntent: 'Medium', rationale: 'Home purchase and primary mortgage products as one category.' },
  { subtopic: 'Refinance loans', rank: 3, leadIntent: 'Medium', rationale: 'Rate and term refinance across mortgage and other secured debt.' },
  { subtopic: 'FHA loans', rank: 3, leadIntent: 'Medium', rationale: 'Government-insured purchase and refi programs.' },
  { subtopic: 'VA loans', rank: 3, leadIntent: 'Medium', rationale: 'Veteran-focused mortgage programs.' },
  { subtopic: 'USDA loans', rank: 3, leadIntent: 'Medium', rationale: 'Rural housing programs.' },
  { subtopic: 'Jumbo loans', rank: 2, leadIntent: 'Low', rationale: 'High-balance mortgage segment.' },
  { subtopic: 'Home equity loans', rank: 3, leadIntent: 'Medium', rationale: 'Closed-end second liens and home equity borrowing.' },
  { subtopic: 'HELOC loans', rank: 3, leadIntent: 'Medium', rationale: 'Revolving home equity lines.' },
  { subtopic: 'Cash-out refinance loans', rank: 3, leadIntent: 'Medium', rationale: 'Equity extraction via refinance.' },
  { subtopic: 'Bridge loans', rank: 2, leadIntent: 'Low', rationale: 'Short-term property bridge financing.' },
  { subtopic: 'Construction loans', rank: 2, leadIntent: 'Low', rationale: 'Build and renovation construction financing.' },
  { subtopic: 'Land loans', rank: 2, leadIntent: 'Low', rationale: 'Raw land and lot financing.' },
  { subtopic: 'Mobile home loans', rank: 3, leadIntent: 'Medium', rationale: 'Manufactured housing finance.' },

  // Student
  { subtopic: 'Student loans', rank: 3, leadIntent: 'Medium', rationale: 'Federal and private education debt in one topic; refi and consolidation in seeds.' },

  // Business
  { subtopic: 'Business loans', rank: 2, leadIntent: 'Low', rationale: 'General small-business term and operating credit.' },
  { subtopic: 'SBA loans', rank: 2, leadIntent: 'Low', rationale: 'SBA-guaranteed programs as a distinct channel.' },
  { subtopic: 'Equipment loans', rank: 2, leadIntent: 'Low', rationale: 'Equipment and asset-backed business borrowing.' },
  { subtopic: 'Working capital loans', rank: 2, leadIntent: 'Low', rationale: 'Short-term business liquidity and cash flow.' },
  { subtopic: 'Commercial real estate loans', rank: 1, leadIntent: 'Low', rationale: 'CRE term and investment property lending.' },

  // Specialty consumer
  { subtopic: 'Medical loans', rank: 3, leadIntent: 'Medium', rationale: 'Healthcare and medical expense financing.' },
  { subtopic: 'Dental loans', rank: 3, leadIntent: 'Medium', rationale: 'Dental care financing.' },
  { subtopic: 'Home improvement loans', rank: 3, leadIntent: 'Medium', rationale: 'Renovation and repair project financing.' },

  // Debt / distress
  { subtopic: 'Debt relief loans', rank: 4, leadIntent: 'High', rationale: 'Debt hardship and restructuring intent.' },
  { subtopic: 'Debt settlement loans', rank: 4, leadIntent: 'High', rationale: 'Settlement and negotiation-adjacent borrowing.' },

  // Recreational / other secured
  { subtopic: 'Boat loans', rank: 2, leadIntent: 'Low', rationale: 'Marine recreation financing.' },
  { subtopic: 'RV loans', rank: 2, leadIntent: 'Low', rationale: 'Recreational vehicle financing.' },
  { subtopic: 'Motorcycle loans', rank: 2, leadIntent: 'Low', rationale: 'Motorcycle and powersports financing.' },
  { subtopic: 'Pawn shop loans', rank: 3, leadIntent: 'Medium', rationale: 'Collateral pawn and short-term asset-backed cash.' },
];
