import React from 'react';
import { Lightbulb } from 'lucide-react';

/** Read-only backlog: brainstorm + template. Not persisted. */
const FeatureIdeasTab: React.FC = () => {
  const ideas: {
    rank: number;
    title: string;
    area: string;
    why: string;
  }[] = [
    {
      rank: 1,
      title: 'Undo / redo for grouping and approvals',
      area: 'Group (tables, approve/ungroup), persistence',
      why: 'High-impact actions need a safety net when AI or bulk selection is wrong.',
    },
    {
      rank: 2,
      title: 'Prompt template manager (per project)',
      area: 'Generate, Group Review / Settings',
      why: 'Different niches need different prompt styles; reuse beats one-off tweaks.',
    },
    {
      rank: 3,
      title: 'Explainability / trace for AI suggestions',
      area: 'Auto-group, Group Review, grouped views',
      why: 'Trust increases when users see why a group was suggested (overlap, rules, scores).',
    },
    {
      rank: 4,
      title: 'Run history with cancel, resume, and durable progress',
      area: 'Generate tab, job queue, IDB + Firestore',
      why: 'Long runs should survive refresh and be retryable without duplicate work.',
    },
    {
      rank: 5,
      title: 'Rule-based auto-approval',
      area: 'Group (approved workflow), Settings',
      why: 'Repeatable criteria should not require the same clicks every session.',
    },
    {
      rank: 6,
      title: 'Model A/B compare for generated output',
      area: 'Generate tab, storage of multiple variants',
      why: 'Side-by-side comparison speeds picking the best draft.',
    },
    {
      rank: 7,
      title: 'Dictionary rule builder with live preview / test harness',
      area: 'Settings → Dictionaries, matching pipeline',
      why: 'Validate rules on sample keywords before they hit the full dataset.',
    },
    {
      rank: 8,
      title: 'Quality linter + SEO heuristics on generated content',
      area: 'Generate pipeline, results summary',
      why: 'Catch thin or off-topic sections before human review.',
    },
    {
      rank: 9,
      title: 'Project import / export as a portable package',
      area: 'Projects, projectStorage, collaboration',
      why: 'Move work between environments and share with teammates.',
    },
    {
      rank: 10,
      title: 'Bulk edit for keywords / labels (power-user)',
      area: 'Data tables, filters, blocklist / dictionaries',
      why: 'Manual cleanup is faster with search/replace and batch tagging.',
    },
    {
      rank: 11,
      title: 'CSV pipeline: keyword relevance check (good / unsure / bad)',
      area: 'Import / CSV processing, data quality gates',
      why: 'Automatic checks during CSV processing, on top of the existing initial pass. Each keyword gets a relevance label; anything marked bad is blocked immediately so off-topic rows never enter the workspace.',
    },
    {
      rank: 12,
      title: 'Token merge pass (lexical + semantic dedupe to higher volume)',
      area: 'CSV / token management, keyword grouping',
      why: 'Compare every token against all others; when two or more are lexically or semantically the same, merge them into the single token with the higher volume. Consolidates tokens and keywords so downstream KW management and grouping see fewer duplicates and more keywords can group when they share identical token sets after the merge.',
    },
    {
      rank: 13,
      title: 'Token tiers (broad / unsure / unique) + one-click merge of all unique',
      area: 'Token management, Auto-group, Grouped tab',
      why: 'Flag each token as broad, unsure, or unique—unique means low likelihood of useful synonyms. A button next to token management runs through unique tokens one by one and queues each token’s keywords for auto-merge; resulting groups appear on the Grouped tab.',
    },
    {
      rank: 14,
      title: 'Unique-token priority score (1–4, custom prompt)',
      area: 'Token management, LLM / prompts',
      why: 'For tokens flagged unique, rank how uniquely specific they are on a 1–4 scale using a custom prompt so users can prioritize which edge cases deserve attention first.',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-50 border border-amber-100">
            <Lightbulb className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Feature ideas</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Read-only backlog and template for future product direction. Nothing here is saved to your project or cloud.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6">
        <h3 className="text-sm font-semibold text-zinc-800 mb-3">Template (for future editable ideas)</h3>
        <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 p-4 text-xs text-zinc-600 space-y-2">
          <p><span className="font-medium text-zinc-700">Title:</span> —</p>
          <p><span className="font-medium text-zinc-700">Area:</span> Group / Generate / Settings / Feedback / Infra</p>
          <p><span className="font-medium text-zinc-700">Problem:</span> —</p>
          <p><span className="font-medium text-zinc-700">Why now:</span> —</p>
          <p><span className="font-medium text-zinc-700">Risks / open questions:</span> —</p>
          <p><span className="font-medium text-zinc-700">Status:</span> Idea / Planned / In progress / Shipped</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-zinc-800 mb-3">Backlog (ordered)</h3>
        <ul className="space-y-3">
          {ideas.map((item) => (
            <li
              key={item.rank}
              className="bg-white border border-zinc-200 rounded-xl shadow-sm p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2 mb-1">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                  #{item.rank}
                </span>
                <span className="text-sm font-semibold text-zinc-900">{item.title}</span>
              </div>
              <p className="text-[11px] text-zinc-500 mb-2">
                <span className="font-medium text-zinc-600">Impacts:</span> {item.area}
              </p>
              <p className="text-sm text-zinc-600 leading-relaxed">{item.why}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default FeatureIdeasTab;
