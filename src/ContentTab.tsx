import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { GenerateTabInstance, PromptSlotConfig, ExternalViewTab } from './GenerateTab';
import { BookOpenText, Code2, FileCode2, FileText, Heading, Layers3, MessageSquareQuote, NotebookPen, OctagonAlert, PanelTop, ScrollText, Sparkles } from 'lucide-react';
import ContentOverviewPanel from './ContentOverviewPanel';
import FinalPagesPanel from './FinalPagesPanel';
import { useToast } from './ToastContext';
import { makeAppSettingsChannel } from './cloudSyncStatus';
import {
  UPSTREAM_PAGE_NAMES_DOC_ID,
  H2_CONTENT_ROWS_DOC_ID,
  H2_RATING_ROWS_DOC_ID,
  H2_PIPELINE_SETTINGS_DOC_ID,
  buildH2ContentRowsFromFirestore,
  formatH2ListForQa,
  formatH2QaFlags,
  parseH2ItemsFromOutput,
  parseH2QaJsonOutput,
  parseStrictPageGuidelinesJsonOutput,
  parseStrictH2NamesJsonOutput,
} from './contentPipelineH2';
import {
  H2_RATING_SETTINGS_DOC_ID,
  loadPersistedRatingRowsFromFirestore,
  buildRatingRowsFromFirestore,
  parseRatingModelOutput,
} from './contentPipelineRating';
import {
  H2_HTML_LOCK_REASON_KEY,
  H2_HTML_SETTINGS_DOC_ID,
  H2_HTML_VALIDATION_STATUS_KEY,
  buildH2HtmlRowsFromFirestore,
  loadH2ContentRowsFromFirestore,
  validateGeneratedHtmlOutput,
} from './contentPipelineHtml';
import {
  H1_HTML_SETTINGS_DOC_ID,
  buildH1HtmlRowsFromFirestore,
} from './contentPipelineH1Html';
import {
  QUICK_ANSWER_HTML_ROWS_DOC_ID,
  QUICK_ANSWER_HTML_SETTINGS_DOC_ID,
  buildQuickAnswerHtmlRowsFromFirestore,
} from './contentPipelineQuickAnswerHtml';
import {
  METAS_SLUG_CTAS_ROWS_DOC_ID,
  METAS_SLUG_CTAS_SETTINGS_DOC_ID,
  buildCtaPrompt,
  buildMetasSlugCtasRowsFromFirestore,
  buildSlugPrompt,
  parseCtaJsonOutput,
} from './contentPipelineMetasSlugCtas';
import {
  TIPS_REDFLAGS_SETTINGS_DOC_ID,
  buildKeyTakeawaysPrompt,
  buildRedFlagPrompt,
  buildTipsRedflagsRowsFromFirestore,
} from './contentPipelineTipsRedflags';
import {
  QUICK_ANSWER_ROWS_DOC_ID,
  QUICK_ANSWER_SETTINGS_DOC_ID,
  buildQuickAnswerRowsFromFirestore,
} from './contentPipelineQuickAnswer';
import {
  H2_SUMMARY_SETTINGS_DOC_ID,
  H2_SUMMARY_ROWS_DOC_ID,
  buildH2SummaryRowsFromFirestore,
} from './contentPipelineSummary';
import {
  H1_BODY_ROWS_DOC_ID,
  H1_BODY_SETTINGS_DOC_ID,
  buildH1BodyRowsFromFirestore,
} from './contentPipelineH1';
import {
  buildContentHistoryState,
  buildContentSearchForRoute,
  getDefaultContentRoute,
  mapContentSubtabToViewState,
  mapOverviewStageIdToContentSubtab,
  mapViewStateToContentSubtab,
  parseContentRouteFromSearch,
  type ContentPanelId,
  type ContentRouteState,
  type ContentSubtabId,
} from './contentSubtabRouting';
import type { ContentPipelineLoadMode } from './contentPipelineLoaders';
import { H1_BODY_EXTRA_COLUMNS, H1_HTML_EXTRA_COLUMNS, H2_CONTENT_EXTRA_COLUMNS, H2_RATING_EXTRA_COLUMNS, H2_SUMMARY_EXTRA_COLUMNS, METAS_SLUG_CTAS_EXTRA_COLUMNS, PAGE_NAMES_EXTRA_COLUMNS, QUICK_ANSWER_EXTRA_COLUMNS, QUICK_ANSWER_HTML_EXTRA_COLUMNS, TIPS_REDFLAGS_EXTRA_COLUMNS } from './generateTablePresets';
import { subscribeAppSettingsDoc, writeAppSettingsRowsRemote } from './appSettingsPersistence';
import { ensureProjectGenerateWorkspace, resolveGenerateScopedDocIds } from './generateWorkspaceScope';

// ============ Default Prompts ============

const PAGE_NAMES_DEFAULT_PROMPT = `Write a single grammatically correct and easy to understand short blog title (output only the title, nothing else) that's under 60 characters, succinct, engaging, helpful, and conversational/easy-to-read/sensible. Make sure the title is 'proper' style grammar (each word's first letter is capitalized). Make it stand out almost like a Reddit title (without being clickbaity; we still need to appear trustworthy and reliable).

The title must:
- Focus on one clear idea or question (no multiple ideas or clauses).
- Stay neutral and authoritative but engaging.
- Be memorable and engaging by using creative, conversational wording.
- Make sure it's in question format in general to ensure it's super clear and resonates with the core intent of the keyword that user typed into Google (in order to find our article/page title).
- Include all key semantic tokens from the keyword phrase and all other meaningful variations.
- Front-load the main intent so it's easy to read.
- Use techniques like (but not limited to) Bold Promise, Myth-Busting, Curiosity Gap, or Relatable Pain Point.
- Follow proper grammar but be casual if needed to improve CTR of our page title to entice users to click it.
- Ensure any abbreviations are spelled out as well so it's super clear what it means and there's absolutely never any confusion or ambiguity.
- Avoid using ':' at all costs!
- Ignore any PDF keywords and don't use PDF in the title in any way.

The title must fully represent the reader's intent and address the core semantic purpose of the keyword phrase and every other meaningful semantic variation. Use search results to inform user behavior and content.

Output only the title, nothing else.`;
export const PAGE_GUIDELINES_DEFAULT_PROMPT_V2 = `Task: You are an expert content strategist. Analyze all H2 headings for this article and produce a single, unified content guideline that ensures all H2 sections remain internally consistent, non-contradictory, and visually varied.

Inputs:
- Main Article Topic: {PAGE_NAME}
- H2 Headings (exact, ordered): {H2_NAMES}

Instructions:

Part 1 - Consistency Guidelines (1-2 paragraphs):
Analyze all H2 headings as a complete set and write 1-2 paragraphs that establish:
   - Required terminology consistency
   - Sequencing logic
   - Claim boundaries
   - Data alignment

Part 2 - Formatting Framework:
Add formatting guidance for each H2 based on what best serves that section. Prioritize visual variety and avoid consecutive sections using identical structures unless the content truly calls for it.

Allowed structure patterns include:
   - 1-3 short paragraphs
   - Single paragraph + bullet list
   - Paragraph + numbered steps
   - Bullet list only (3-7 items)
   - Numbered steps only
   - Definition paragraph + examples paragraph
   - Comparison written as prose
   - Paragraph + bullet list + closing paragraph

Hard Constraints (all H2s):
   - Maximum 3 paragraphs OR 2 paragraphs + 1 list per H2
   - Maximum 250 words per H2
   - No nested bullets
   - Never recommend tables, comparison tables, tabular layouts, rows/columns, charts, or any other table-style format
   - If the content needs comparison or structured detail, express it with paragraphs, bullets, or numbered steps instead

Tone: Neutral, objective. No legal advice.

Critical output rule:
Return ONLY one valid JSON object with exactly one top-level key: "guidelines".

Return exactly this structure:
{
  "guidelines": [
    {
      "h2": "exact H2 name as provided",
      "guidelines": "1-2 brief sentences of universal content guidelines that apply to all H2 sections",
      "formatting": "formatting structure description for this H2 only"
    }
  ]
}

JSON rules:
- The object must contain exactly one key: "guidelines"
- "guidelines" must be an array
- The array must contain one item for every H2 provided
- Each item must contain exactly the keys "h2", "guidelines", and "formatting"
- "h2" must match the exact provided H2 text in the same order
- "guidelines" must be a non-empty string
- "formatting" must be a non-empty string
- "formatting" must never recommend tables, tabular layouts, rows/columns, charts, or any table-style presentation
- No markdown fences
- No commentary before or after the JSON
- No extra keys`;

export const PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT = `Deterministic Page Guide JSON contract:

- The model must return one JSON object with exactly one top-level key: "guidelines"
- "guidelines" must be an array with one entry for every H2 in the exact same order
- Each item must contain exactly:
  - "h2": exact H2 name
  - "guidelines": non-empty string
  - "formatting": non-empty string that must not recommend tables, tabular layouts, rows/columns, charts, or any table-style format
- H2 names must be unique
- No markdown fences, prose, wrapper text, or extra keys are allowed`;

const H2_NAMES_DEFAULT_PROMPT = `You are generating H2 names for a blog article.

Article title: {PAGE_NAME}
Keyword variants: {KEYWORD_VARIANTS}

Task:
Generate 7-11 H2 names for this article.

Quality rules:
- Every H2 must be clearly relevant to the article title.
- Every H2 must cover a distinct angle with no overlap in meaning or likely answer.
- Keep each H2 at 12 words or fewer.
- Make each H2 easy to understand immediately at a glance.
- Prefer natural, conversational phrasing.
- Use a mix of question-based, action-based, comparison, scenario, and list-style H2s when appropriate.
- Do not include anything about PDFs or downloads.
- Avoid colons unless absolutely necessary.
- Do not add any intro, outro, rationale, notes, cross-check, or explanation.

Critical output rule:
Your response is parsed automatically. Return ONLY one valid JSON object. If you add any text before or after the JSON object, the system breaks.

Return exactly this structure:
{
  "h2s": [
    { "order": 1, "h2": "first h2 name" },
    { "order": 2, "h2": "second h2 name" }
  ]
}

JSON rules:
- Return ONLY one valid JSON object
- No markdown fences
- No bullets
- No commentary
- No trailing commas
- Use double quotes for all keys and string values
- The root object must contain exactly one key: "h2s"
- Each item in "h2s" must contain exactly two keys: "order" and "h2"
- "order" must start at 1 and increase by 1 for each item
- "h2" must contain only the H2 text

Before finalizing internally, verify that:
- the JSON object is valid
- every H2 is unique
- every H2 is distinct in meaning
- every H2 is concise and reader-friendly

Return ONLY the JSON object.`;

const H2_NAMES_VALIDATOR_DEFAULT_CONTRACT = `Deterministic H2 JSON contract:

- The model must return one JSON object with exactly one top-level key: "h2s"
- "h2s" must be an array with 7 to 11 items
- Each item must contain exactly:
  - "order": positive integer
  - "h2": non-empty string
- Orders must start at 1 and increase by 1 with no gaps
- Normalized H2 text must be unique across the array
- No markdown fences, prose, bullets, wrapper text, or extra keys are allowed`;

const H2_QA_DEFAULT_PROMPT = `Evaluate the following H2s for the keyword phrase "{KEYWORD_PHRASE}".

Supporting page title: {PAGE_NAME}

Rate the H2 set on a 1-4 scale using these rules:
- 1: all H2s are irrelevant to the keyword's core intent and not genuinely actionable or helpful
- 2: more than half of the H2s are irrelevant to the keyword's core intent and not genuinely actionable or helpful
- 3: one or more H2s are irrelevant to the keyword's core intent and not genuinely actionable or helpful
- 4: all H2s are relevant to the keyword's core intent and genuinely actionable or helpful

Be strict and critical. Focus on whether the H2s would help a reader who searched this keyword in Google because they want clear, useful answers for their situation.

H2 list:
{H2_LIST}

Return ONLY one valid JSON object with exactly this shape:
{
  "rating": 4,
  "flaggedH2s": []
}

JSON rules:
- rating must be an integer 1, 2, 3, or 4
- flaggedH2s must be an array
- if rating is 4, flaggedH2s must be empty
- if rating is 1, 2, or 3, flaggedH2s must contain one or more objects
- each flagged object must contain exactly:
  - "h2": the exact H2 text that is off-intent
  - "reason": one short sentence explaining why it is irrelevant or unhelpful
- no markdown fences
- no commentary before or after the JSON
- no extra keys`;

const H2_NAMES_SLOT: PromptSlotConfig = {
  id: 'h2names',
  label: 'H2s',
  promptLabel: 'H2 Names Template',
  defaultPrompt: H2_NAMES_DEFAULT_PROMPT,
  validatorLabel: 'H2 JSON Contract',
  defaultValidator: H2_NAMES_VALIDATOR_DEFAULT_CONTRACT,
  validatorDescription: 'Reference contract for the deterministic local H2 JSON validator. The slot must still satisfy the enforced schema below.',
  icon: <Heading className="w-3.5 h-3.5" />,
  responseFormat: 'json_object',
  clearMetadataKeysOnReset: ['h2JsonStatus'],
  buildInput: (template: string, pageNameOutput: string, _externalData?: Record<string, string[]>, rowInput?: string) => {
    if (!pageNameOutput.trim()) {
      return { input: '', error: 'page-name-missing' };
    }
    const filled = template
      .replace('{PAGE_NAME}', pageNameOutput.trim())
      .replace('{KEYWORD_VARIANTS}', (rowInput ?? '').trim());
    return { input: filled };
  },
  transformOutput: ({ rawOutput }) => {
    const parsed = parseStrictH2NamesJsonOutput(rawOutput);
    return {
      output: parsed.normalizedOutput,
      metadata: {
        h2JsonStatus: 'Pass',
      },
    };
  },
};

const H2_QA_SLOT: PromptSlotConfig = {
  id: 'h2qa',
  label: 'H2 QA',
  promptLabel: 'H2 QA Prompt',
  defaultPrompt: H2_QA_DEFAULT_PROMPT,
  icon: <Sparkles className="w-3.5 h-3.5" />,
  responseFormat: 'json_object',
  clearMetadataKeysOnReset: ['h2QaRating', 'h2QaFlags'],
  buildInput: (template: string, pageNameOutput: string, _externalData?: Record<string, string[]>, rowInput?: string, row?: Parameters<NonNullable<PromptSlotConfig['buildInput']>>[4]) => {
    const keywordPhrase = (rowInput ?? '').trim();
    const h2Output = row?.slots?.h2names?.output ?? '';
    const h2Items = parseH2ItemsFromOutput(h2Output);
    if (!keywordPhrase) {
      return { input: '', error: 'keyword-missing' };
    }
    if (!pageNameOutput.trim()) {
      return { input: '', error: 'page-name-missing' };
    }
    if (h2Items.length === 0) {
      return { input: '', error: 'h2-names-missing' };
    }
    return {
      input: template
        .replace(/\{KEYWORD_PHRASE\}/g, keywordPhrase)
        .replace(/\{PAGE_NAME\}/g, pageNameOutput.trim())
        .replace(/\{H2_LIST\}/g, formatH2ListForQa(h2Items)),
    };
  },
  transformOutput: ({ rawOutput }) => {
    const parsed = parseH2QaJsonOutput(rawOutput);
    return {
      output: parsed.normalizedOutput,
      metadata: {
        h2QaRating: String(parsed.json.rating),
        h2QaFlags: formatH2QaFlags(parsed.json.flaggedH2s),
      },
    };
  },
};

const PAGE_GUIDELINES_SLOT: PromptSlotConfig = {
  id: 'guidelines',
  label: 'Page Guide',
  promptLabel: 'Page Guidelines Template',
  defaultPrompt: PAGE_GUIDELINES_DEFAULT_PROMPT_V2,
  validatorLabel: 'Page Guide JSON Contract',
  defaultValidator: PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT,
  validatorDescription: 'Reference contract for the deterministic local Page Guide JSON validator. The slot must still satisfy the enforced schema below.',
  icon: <BookOpenText className="w-3.5 h-3.5" />,
  responseFormat: 'json_object',
  clearMetadataKeysOnReset: ['pageGuideJsonStatus'],
  buildInput: (template: string, pageNameOutput: string, externalData?: Record<string, string[]>) => {
    if (!pageNameOutput.trim()) {
      return { input: '', error: 'page-name-missing' };
    }
    const h2Names = externalData?.h2Names;
    if (!h2Names?.length) {
      return { input: '', error: 'h2-names-missing' };
    }
    const filled = template
      .replace('{PAGE_NAME}', pageNameOutput.trim())
      .replace('{H2_NAMES}', h2Names.join('\n- '));
    return { input: filled };
  },
  transformOutput: ({ rawOutput, row }) => {
    const expectedH2Names = parseH2ItemsFromOutput(row.slots?.h2names?.output ?? '').map((item) => item.h2Name);
    const parsed = parseStrictPageGuidelinesJsonOutput(rawOutput, expectedH2Names);
    return {
      output: parsed.normalizedOutput,
      metadata: {
        pageGuideJsonStatus: 'Pass',
      },
    };
  },
};

// ============ H2 Content Step ============

export const H2_CONTENT_DEFAULT_PROMPT = `### Role
You are an expert blog content writer. Write a reader-first section that is genuinely helpful, accurate, and easy to scan. Optimize for clarity and trust, not rankings. 1st sentence is super direct and addresses the user intent clearly and directly.

### Priority Order (use to resolve any conflict between rules)
1. Factual accuracy
2. Reader clarity
3. Safety and compliance (money/legal)
4. Brevity
5. Tone/style
6. SEO

---

### Input Data
- Keyword Phrase: {PAGE_NAME}
- Main Article Topic: {PAGE_NAME}
- H2 to Write: {H2_NAME}
- All H2s in Article (order): {ALL_H2S}
- Formatting and Length Guidelines (STRICT): {CONTENT_GUIDELINES}
- Anti-Contradiction Guidelines (follow only if accurate; if information is incorrect, write the correct version instead): {CONTENT_GUIDELINES}

### Factual Corrections
Incorporate all corrections below seamlessly. These override any conflicting assumptions.
{FACTUAL_CORRECTIONS}

---

### Anti-Hallucination Rules (CRITICAL, applies to every sentence)
- Do not invent links, brands, app features, pricing, limits, timelines, or legal/regulatory claims.
- Do not include specific numbers (fees, APRs, time-to-funding, limits, state caps, cooling-off periods, legality claims) unless they appear in the Input Data or Factual Corrections above.
- If a number is needed for illustration, label it clearly as an example with stated assumptions (e.g., 'Example, assumes 25% APR over 30 days: ...') and do not imply it is typical.
- Do not include any links unless a specific source URL is provided in the input or explicitly requested by the user. Zero links otherwise.
- If a statement would normally require a source (laws, caps, app-specific claims), either omit it or phrase it as variable and tell the reader how to verify.
- Avoid sweeping generalizations. Prefer: (1) what is usually true, (2) what varies, (3) what to check (cardholder agreement, lender terms, state regulator).

### Sourcing and Hyperlinking
- Only reference reputable sources (government, popular and reputable sites, etc.). Do not reference no-name informational/spam websites ever.
- HTML format: <a href='URL'>anchor text</a>. Link each source once.
- Anchor text: 3-10 words, descriptive, grammatically correct.
- Only link sources explicitly provided in the input.
- Example: Recent findings show that <a href='https://example.com/study'>lorem ipsum improves design focus</a> for teams.

---

### What to Write
Write the section for the H2: '{H2_NAME}' inside the larger blog post titled: '{PAGE_NAME}'.

The section should feel like a natural, seamless part of the full article. Reference earlier or later sections only when it genuinely helps the reader.

### Opening (first 1-2 sentences)
- Directly answer the H2's root intent. No filler openers.
- Use confidence where facts are stable. Add one short qualifier when terms vary by issuer, state, or lender.
- The first 3-5 lines should contain the core answer and key caveats. A reader who stops here should still walk away informed.

### Body
- Strictly follow the formatting and length guidelines provided.
- Never use tables, comparison tables, rows/columns, tabular layouts, or chart-style formatting. If comparison or structure is needed, use paragraphs, bullets, or numbered steps instead.
- Be concise, but do not omit critical caveats, definitions, or steps required to act safely (especially for money/legal topics).
- One main idea per paragraph. No long walls of text.
- Use lists only when they genuinely add scannability or clarity.
- Flow logically from the previous H2 and set up the next one only when it helps the reader, not as a formula.
- Add only the details that materially change a reader's decision or action.
- Deliver actionable value: the reader should know what to do next and what to double-check.

### Ending
- Stop immediately after the last useful point. No recaps, no 'In summary,' no conclusion paragraph.
- One final safety note (one sentence max) is allowed for high-risk money or legal sections.

---

### Writing Style
- Tone: Trusted friend. Plainspoken, calm, reassuring. Light humor is fine unless the section covers fees/APR, scams, or legal rules.
- No corporate fluff, no filler. Brief caution language is allowed when it prevents harm (e.g., 'check your cardholder agreement').
- Use specific examples only when you can clearly state assumptions (amount, APR/fees, timeline). Otherwise use ranges plus 'varies by issuer/state' and tell the reader what to verify.
- Use active voice and active verbs most of the time. Use specific nouns over vague ones.
- Make claims with appropriate qualifiers when facts vary ('often,' 'typically,' 'may,' 'can,' 'varies by...'). Use absolutes only when universally true.

### Sentence-Level Rules
- Vary sentence openings and structure naturally. Do not force variety at the expense of clarity.
- Minimize repetitive second-person commands. Mix imperative sentences ('Check your limit.') with neutral phrasing ('Most issuers list...').
- Never use em dashes; use commas or parentheses instead.
- If a point was covered in a previous section, either omit it or reference it naturally. Do not use stock phrases like 'as we covered above.'
- Restating a key idea once is acceptable if it genuinely helps skim readers. Beyond that, cut it.

---

### Output Format
- Entire response must be wrapped in <answer> tags with no text before or after.
- No other XML or HTML tags outside of approved hyperlinks.
- Never reference or mention heading tags (H2, H3, etc.) anywhere in the answer. The section content should read as pure prose and lists, not as meta-commentary about headings.`;

const H2_RATING_DEFAULT_PROMPT = `Persona: Expert fact checker. Focus on dangerous errors, not imperfect phrasing.

Fact check this content for: {FACT_CHECK_TARGET} (for the h2 name: {H2_NAME}). Rate 1-5 based on the accuracy of the content answer for the h2 name. Reserve Rating 3+ for truly harmful errors only.

Content to fact check:
{H2_CONTENT}

AUTO RATING 5:
- Non-English/Chinese characters
- Recommends competitors (only 'thecreditpeople.com' allowed)
- Incomplete answer
- Broken grammar

MAJOR ERROR TEST (must pass >=1 to be major):
1. Would cause illegal/dangerous actions
2. Would cause missed critical deadlines
3. Wrong venue/authority entirely (small claims vs housing court)
4. Wrong tool/method entirely (CO detector vs smoke detector)
5. Fundamentally misrepresents core legal rights

If NO to all 5 = MINOR error (Rating 2), not major.

ERROR EXAMPLES:

Minor (Rating 2):
- Overgeneralized state rules ('3-5 days' when it varies)
- 'Many leases' vs 'some leases'
- Missing procedural nuance
- Imprecise but directionally correct

Major (Rating 3+):
- Wrong court venue
- Wrong detection tool
- Backwards legal rights (tenant redemption)
- Overstated protections causing harm

RATING SCALE:
1 = No errors
2 = 1-3 minor errors only
3 = 2+ major errors passing the test above
4 = 4+ major errors
5 = Auto disqualification

Default to Rating 1-2. Imprecision alone is not misinformation.

Return ONLY a valid JSON object with exactly these keys:
- rating
- majorErrors
- minorErrors
- summary
- corrections
- factuallyIncorrectInfo

JSON rules:
- No markdown fences
- No commentary before or after the JSON
- rating must be an integer from 1 to 5
- majorErrors and minorErrors must be integers
- summary must be 1 sentence
- corrections must be 2-3 sentences, or "None needed"
- factuallyIncorrectInfo must be an array of objects with "incorrect" and "correct" strings, or an empty array`;

const H2_HTML_DEFAULT_PROMPT = `### SYSTEM INSTRUCTION
You are a Text-to-HTML Compiler. You do NOT write new content. You strictly convert the userâ€™s existing text into HTML using the rules below, then run a final sanitization sweep.

Source page name: {PAGE_NAME}
Source H2 name: {H2_NAME}
Source H2 answer:
{H2_CONTENT}

CRITICAL OUTPUT RULES
- Output ONLY the final HTML (no surrounding quotes, no markdown fences, no explanations).
- Never wrap the entire output (or any block) in literal quote characters like "..." or '...'. If the input includes lines that are wrapped in leading+trailing quotes, remove only those wrapper quotes.
- The output must be valid HTML (not Markdown-in-HTML). No **, __, #, or leftover Markdown markers may appear anywhere in the final output.
- Absolutely no <h4> tags are allowed in output; convert any would-be <h4> to <h3>.

### PHASE 1: STRUCTURAL CONVERSION
1. **Lists**
- Input: Consecutive lines starting with -, *, or 1. / 2. / etc.
- Output:
  - Bullets (- or *) become a single <ul> block.
  - Numbers (1. etc.) become a single <ol> block.
  - Each item becomes <li>Item text</li>.
- CRITICAL: Remove the leading symbol/number and following whitespace.
  - Forbidden: <li>- Text</li> or <li>1. Text</li>
  - Required: <li>Text</li>

2. **Headings**
- Input:
  - Lines starting with #, ##, ###, ####
  - Or short standalone lines in Title Case intended as headings
- Output:
  - # and ## => <h2>Heading</h2>
  - ### and #### => <h3>Heading</h3> (because <h4> is forbidden)
- CRITICAL:
  - Never output <h4>.
  - Remove the leading # symbols and following whitespace.

3. **Paragraphs**
- Wrap remaining non-empty text blocks in <p>...</p>.
- Do not create empty <p></p> tags.

### PHASE 2: INLINE FORMATTING (STRICT)
Perform inline replacements ONLY inside text content (inside <p>, <li>, and heading tags), not across tag boundaries.

1. **Bold**
- Replace **text** OR __text__ with <strong>text</strong>.
- Do NOT leave any ** or __ characters behind.

2. **Italic**
- Replace *text* OR _text_ with <em>text</em>.
- Ensure this does not re-process list markers (lists are handled in Phase 1 first).

3. **Links**
- Convert Markdown links [text](url) to <a href="url">text</a>.
- Preserve the URL exactly; do not add tracking parameters.
- Never emit a bare <a> tag. Every anchor must include a non-empty href attribute.
- Only emit <a> when the source text includes a real URL to preserve. If there is no explicit URL in the source, leave the text unlinked.
- Do not invent URLs, placeholders, "#", empty hrefs, or <a>text</a>.
- If the source contains malformed or partial anchor markup without a usable URL, unwrap it to plain text instead of keeping an anchor tag.

### PHASE 3: SANITIZATION (FINAL SWEEP)
Run these checks on the ENTIRE HTML output.

Rule A (No Markdown leftovers)
- Scan for any remaining **, __, backticks, or heading markers like #, ##, ###.
- If found: convert them if a valid pair exists; otherwise delete the stray markers.

Rule B (No Markdown inside HTML)
- If you see patterns like <strong>** or **</strong> (or the __ equivalents), delete the ** / __ so the result is clean HTML like <strong>Text</strong>.

Rule C (No wrapper quotes)
- Remove any leading or trailing quote characters that wrap an entire line/block/tag, e.g. " <p>...</p> " or '<li>...</li>'.
- Do not remove quote characters that are legitimately part of the text content.

Rule D (No h4)
- If any <h4> appears for any reason, convert it to <h3>.

Rule E (Capitalization)
- Ensure the first letter of the text content in every <p>, <li>, <h2>, and <h3> is capitalized.

Rule F (Anchor integrity)
- Before returning output, scan every <a> tag.
- Each <a> must have a non-empty href attribute with the original source URL preserved.
- If an anchor does not have a usable href, remove the anchor wrapper and keep only the text.

### OUTPUT
Output ONLY the final HTML code. Do not wrap in html code blocks.`;

const H2_SUMMARY_DEFAULT_PROMPT = `### Instructions: You're a world class content writer and editor.

I prefer answers that are direct and to the point while avoiding any introductory phrases. Please keep this in mind while responding. Be as detailed and specific/granular as humanly possible as it relates to providing the absolute best and most helpful/insightful information based on it's semantic intent to the main keyword.

You must write 3-4 short and incisive sentences that directly answers keyword phrase (use content below to assist with answering). Ensure 1st sentence directly answers keyword phrase granularly and definitively. Active voice only. Use simple words. Succinct, concise and logically organized.

Be insightful, actionable/helpful and informative. Use simple words and language. Keep as much stats, data, details, etc. in our answer.

I prefer answers that are direct and to the point whilr avoiding any introductory phrases. Please keep this in mind while responding.

My job is on the line, so triple check that you properly did this!

### Source Data
- Page Name: {PAGE_NAME}
- H2 Name: {H2_NAME}
- H2 Content:
{H2_CONTENT}

### Format: The output should exclusively started based on the instructions above... and nothing else. Avoid starting the output with addressing what you're about to do... just start it with the answer and nothing else.`;

const H1_BODY_DEFAULT_PROMPT = `For Main Keyword: {MAIN_KEYWORD}

Overall Goal:
Write two ultra-concise intro paragraphs (2-3 sentences in paragraph 1, 1-2 in paragraph 2) using accessible and easy to read/understand language. Each intro must instantly hook the reader, build trust, and preview solutions while smoothly leading into the full article. Tone = authoritative, warm, and conversational (like a knowledgeable friend).

Format & Flow:
Do not write labels like paragraph 1 or paragraph 2. Return only the 2 paragraphs and nothing else.

Paragraph 1 (2-3 sentences):
Start with a strong statement hook that directly addresses the reader's exact problem, fear, or goal behind the core semantic intent of the article topic. Never use first person in the opening sentence. Always use second person if you are directly addressing or referencing the reader. Explain why it matters now (urgency, risk, or opportunity). Frame it as a challenge with potential solutions.

Paragraph 2 (1-2 sentences):
Summarize the most pragmatic solutions that we cover below (never use I. Always use we when referencing ourselves with regard to what we cover in the article below). Use varied but simple language based on the core semantic intent of the main keyword and article title. Then follow up with a naturally connected sentence that ties the main article intent to the idea that giving us a call is a smart decision that could be part of their best possible solution. The goal of the call is reviewing their credit report, giving a full expert analysis, and discussing next steps.

Language & Style Rules:
- Speak directly to the reader with "you" and make them the subject of key sentences.
- Use active voice. Avoid passive constructions.
- Never use acronyms without first writing the full phrase out and making sure the reader fully understands it.
- Begin instantly with the hook. No throat clearing.
- Keep sentences crisp, short, and natural to read aloud.
- Every sentence must add clarity, action, or authority.
- Favor micro-specifics over vague phrasing.
- Show empathy by addressing the reader's concern directly, not with cliches.
- Keep the rhythm smooth and natural.
- Avoid buzzwords, filler, and empty warmth.

Long Tail Keywords: These are all the sections in our article.
{H2_NAMES}

Article Summaries:
Reference the full article summary below when writing the 2 paragraph answer. We are a credit-related business that helps individuals fix their credit. Do not frame the intro as us trying to sell some service. This is an informational article. Our name is The Credit People. We do not offer loans. We do not offer other services. No more. No less.

### External Linking Guide
Follow all instructions below for how to reference the Context below to determine if any existing links (never hallucinate hyperlinks) can be used in the 2 paragraph answer only if it is contextually appropriate and fully fits the criteria. If there are no studies in context, do not hallucinate any and do not include external links.

Strictly use hyperlink anchor text to link to relevant studies from the context only when they help support the answer.

External Link Example:
Example accurate text taken from our page guidelines for the relevant study <a href="http://science.org/study-2023">relevant, detailed and short anchor text</a> example text after. Do not copy this URL. It is only an example. If a real URL exists in the reference context below and it is contextually appropriate for the intro, then include it.

The Anchor Text Must:
1. Be immediately understandable without surrounding context.
2. Include specific and accurate relevant findings, details, data, or stats within the anchor text when appropriate.
3. Naturally connect to the core semantic intent of the main keyword phrase.
4. Use precise, descriptive, and short tokens. Avoid generic phrases like "studies show" or "research indicates".
5. Fit seamlessly in the sentence flow.
6. Maintain proper spacing before <a href and after </a>.

Format: 2 succinct paragraphs.
---

Context:
{CONTEXT}`;

const H1_HTML_DEFAULT_PROMPT = `### SYSTEM INSTRUCTION
You are a Text-to-HTML Compiler. You do NOT write new content. You strictly convert the user's existing H1 body intro text into HTML using the rules below, then run a final sanitization sweep.

Source page name: {PAGE_NAME}
Source H1 body:
{H1_BODY}

CRITICAL OUTPUT RULES
- Output ONLY the final HTML (no surrounding quotes, no markdown fences, no explanations).
- Never wrap the entire output (or any block) in literal quote characters like "..." or '...'. If the input includes lines that are wrapped in leading+trailing quotes, remove only those wrapper quotes.
- The output must be valid HTML (not Markdown-in-HTML). No **, __, #, or leftover Markdown markers may appear anywhere in the final output.
- Absolutely no <h4> tags are allowed in output; convert any would-be <h4> to <h3>.

### PHASE 1: STRUCTURAL CONVERSION
1. Lists
- Input: Consecutive lines starting with -, *, or 1. / 2. / etc.
- Output:
  - Bullets (- or *) become a single <ul> block.
  - Numbers (1. etc.) become a single <ol> block.
  - Each item becomes <li>Item text</li>.
- CRITICAL: Remove the leading symbol/number and following whitespace.
  - Forbidden: <li>- Text</li> or <li>1. Text</li>
  - Required: <li>Text</li>

2. Headings
- Input:
  - Lines starting with #, ##, ###, ####
  - Or short standalone lines in Title Case intended as headings
- Output:
  - # and ## => <h2>Heading</h2>
  - ### and #### => <h3>Heading</h3> (because <h4> is forbidden)
- CRITICAL:
  - Never output <h4>.
  - Remove the leading # symbols and following whitespace.

3. Paragraphs
- Wrap remaining non-empty text blocks in <p>...</p>.
- Do not create empty <p></p> tags.

### PHASE 2: INLINE FORMATTING (STRICT)
Perform inline replacements ONLY inside text content (inside <p>, <li>, and heading tags), not across tag boundaries.

1. Bold
- Replace **text** OR __text__ with <strong>text</strong>.
- Do NOT leave any ** or __ characters behind.

2. Italic
- Replace *text* OR _text_ with <em>text</em>.
- Ensure this does not re-process list markers (lists are handled in Phase 1 first).

3. Links
- Convert Markdown links [text](url) to <a href="url">text</a>.
- Preserve the URL exactly; do not add tracking parameters.
- Never emit a bare <a> tag. Every anchor must include a non-empty href attribute.
- Only emit <a> when the source text includes a real URL to preserve. If there is no explicit URL in the source, leave the text unlinked.
- Do not invent URLs, placeholders, "#", empty hrefs, or <a>text</a>.
- If the source contains malformed or partial anchor markup without a usable URL, unwrap it to plain text instead of keeping an anchor tag.

### PHASE 3: SANITIZATION (FINAL SWEEP)
Run these checks on the ENTIRE HTML output.

Rule A (No Markdown leftovers)
- Scan for any remaining **, __, backticks, or heading markers like #, ##, ###.
- If found: convert them if a valid pair exists; otherwise delete the stray markers.

Rule B (No Markdown inside HTML)
- If you see patterns like <strong>** or **</strong> (or the __ equivalents), delete the ** / __ so the result is clean HTML like <strong>Text</strong>.

Rule C (No wrapper quotes)
- Remove any leading or trailing quote characters that wrap an entire line/block/tag, e.g. " <p>...</p> " or '<li>...</li>'.
- Do not remove quote characters that are legitimately part of the text content.

Rule D (No h4)
- If any <h4> appears for any reason, convert it to <h3>.

Rule E (Capitalization)
- Ensure the first letter of the text content in every <p>, <li>, <h2>, and <h3> is capitalized.

Rule F (Anchor integrity)
- Before returning output, scan every <a> tag.
- Each <a> must have a non-empty href attribute with the original source URL preserved.
- If an anchor does not have a usable href, remove the anchor wrapper and keep only the text.

### OUTPUT
Output ONLY the final HTML code. Do not wrap in html code blocks.`;

const QUICK_ANSWER_DEFAULT_PROMPT = `### Instructions: You are a world-class content writer and editor that writes only in active voice. Your task is to create a succinct, 3-sentence introduction (using active voice) for an article about the topic in the page title: {PAGE_NAME}. Use empathetic, strong, and actionable language. Your goal is to hook the reader, bridge them to the article's content, and introduce our expert service as the ultimate solution. Avoid intros or filler. Be straightforward and objective. 2 succinct paragraphs.

Technique: Use the "agree and amplify" method. Connect with the reader's problem, acknowledge their ability to handle it themselves, but gently highlight the potential pitfalls and introduce our service as a stress-free alternative. Use soft, non-committal language (for example, "could" and "potentially"). 2 succinct paragraphs.

Format: Must be 2 succinct paragraphs.
Follow the three-sentence structure below, using dynamic and simple language.

Empathetic Hook: Start with a question that acknowledges the reader's situation, potential frustration, confusion, or similar concern. Use a wide variety of language in the opening empathetic hook while utilizing the core semantic intent from the page title.

The Dilemma & Bridge: Acknowledge that navigating this topic can be complex with potential pitfalls, and explain that this article is designed to provide the clarity they need.

The Solution & CTA: Seamlessly transition to the alternative. Mention that for those who want a stress-free path, our experts with 20+ years of experience can analyze their unique situation and handle the entire process.

Content Source: {H1_BODY}`;

const QUICK_ANSWER_HTML_DEFAULT_PROMPT = `### SYSTEM INSTRUCTION
You are a Text-to-HTML Compiler. You do NOT write new content. You strictly convert the user's existing quick answer text into HTML using the rules below, then run a final sanitization sweep.

Source page name: {PAGE_NAME}
Source quick answer:
{QUICK_ANSWER}

CRITICAL OUTPUT RULES
- Output ONLY the final HTML (no surrounding quotes, no markdown fences, no explanations).
- Never wrap the entire output (or any block) in literal quote characters like "..." or '...'. If the input includes lines that are wrapped in leading+trailing quotes, remove only those wrapper quotes.
- The output must be valid HTML (not Markdown-in-HTML). No **, __, #, or leftover Markdown markers may appear anywhere in the final output.
- Absolutely no <h4> tags are allowed in output; convert any would-be <h4> to <h3>.

### PHASE 1: STRUCTURAL CONVERSION
1. Lists
- Input: Consecutive lines starting with -, *, or 1. / 2. / etc.
- Output:
  - Bullets (- or *) become a single <ul> block.
  - Numbers (1. etc.) become a single <ol> block.
  - Each item becomes <li>Item text</li>.
- CRITICAL: Remove the leading symbol/number and following whitespace.
  - Forbidden: <li>- Text</li> or <li>1. Text</li>
  - Required: <li>Text</li>

2. Headings
- Input:
  - Lines starting with #, ##, ###, ####
  - Or short standalone lines in Title Case intended as headings
- Output:
  - # and ## => <h2>Heading</h2>
  - ### and #### => <h3>Heading</h3> (because <h4> is forbidden)
- CRITICAL:
  - Never output <h4>.
  - Remove the leading # symbols and following whitespace.

3. Paragraphs
- Wrap remaining non-empty text blocks in <p>...</p>.
- Do not create empty <p></p> tags.

### PHASE 2: INLINE FORMATTING (STRICT)
Perform inline replacements ONLY inside text content (inside <p>, <li>, and heading tags), not across tag boundaries.

1. Bold
- Replace **text** OR __text__ with <strong>text</strong>.
- Do NOT leave any ** or __ characters behind.

2. Italic
- Replace *text* OR _text_ with <em>text</em>.
- Ensure this does not re-process list markers (lists are handled in Phase 1 first).

3. Links
- Convert Markdown links [text](url) to <a href="url">text</a>.
- Preserve the URL exactly; do not add tracking parameters.
- Never emit a bare <a> tag. Every anchor must include a non-empty href attribute.
- Only emit <a> when the source text includes a real URL to preserve. If there is no explicit URL in the source, leave the text unlinked.
- Do not invent URLs, placeholders, "#", empty hrefs, or <a>text</a>.
- If the source contains malformed or partial anchor markup without a usable URL, unwrap it to plain text instead of keeping an anchor tag.

### PHASE 3: SANITIZATION (FINAL SWEEP)
Run these checks on the ENTIRE HTML output.

Rule A (No Markdown leftovers)
- Scan for any remaining **, __, backticks, or heading markers like #, ##, ###.
- If found: convert them if a valid pair exists; otherwise delete the stray markers.

Rule B (No Markdown inside HTML)
- If you see patterns like <strong>** or **</strong> (or the __ equivalents), delete the ** / __ so the result is clean HTML like <strong>Text</strong>.

Rule C (No wrapper quotes)
- Remove any leading or trailing quote characters that wrap an entire line/block/tag, e.g. " <p>...</p> " or '<li>...</li>'.
- Do not remove quote characters that are legitimately part of the text content.

Rule D (No h4)
- If any <h4> appears for any reason, convert it to <h3>.

Rule E (Capitalization)
- Ensure the first letter of the text content in every <p>, <li>, <h2>, and <h3> is capitalized.

Rule F (Anchor integrity)
- Before returning output, scan every <a> tag.
- Each <a> must have a non-empty href attribute with the original source URL preserved.
- If an anchor does not have a usable href, remove the anchor wrapper and keep only the text.

### OUTPUT
Output ONLY the final HTML code. Do not wrap in html code blocks.`;

const META_DESCRIPTION_DEFAULT_PROMPT = `### Instructions: You are an expert SEO content writer. Write a meta description for the following page. Keep in mind we're a credit repair company so we can't offer services and our goal is an informational site that connects the core user's intent with what we can do; initially pull someone's credit report and performing a full, free expert analysis.

**Page Name:** {PAGE_NAME}

**Rules:**
1. Write in active voice, normal sentence case (not title case, not all caps).
2. MUST be between 145 and 160 characters. Under 145 is a failure. Over 160 is a failure. Count carefully.
3. We are a credit repair company. This is an informational article â€” never sound like a sales pitch, never make specific promises or guarantees about outcomes.
4. Lead with the core search intent behind this page name. What does someone searching this phrase actually need to know? Open with that.
5. Include a reason to click that is specific to THIS page â€” name what the reader will actually find (a comparison, steps, requirements, risks, eligibility info, state laws, etc.). Never use vague filler like "find out the truth" or "discover how" without saying what they'll discover.
6. Always end by connecting a free credit review to the specific concern of this page. Do NOT just append "Get a free credit review" as a generic closer. Phrase it so the review feels like the natural next step for someone with THIS specific question. Examples: "See where your credit stands before you borrow," "Check how this would affect your score," "Find out if your credit qualifies you for better terms," "Start with a free look at your credit before you apply." The action is always a free credit review, but the framing must match the page's intent.
7. Use second person (you/your) to speak directly to the reader.
8. Never use exclamation points. Never use the word "discover" or "unlock."
9. Do not repeat the same mid-section filler across pages. Avoid defaulting to "eligibility, fees, state laws, and risks" as a catch-all list on every description. Name the ONE or TWO most relevant things for THIS specific page.

Output ONLY the meta description text. Nothing else.`;

const META_SLUG_DEFAULT_PROMPT = `### Instructions: You are a technical SEO expert. Convert the "Target Phrase" below into a clean, readable URL slug.

### Formatting Rules:
1. Format: all-lower-case-separated-by-hyphens
2. SEPARATOR: Strictly replace all spaces with hyphens (-).
3. FLOW: Keep all connecting words (stop words like "to", "and", "the") to ensure the slug reads naturally like a sentence. Do not chop it up.
4. CLEANING: Remove all special characters (quotes, colons, ?, !) but keep the hyphens.

### Inputs:
Target Phrase: {PAGE_NAME}
Reference Context: {REFERENCE_CONTEXT}

### Output:
Provide ONLY the final slug string. No code blocks, no labels.`;

const META_CTA_DEFAULT_PROMPT = `Instructions

We're writing an article about: {PAGE_NAME}. We need to create 2 things; a CTA headline and a CTA body. Follow the content instructions below, but output ONLY one valid JSON object.

We first want to create a CTA headline while still using full sentence structure and super clear/readable wording, ideally less than 12 words. Then we want to create a CTA body which is a very succinct 2-sentence follow-up explanation underneath.

We need to make sure both the CTA headline and CTA body naturally and organically connect with the core semantic intent of the page name.

Also, we're a credit repair company, so our goal with this call to action is to push for them to call us. We need to ensure the CTA headline and body give the visitor a fundamentally legitimate reason to call us based on their unique situation in relation to the page name and the core semantic intent of the page name.

We want the visitor to at least consider the idea of calling us to resolve the core semantic intent of the page name, which is also the keyword they typed into Google that found our page.

Remember, our goal is always to try and get them to call us, which is presented in a way that's super non-committal, zero hassle, zero commitment, and completely free. Our goal is to first convince them to pull their credit report on the call, analyze their score, then pitch the idea that we can dispute and potentially remove inaccurate negative items from their credit report. That's our priority. This dispute and removal process takes time. Results can be achieved in as early as 30-60 days but that's not anywhere near a guarantee.

Keep in mind we can never fully commit or say we can 100% remove negative items. We can dispute inaccurate negative items and get them potentially removed from their report. It all starts with a soft pull first that does not affect their credit to analyze their score and devise a gameplan to fix their credit.

Make sure the CTA headline also speaks directly to the reader in active voice. Focus on the reader as the subject of the headline and use "you" if possible. Also make sure the CTA headline is super easy and clear to read.

Content rules:
- CTA Headline: 8-12 words
- CTA Body: 2 extremely short and succinct sentences. The 1st sentence connects the core semantic intent of the article with the user's unique situation in a convincing but still neutral and objective way. The final short sentence connects that with the natural next step of calling us and mentions that we'll pull their report, evaluate their report, score, and negative items, and map next steps including identifying potentially inaccurate negative items, disputing them, and potentially getting them removed.

Output rules:
- Return ONLY one valid JSON object
- No markdown fences
- No commentary
- No labels outside JSON
- Use exactly this shape:
{"headline":"CTA headline here","body":"CTA body here"}`;

const META_SLUG_SLOT: PromptSlotConfig = {
  id: 'slug',
  label: 'Slug',
  promptLabel: 'Slug Prompt',
  defaultPrompt: META_SLUG_DEFAULT_PROMPT,
  icon: <FileText className="w-3.5 h-3.5" />,
  clearMetadataKeysOnReset: ['slug'],
  buildInput: (template, _primaryOutput, _externalData, _rowInput, row) => {
    const pageName = row?.metadata?.pageName?.trim() ?? '';
    const referenceContext = row?.metadata?.quickAnswerHtml?.trim() ?? row?.metadata?.quickAnswer?.trim() ?? '';
    if (!pageName) return { input: '', error: 'page-name-missing' };
    return { input: buildSlugPrompt(template, { pageName, referenceContext }) };
  },
  transformOutput: ({ rawOutput }) => {
    const slug = rawOutput.trim();
    if (!slug) throw new Error('Slug output was empty.');
    return {
      output: slug,
      metadata: { slug },
    };
  },
};

const META_CTA_SLOT: PromptSlotConfig = {
  id: 'cta',
  label: 'CTAs',
  promptLabel: 'CTA Prompt',
  defaultPrompt: META_CTA_DEFAULT_PROMPT,
  icon: <MessageSquareQuote className="w-3.5 h-3.5" />,
  responseFormat: 'json_object',
  clearMetadataKeysOnReset: ['ctaHeadline', 'ctaBody'],
  buildInput: (template, _primaryOutput, _externalData, _rowInput, row) => {
    const pageName = row?.metadata?.pageName?.trim() ?? '';
    if (!pageName) return { input: '', error: 'page-name-missing' };
    return { input: buildCtaPrompt(template, { pageName }) };
  },
  transformOutput: ({ rawOutput }) => {
    const parsed = parseCtaJsonOutput(rawOutput);
    return {
      output: rawOutput.trim(),
      metadata: {
        ctaHeadline: parsed.headline,
        ctaBody: parsed.body,
      },
    };
  },
};

const PRO_TIP_DEFAULT_PROMPT = `### ROLE ###
You are writing one ultra-short "pro tip" for a reader.

### TASK ###
Use the page name and article context below to write exactly one genuinely helpful, novel, actionable sentence based on the deep semantic intent of the page.

### STYLE RULES ###
- Use simple, easy-to-read language.
- Speak directly to the reader using "you".
- Use cautious, non-definitive wording when facts may vary.
- Do not sound overly committal or absolute.
- Make the sentence concise, but include granular detail if that makes the tip more useful.

### FORMAT RULES ###
- Output exactly 1 sentence.
- Start the sentence with \u26A1 followed by a single space.
- Output exactly 1 line only.
- No title, no label, no bullets, no numbering, no intro text, and no extra explanation before or after the sentence.

### INPUTS ###
Page Name: {PAGE_NAME}
Article Context:
{ARTICLE_CONTEXT}`;

const RED_FLAG_DEFAULT_PROMPT = `### ROLE ###
You are a **world-class** consumer advocate and analyst. You operate from **first principles**, breaking down complex situations to their fundamental truths to provide insights that are not obvious (using simple and easy to read/understanding words/language, always!). Your mission is to empower and protect readers. The clarity and accuracy of your warnings are of **critical importance**, as a consumer's financial well-being could depend on them. They must be genuine red flags.

### TASK ###
Your analysis must be flawless. Your mission is to derive **5 legitimately novel, helpful, and non-obvious** red flags from the **core semantic intent** of the provided \`Article Context\`. This is not about summarizing; it is about generating profound, pragmatic warnings based on a deep, foundational understanding of the situation.

### STEP-BY-STEP PROCESS ###
1.  **Deconstruct from First Principles:** Before anything else, analyze the \`Article Context\`. What is the fundamental business model of this entity? What are the inherent conflicts of interest? What are the consumer's most basic rights and vulnerabilities in this specific scenario? Identify the core truths of the situation.
2.  **Synthesize Core Intent:** Based on your first-principles analysis, determine the primary goal and tactics of the company as described in the text.
3.  **Brainstorm Unique Risks:** Generate a list of potential negative outcomes for the consumer that stem *directly* from your first-principles analysis, not from generic, surface-level knowledge.
4.  **Select & Refine for Maximum Impact:** Choose the 5 most critical and non-obvious risks. Craft each into a single, concise sentence that adheres to all rules below.

### RULES & CONSTRAINTS ###
- **Novelty is Essential:** Avoid obvious warnings (e.g., 'they might call you,' 'check your credit report'). The insights must be genuinely new and valuable to someone unfamiliar with this specific entity.
- **Speak directly to the reader** using 'you.'
- **Use simple, layman-friendly language.** Avoid jargon.
- **Use cautious and non-definitive language.** Assume possibilities, not facts (e.g., use words like 'could,' 'may,' 'might,' 'potential').
- **DO NOT** repeat the same core idea. Each red flag must be distinct.

### OUTPUT FORMAT ###
- Provide exactly 5 red flags.
- Each red flag must be exactly 1 line.
- Each line must start with \uD83D\uDEA9 followed by a single space.
- Each line must contain exactly 2 short sentences on that same line:
  1. the red flag
  2. a very short actionable caution tied to that same red flag
- Put exactly 1 blank line between each red flag line.
- Do not use bullets, numbering, headings, labels, or any text before the first red flag or after the fifth red flag.
- Do not merge red flags together.
- Keep each line easy to understand without prior knowledge.
- Make all 5 red flags distinct and genuinely useful.

Example format:

\uD83D\uDEA9 First warning sentence. Be careful here.

\uD83D\uDEA9 Second warning sentence. Watch this closely.

\uD83D\uDEA9 Third warning sentence. Double-check this.

\uD83D\uDEA9 Fourth warning sentence. Read the terms carefully.

\uD83D\uDEA9 Fifth warning sentence. Slow down before acting.

--- START ANALYSIS ---

**Page Name:** {PAGE_NAME}

**Article Context:** {ARTICLE_CONTEXT}`;

const KEY_TAKEAWAYS_DEFAULT_PROMPT = `Evaluate the content below for our article and create 5 succinct and short sentences that act as the article's key takeaways. Every takeaway must be distinct, helpful, pragmatic, and tied to the core semantic intent of the page name '{PAGE_NAME}'. The 5 takeaways should feel like a logical progression, while still being separate ideas.

### STYLE RULES ###
- Use simple language and speak directly to the reader using "you".
- Use cautious, non-definitive wording when facts may vary.
- Keep each takeaway concise and useful.
- In the 5th takeaway only, naturally mention that calling The Credit People could help you pull and review your credit report and discuss next steps.

### FORMAT RULES ###
- Output exactly 5 lines.
- Each line must contain exactly 1 sentence.
- Each line must start with \uD83D\uDDDD\uFE0F followed by a single space.
- Put each takeaway on its own line.
- Do not add blank lines between takeaways.
- Do not add any title, label, numbering, intro text, or closing text.
- Do not output anything before the first takeaway or after the fifth takeaway.
- Do not combine two takeaways into one line.
- Do not wrap a single takeaway across multiple lines.
- Do not use colons after the emoji.
- Lines 1 through 4 must only be informational takeaways.
- Line 5 must still be a takeaway first, with the soft mention of calling The Credit People woven into that same single sentence.

### EXACT OUTPUT SHAPE ###
\uD83D\uDDDD\uFE0F First takeaway sentence
\uD83D\uDDDD\uFE0F Second takeaway sentence
\uD83D\uDDDD\uFE0F Third takeaway sentence
\uD83D\uDDDD\uFE0F Fourth takeaway sentence
\uD83D\uDDDD\uFE0F Fifth takeaway sentence

### INPUTS ###
Page Name: {PAGE_NAME}
Article Context:
{ARTICLE_CONTEXT}`;

const RED_FLAG_SLOT: PromptSlotConfig = {
  id: 'redflag',
  label: 'Red Flag',
  promptLabel: 'Red Flag Prompt',
  defaultPrompt: RED_FLAG_DEFAULT_PROMPT,
  icon: <OctagonAlert className="w-3.5 h-3.5" />,
  buildInput: (template, _primaryOutput, _externalData, _rowInput, row) => {
    const pageName = row?.metadata?.pageName?.trim() ?? '';
    const articleContext = row?.metadata?.h2Summaries?.trim() ?? '';
    if (!pageName) return { input: '', error: 'page-name-missing' };
    if (!articleContext) return { input: '', error: 'article-context-missing' };
    return { input: buildRedFlagPrompt(template, { pageName, articleContext }) };
  },
};

const KEY_TAKEAWAYS_SLOT: PromptSlotConfig = {
  id: 'keytakeaways',
  label: 'Key Takeaways',
  promptLabel: 'Key Takeaways Prompt',
  defaultPrompt: KEY_TAKEAWAYS_DEFAULT_PROMPT,
  icon: <Sparkles className="w-3.5 h-3.5" />,
  buildInput: (template, _primaryOutput, _externalData, _rowInput, row) => {
    const pageName = row?.metadata?.pageName?.trim() ?? '';
    const articleContext = row?.metadata?.h2Summaries?.trim() ?? '';
    if (!pageName) return { input: '', error: 'page-name-missing' };
    if (!articleContext) return { input: '', error: 'article-context-missing' };
    return { input: buildKeyTakeawaysPrompt(template, { pageName, articleContext }) };
  },
};
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefinedDeep(item)) as T;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

async function persistGenerateRowsDoc(docId: string, rows: Array<Record<string, unknown>>): Promise<void> {
  const sanitizedRows = stripUndefinedDeep(rows);
  const result = await writeAppSettingsRowsRemote({
    docId,
    rows: sanitizedRows,
    cloudContext: 'content pipeline rows sync',
    updatedAt: new Date().toISOString(),
    registryKind: 'rows',
  });
  if (result.status !== 'accepted') {
    throw new Error(`content pipeline rows sync blocked: ${result.reason}`);
  }
}

// ============ ContentTab ============

interface ContentTabProps {
  activeProjectId: string | null;
  isVisible?: boolean;
  runtimeEffectsActive?: boolean;
  starredModels: Set<string>;
  onToggleStar: (modelId: string) => void;
  onBusyStateChange?: (isBusy: boolean) => void;
}

const H2_CONTENT_VIEW_TABS: ExternalViewTab[] = [
  { id: 'h2-content', label: 'H2 Body', icon: <NotebookPen className="w-3.5 h-3.5" /> },
  { id: 'rating', label: 'H2 Rate', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { id: 'h2-html', label: 'H2 Body HTML', icon: <Code2 className="w-3.5 h-3.5" /> },
  { id: 'h2-summary', label: 'H2 Summ.', icon: <ScrollText className="w-3.5 h-3.5" /> },
  { id: 'h1-body', label: 'H1 Body', icon: <PanelTop className="w-3.5 h-3.5" /> },
  { id: 'h1-html', label: 'H1 Body HTML', icon: <FileCode2 className="w-3.5 h-3.5" /> },
  { id: 'quick-answer', label: 'Quick Answer', icon: <MessageSquareQuote className="w-3.5 h-3.5" /> },
  { id: 'quick-answer-html', label: 'Quick Answer HTML', icon: <Code2 className="w-3.5 h-3.5" /> },
  { id: 'metas-slug-ctas', label: 'Metas/Slug/CTAs', icon: <Layers3 className="w-3.5 h-3.5" /> },
  { id: 'tips-redflags', label: 'Pro Tip/Red Flag/Key Takeaways', icon: <OctagonAlert className="w-3.5 h-3.5" /> },
  { id: 'final-pages', label: 'Final Pages', icon: <Layers3 className="w-3.5 h-3.5" /> },
];

const CONTENT_OVERVIEW_TAB: ExternalViewTab = {
  id: 'overview',
  label: 'Overview',
  icon: <Layers3 className="w-3.5 h-3.5" />,
};

export default function ContentTab({
  activeProjectId,
  isVisible = true,
  runtimeEffectsActive = true,
  starredModels,
  onToggleStar,
  onBusyStateChange,
}: ContentTabProps) {
  const { addToast } = useToast();
  const [workspaceStatusByProject, setWorkspaceStatusByProject] = useState<Record<string, { ready: boolean; error: string | null }>>({});
  const [instanceBusyStateByProject, setInstanceBusyStateByProject] = useState<Record<string, Record<string, boolean>>>({});
  const initialRoute = useMemo<ContentRouteState>(() => {
    if (typeof window === 'undefined') return getDefaultContentRoute();
    return parseContentRouteFromSearch(window.location.search);
  }, []);
  const [contentRoute, setContentRoute] = useState<ContentRouteState>(initialRoute);
  const [redoCount, setRedoCount] = useState(0);
  const routeViewState = useMemo(() => mapContentSubtabToViewState(contentRoute.subtab), [contentRoute.subtab]);
  const externalView = routeViewState.externalView;
  const pagesTableView = routeViewState.pagesTableView;
  const scopedDocIds = useMemo(() => resolveGenerateScopedDocIds(activeProjectId, {
    pageRows: UPSTREAM_PAGE_NAMES_DOC_ID,
    pageLogs: 'generate_logs_page_names',
    h2ContentRows: H2_CONTENT_ROWS_DOC_ID,
    h2ContentSettings: H2_PIPELINE_SETTINGS_DOC_ID,
    h2RatingRows: H2_RATING_ROWS_DOC_ID,
    h2RatingSettings: H2_RATING_SETTINGS_DOC_ID,
    h2HtmlRows: 'generate_rows_h2_html',
    h2HtmlSettings: H2_HTML_SETTINGS_DOC_ID,
    h2SummaryRows: H2_SUMMARY_ROWS_DOC_ID,
    h2SummarySettings: H2_SUMMARY_SETTINGS_DOC_ID,
    h1BodyRows: H1_BODY_ROWS_DOC_ID,
    h1BodySettings: H1_BODY_SETTINGS_DOC_ID,
    h1HtmlRows: 'generate_rows_h1_html',
    h1HtmlSettings: H1_HTML_SETTINGS_DOC_ID,
    quickAnswerRows: QUICK_ANSWER_ROWS_DOC_ID,
    quickAnswerSettings: QUICK_ANSWER_SETTINGS_DOC_ID,
    quickAnswerHtmlRows: QUICK_ANSWER_HTML_ROWS_DOC_ID,
    quickAnswerHtmlSettings: QUICK_ANSWER_HTML_SETTINGS_DOC_ID,
    metasSlugCtasRows: METAS_SLUG_CTAS_ROWS_DOC_ID,
    metasSlugCtasSettings: METAS_SLUG_CTAS_SETTINGS_DOC_ID,
    tipsRedflagsRows: 'generate_rows_tips_redflags',
    tipsRedflagsSettings: TIPS_REDFLAGS_SETTINGS_DOC_ID,
  }), [activeProjectId]);
  const workspaceStatus = activeProjectId ? workspaceStatusByProject[activeProjectId] : undefined;
  const workspaceReady = workspaceStatus?.ready ?? false;
  const workspaceError = workspaceStatus?.error ?? null;
  const instanceBusyState = useMemo(
    () => (activeProjectId ? instanceBusyStateByProject[activeProjectId] ?? {} : {}),
    [activeProjectId, instanceBusyStateByProject],
  );
  const setInstanceBusy = useCallback((instanceKey: string, isBusy: boolean) => {
    if (!activeProjectId) return;
    setInstanceBusyStateByProject((prev) => {
      const projectBusyState = prev[activeProjectId] ?? {};
      if (projectBusyState[instanceKey] === isBusy) return prev;
      return {
        ...prev,
        [activeProjectId]: {
          ...projectBusyState,
          [instanceKey]: isBusy,
        },
      };
    });
  }, [activeProjectId]);
  const setInstanceBusyRef = useRef(setInstanceBusy);
  useLayoutEffect(() => {
    setInstanceBusyRef.current = setInstanceBusy;
  }, [setInstanceBusy]);
  const contentInstanceBusyHandlers = useMemo(
    () => ({
      page_names: (isBusy: boolean) => setInstanceBusyRef.current('page_names', isBusy),
      h2_content: (isBusy: boolean) => setInstanceBusyRef.current('h2_content', isBusy),
      h2_rating: (isBusy: boolean) => setInstanceBusyRef.current('h2_rating', isBusy),
      h2_html: (isBusy: boolean) => setInstanceBusyRef.current('h2_html', isBusy),
      h2_summary: (isBusy: boolean) => setInstanceBusyRef.current('h2_summary', isBusy),
      h1_body: (isBusy: boolean) => setInstanceBusyRef.current('h1_body', isBusy),
      h1_html: (isBusy: boolean) => setInstanceBusyRef.current('h1_html', isBusy),
      quick_answer: (isBusy: boolean) => setInstanceBusyRef.current('quick_answer', isBusy),
      quick_answer_html: (isBusy: boolean) => setInstanceBusyRef.current('quick_answer_html', isBusy),
      metas_slug_ctas: (isBusy: boolean) => setInstanceBusyRef.current('metas_slug_ctas', isBusy),
      tips_redflags: (isBusy: boolean) => setInstanceBusyRef.current('tips_redflags', isBusy),
    }),
    [],
  );
  const onContentBusyParentRef = useRef(onBusyStateChange);
  useLayoutEffect(() => {
    onContentBusyParentRef.current = onBusyStateChange;
  }, [onBusyStateChange]);
  const lastReportedContentBusyRef = useRef<boolean | null>(null);
  const isAnyContentInstanceBusy = useMemo(
    () => Object.values(instanceBusyState).some(Boolean),
    [instanceBusyState],
  );
  const isStageRuntimeActive = useCallback((instanceKey: keyof typeof contentInstanceBusyHandlers, visibleWhenShown: boolean) => (
    runtimeEffectsActive && (Boolean(instanceBusyState[instanceKey]) || (isVisible && visibleWhenShown))
  ), [instanceBusyState, isVisible, runtimeEffectsActive]);
  const pageNamesRuntimeEffectsActive = isStageRuntimeActive('page_names', true);
  const h2ContentRuntimeEffectsActive = isStageRuntimeActive('h2_content', externalView === 'h2-content');
  const ratingRuntimeEffectsActive = isStageRuntimeActive('h2_rating', externalView === 'rating');
  const h2HtmlRuntimeEffectsActive = isStageRuntimeActive('h2_html', externalView === 'h2-html');
  const h2SummaryRuntimeEffectsActive = isStageRuntimeActive('h2_summary', externalView === 'h2-summary');
  const h1BodyRuntimeEffectsActive = isStageRuntimeActive('h1_body', externalView === 'h1-body');
  const h1HtmlRuntimeEffectsActive = isStageRuntimeActive('h1_html', externalView === 'h1-html');
  const quickAnswerRuntimeEffectsActive = isStageRuntimeActive('quick_answer', externalView === 'quick-answer');
  const quickAnswerHtmlRuntimeEffectsActive = isStageRuntimeActive('quick_answer_html', externalView === 'quick-answer-html');
  const metasSlugCtasRuntimeEffectsActive = isStageRuntimeActive('metas_slug_ctas', externalView === 'metas-slug-ctas');
  const tipsRedflagsRuntimeEffectsActive = isStageRuntimeActive('tips_redflags', externalView === 'tips-redflags');

  useEffect(() => {
    lastReportedContentBusyRef.current = null;
  }, [activeProjectId]);

  useEffect(() => {
    if (lastReportedContentBusyRef.current === isAnyContentInstanceBusy) return;
    lastReportedContentBusyRef.current = isAnyContentInstanceBusy;
    onContentBusyParentRef.current?.(isAnyContentInstanceBusy);
  }, [isAnyContentInstanceBusy]);

  useEffect(() => {
    let alive = true;
    if (!runtimeEffectsActive) return () => {
      alive = false;
    };
    if (!activeProjectId) return () => {
      alive = false;
    };
    void ensureProjectGenerateWorkspace(activeProjectId)
      .then(() => {
        if (!alive) return;
        setWorkspaceStatusByProject((prev) => ({
          ...prev,
          [activeProjectId]: { ready: true, error: null },
        }));
      })
      .catch((error) => {
        if (!alive) return;
        setWorkspaceStatusByProject((prev) => ({
          ...prev,
          [activeProjectId]: {
            ready: false,
            error: error instanceof Error ? error.message : 'Failed to prepare the shared Content workspace.',
          },
        }));
      });

    return () => {
      alive = false;
    };
  }, [activeProjectId, runtimeEffectsActive]);

  const syncContentUrl = useCallback((route: ContentRouteState, mode: 'push' | 'replace' = 'push') => {
    if (typeof window === 'undefined') return;
    const nextSearch = buildContentSearchForRoute(route, window.location.search);
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return;
    const state = buildContentHistoryState(route, window.history.state);
    if (mode === 'replace') window.history.replaceState(state, '', nextUrl);
    else window.history.pushState(state, '', nextUrl);
  }, []);

  const applyContentRoute = useCallback((route: ContentRouteState, mode: 'push' | 'replace' = 'push') => {
    setContentRoute(route);
    syncContentUrl(route, mode);
  }, [syncContentUrl]);

  const handleContentSubtabSelect = useCallback((subtab: ContentSubtabId, mode: 'push' | 'replace' = 'push') => {
    applyContentRoute({ subtab, panel: 'table' }, mode);
  }, [applyContentRoute]);

  const handleExternalViewSelect = useCallback((id: string) => {
    if (!id) return;
    const nextSubtab = mapViewStateToContentSubtab({
      externalView: id,
      pagesTableView,
    });
    handleContentSubtabSelect(nextSubtab);
  }, [handleContentSubtabSelect, pagesTableView]);

  const handlePagesTableViewChange = useCallback((view: 'primary' | string) => {
    const nextSubtab = mapViewStateToContentSubtab({
      externalView: null,
      pagesTableView: view,
    });
    applyContentRoute({ subtab: nextSubtab, panel: 'table' });
  }, [applyContentRoute]);

  const handleContentPanelChange = useCallback((panel: ContentPanelId) => {
    if (contentRoute.panel === panel) return;
    applyContentRoute({ ...contentRoute, panel });
  }, [applyContentRoute, contentRoute]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const applyFromLocation = () => {
      const nextRoute = parseContentRouteFromSearch(window.location.search);
      setContentRoute(nextRoute);
      syncContentUrl(nextRoute, 'replace');
    };
    applyFromLocation();
    window.addEventListener('popstate', applyFromLocation);
    return () => window.removeEventListener('popstate', applyFromLocation);
  }, [syncContentUrl]);

  const sharedContentPanelProps = useMemo(() => ({
    workspaceProjectId: activeProjectId,
    controlledGenSubTab: contentRoute.panel,
    onGenSubTabChange: handleContentPanelChange,
  }), [activeProjectId, contentRoute.panel, handleContentPanelChange]);

  // Stable reference for populateFromSource to avoid unnecessary re-renders of GenerateTabInstance
  const h2ContentSource = useMemo(() => ({
    label: 'Sync from Page Names',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildH2ContentRowsFromFirestore({
        settingsDocId: scopedDocIds.h2ContentSettings,
        fallbackPrompt: H2_CONTENT_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.pageRows,
        persistedRowsDocId: scopedDocIds.h2ContentRows,
        persistedRatingRowsDocId: scopedDocIds.h2RatingRows,
        loadMode,
      }),
    upstreamDocId: scopedDocIds.pageRows,
    additionalUpstreamDocIds: [scopedDocIds.h2RatingRows],
    pipelineSettingsDocId: scopedDocIds.h2ContentSettings,
  }), [scopedDocIds]);

  const ratingSource = useMemo(() => ({
    label: 'Sync from H2 Content',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildRatingRowsFromFirestore({
        settingsDocId: scopedDocIds.h2RatingSettings,
        fallbackPrompt: H2_RATING_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.h2ContentRows,
        persistedRowsDocId: scopedDocIds.h2RatingRows,
        loadMode,
      }),
    emptyMessage: 'No generated H2 content found. Generate H2 Content first.',
    successLabel: 'rating rows',
    upstreamDocId: scopedDocIds.h2ContentRows,
    pipelineSettingsDocId: scopedDocIds.h2RatingSettings,
  }), [scopedDocIds]);

  const htmlSource = useMemo(() => ({
    label: 'Sync from H2 Content',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildH2HtmlRowsFromFirestore({
        settingsDocId: scopedDocIds.h2HtmlSettings,
        fallbackPrompt: H2_HTML_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.h2ContentRows,
        ratingRowsDocId: scopedDocIds.h2RatingRows,
        persistedRowsDocId: scopedDocIds.h2HtmlRows,
        loadMode,
      }),
    emptyMessage: 'No generated H2 content found. Generate H2 Content first.',
    successLabel: 'HTML rows',
    upstreamDocId: scopedDocIds.h2ContentRows,
    additionalUpstreamDocIds: [scopedDocIds.h2RatingRows],
    pipelineSettingsDocId: scopedDocIds.h2HtmlSettings,
  }), [scopedDocIds]);

  const summarySource = useMemo(() => ({
    label: 'Sync from H2 Content',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildH2SummaryRowsFromFirestore({
        settingsDocId: scopedDocIds.h2SummarySettings,
        fallbackPrompt: H2_SUMMARY_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.h2ContentRows,
        persistedRowsDocId: scopedDocIds.h2SummaryRows,
        loadMode,
      }),
    emptyMessage: 'No generated H2 content found. Generate H2 Content first.',
    successLabel: 'summary rows',
    upstreamDocId: scopedDocIds.h2ContentRows,
    pipelineSettingsDocId: scopedDocIds.h2SummarySettings,
  }), [scopedDocIds]);

  const h1BodySource = useMemo(() => ({
    label: 'Sync from H2 Summ.',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildH1BodyRowsFromFirestore({
        settingsDocId: scopedDocIds.h1BodySettings,
        fallbackPrompt: H1_BODY_DEFAULT_PROMPT,
        pageRowsDocId: scopedDocIds.pageRows,
        summaryRowsDocId: scopedDocIds.h2SummaryRows,
        persistedRowsDocId: scopedDocIds.h1BodyRows,
        loadMode,
      }),
    emptyMessage: 'No generated H2 summaries found. Generate H2 Summ. first.',
    successLabel: 'H1 rows',
    upstreamDocId: scopedDocIds.pageRows,
    additionalUpstreamDocIds: [scopedDocIds.h2SummaryRows],
    pipelineSettingsDocId: scopedDocIds.h1BodySettings,
  }), [scopedDocIds]);

  const h1HtmlSource = useMemo(() => ({
    label: 'Sync from H1 Body',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildH1HtmlRowsFromFirestore({
        settingsDocId: scopedDocIds.h1HtmlSettings,
        fallbackPrompt: H1_HTML_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.h1BodyRows,
        persistedRowsDocId: scopedDocIds.h1HtmlRows,
        loadMode,
      }),
    emptyMessage: 'No generated H1 body rows found. Generate H1 Body first.',
    successLabel: 'H1 HTML rows',
    upstreamDocId: scopedDocIds.h1BodyRows,
    pipelineSettingsDocId: scopedDocIds.h1HtmlSettings,
  }), [scopedDocIds]);

  const quickAnswerSource = useMemo(() => ({
    label: 'Sync from H1 Body',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildQuickAnswerRowsFromFirestore({
        settingsDocId: scopedDocIds.quickAnswerSettings,
        fallbackPrompt: QUICK_ANSWER_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.h1BodyRows,
        persistedRowsDocId: scopedDocIds.quickAnswerRows,
        loadMode,
      }),
    emptyMessage: 'No generated H1 body rows found. Generate H1 Body first.',
    successLabel: 'quick answer rows',
    upstreamDocId: scopedDocIds.h1BodyRows,
    pipelineSettingsDocId: scopedDocIds.quickAnswerSettings,
  }), [scopedDocIds]);

  const quickAnswerHtmlSource = useMemo(() => ({
    label: 'Sync from Quick Answer',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildQuickAnswerHtmlRowsFromFirestore({
        settingsDocId: scopedDocIds.quickAnswerHtmlSettings,
        fallbackPrompt: QUICK_ANSWER_HTML_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.quickAnswerRows,
        persistedRowsDocId: scopedDocIds.quickAnswerHtmlRows,
        loadMode,
      }),
    emptyMessage: 'No generated quick answer rows found. Generate Quick Answer first.',
    successLabel: 'quick answer HTML rows',
    upstreamDocId: scopedDocIds.quickAnswerRows,
    pipelineSettingsDocId: scopedDocIds.quickAnswerHtmlSettings,
  }), [scopedDocIds]);

  const metasSlugCtasSource = useMemo(() => ({
    label: 'Sync from Quick Answer HTML',
    load: (loadMode?: ContentPipelineLoadMode) =>
      buildMetasSlugCtasRowsFromFirestore({
        settingsDocId: scopedDocIds.metasSlugCtasSettings,
        fallbackPrompt: META_DESCRIPTION_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.quickAnswerHtmlRows,
        persistedRowsDocId: scopedDocIds.metasSlugCtasRows,
        loadMode,
      }),
    emptyMessage: 'No generated quick answer HTML rows found. Generate Quick Answer HTML first.',
    successLabel: 'meta/slug/CTA rows',
    upstreamDocId: scopedDocIds.quickAnswerHtmlRows,
    pipelineSettingsDocId: scopedDocIds.metasSlugCtasSettings,
  }), [scopedDocIds]);

  const tipsRedflagsSource = useMemo(() => ({
    label: 'Sync from Metas/Slug/CTAs',
    load: () =>
      buildTipsRedflagsRowsFromFirestore({
        settingsDocId: scopedDocIds.tipsRedflagsSettings,
        fallbackPrompt: PRO_TIP_DEFAULT_PROMPT,
        sourceRowsDocId: scopedDocIds.metasSlugCtasRows,
        persistedRowsDocId: scopedDocIds.tipsRedflagsRows,
      }),
    emptyMessage: 'No Metas/Slug/CTAs rows found. Generate or sync Metas/Slug/CTAs first.',
    successLabel: 'pro tip/red flag/key takeaway rows',
    upstreamDocId: scopedDocIds.metasSlugCtasRows,
    pipelineSettingsDocId: scopedDocIds.tipsRedflagsSettings,
  }), [scopedDocIds]);

  useEffect(() => {
    if (!h2ContentRuntimeEffectsActive) return undefined;
    const recomputeRedoCount = async () => {
      const ratingRows = await loadPersistedRatingRowsFromFirestore(scopedDocIds.h2RatingRows);
      const nextCount = ratingRows.filter((row) => {
        const score = row.metadata?.ratingScore;
        return score === '3' || score === '4';
      }).length;
      setRedoCount(nextCount);
    };

    void recomputeRedoCount();

    const unsub = subscribeAppSettingsDoc({
      docId: scopedDocIds.h2RatingRows,
      channel: makeAppSettingsChannel('content-tab', scopedDocIds.h2RatingRows),
      onData: () => { void recomputeRedoCount(); },
      onError: () => { /* Generate surfaces already report snapshot errors */ },
    });
    return () => unsub();
  }, [h2ContentRuntimeEffectsActive, scopedDocIds.h2RatingRows]);

  const handleRedoLowRatedH2 = useCallback(async () => {
    try {
      const [h2Rows, ratingRows] = await Promise.all([
        loadH2ContentRowsFromFirestore(scopedDocIds.h2ContentRows),
        loadPersistedRatingRowsFromFirestore(scopedDocIds.h2RatingRows),
      ]);
      const lowRatedH2RowIds = new Set(
        ratingRows
          .filter((row) => row.metadata?.ratingScore === '3' || row.metadata?.ratingScore === '4')
          .map((row) => row.metadata?.h2ContentRowId)
          .filter((value): value is string => Boolean(value)),
      );

      if (lowRatedH2RowIds.size === 0) {
        addToast('No H2 rows are currently rated 3 or 4.', 'warning', {
          notification: {
            mode: 'none',
            source: 'content',
          },
        });
        return;
      }

      const updatedRows = h2Rows.map((row) => {
        if (!lowRatedH2RowIds.has(row.id)) return row;
        const nextMetadata = { ...(row.metadata ?? {}) };
        delete nextMetadata.ratingScore;
        return {
          ...row,
          status: 'pending',
          output: '',
          error: undefined,
          generatedAt: undefined,
          durationMs: undefined,
          retries: 0,
          promptTokens: undefined,
          completionTokens: undefined,
          cost: undefined,
          metadata: nextMetadata,
        };
      });

      await persistGenerateRowsDoc(scopedDocIds.h2ContentRows, updatedRows as Array<Record<string, unknown>>);
      addToast(`Reset ${lowRatedH2RowIds.size} H2 row${lowRatedH2RowIds.size === 1 ? '' : 's'} for rewrite.`, 'success', {
        notification: {
          mode: 'shared',
          source: 'content',
        },
      });
    } catch (err) {
      addToast(`Redo failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error', {
        notification: {
          mode: 'shared',
          source: 'content',
        },
      });
    }
  }, [addToast, scopedDocIds.h2ContentRows, scopedDocIds.h2RatingRows]);

  if (!activeProjectId) {
    return (
      <div className="max-w-4xl mx-auto mt-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold text-zinc-800">Content</div>
        <div className="mt-1 text-sm text-zinc-500">Select a project to open the shared Content workspace.</div>
      </div>
    );
  }

  if (workspaceError) {
    return (
      <div className="max-w-4xl mx-auto mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold text-amber-900">Content unavailable</div>
        <div className="mt-1 text-sm text-amber-800">{workspaceError}</div>
      </div>
    );
  }

  if (!workspaceReady) {
    return (
      <div className="max-w-4xl mx-auto mt-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold text-zinc-800">Content</div>
        <div className="mt-1 text-sm text-zinc-500">Preparing the shared project workspace...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto mt-1 space-y-1.5">
      {/* Single column: shell (view tabs) + optional H2 instance â€” one max-width, same rhythm as GenerateTabInstance internals */}
      <GenerateTabInstance
        runtimeEffectsActive={pageNamesRuntimeEffectsActive}
        storageKey="_page_names"
        starredModels={starredModels}
        onToggleStar={onToggleStar}
        defaultPrompt={PAGE_NAMES_DEFAULT_PROMPT}
        promptSlots={[H2_NAMES_SLOT, H2_QA_SLOT, PAGE_GUIDELINES_SLOT]}
        primaryPromptLabel="Pages"
        primaryPromptIcon={<FileText className="w-3.5 h-3.5" />}
        extraColumns={PAGE_NAMES_EXTRA_COLUMNS}
        externalViewTabsBeforePrimary={[CONTENT_OVERVIEW_TAB]}
        externalViewTabs={H2_CONTENT_VIEW_TABS}
        activeExternalView={externalView}
        onExternalViewSelect={handleExternalViewSelect}
        controlledTableView={pagesTableView}
        onTableViewChange={handlePagesTableViewChange}
        rootLayout="flush"
        primaryColumnPreset="compact"
        onBusyStateChange={contentInstanceBusyHandlers.page_names}
        {...sharedContentPanelProps}
      />

      <div data-testid="content-panel-overview" style={{ display: externalView === 'overview' ? undefined : 'none' }}>
        <ContentOverviewPanel
          activeProjectId={activeProjectId}
          onStageSelect={(stageId) => handleContentSubtabSelect(mapOverviewStageIdToContentSubtab(stageId))}
        />
      </div>

      <div
        data-testid="content-panel-h2-content"
        className="space-y-1.5"
        style={{ display: externalView === 'h2-content' ? undefined : 'none' }}
      >
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm px-4 py-2 flex items-center justify-between gap-2.5">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Low-Rating Rewrite</h3>
            <p className="text-[11px] text-zinc-500">Rows rated 3 or 4 are considered rewrite candidates and can be reset in bulk here.</p>
          </div>
          <button
            onClick={handleRedoLowRatedH2}
            data-testid="redo-rated-3-4"
            disabled={redoCount === 0}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${redoCount > 0 ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100' : 'bg-zinc-100 border-zinc-200 text-zinc-400 cursor-not-allowed'}`}
            title={redoCount > 0 ? `Reset ${redoCount} H2 row${redoCount === 1 ? '' : 's'} rated 3 or 4 back to pending` : 'No H2 rows are currently rated 3 or 4'}
          >
            Redo Rated 3/4 ({redoCount})
          </button>
        </div>
        <GenerateTabInstance
          runtimeEffectsActive={h2ContentRuntimeEffectsActive}
          storageKey="_h2_content"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={H2_CONTENT_DEFAULT_PROMPT}
          primaryPromptLabel="H2 Body"
          extraColumns={H2_CONTENT_EXTRA_COLUMNS}
          populateFromSource={h2ContentSource}
          rootLayout="flush"
          showSyncButton={false}
          primaryColumnPreset="compact"
          onBusyStateChange={contentInstanceBusyHandlers.h2_content}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-rating" style={{ display: externalView === 'rating' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={ratingRuntimeEffectsActive}
          storageKey="_h2_rating"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={H2_RATING_DEFAULT_PROMPT}
          primaryPromptLabel="H2 Rate Prompt"
          extraColumns={H2_RATING_EXTRA_COLUMNS}
          populateFromSource={ratingSource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Rate"
          primaryOutputHeaderLabel="Rating Explanation"
          responseFormat="json_object"
          transformPrimaryOutput={({ rawOutput }) => parseRatingModelOutput(rawOutput)}
          clearMetadataKeysOnReset={['ratingScore']}
          onBusyStateChange={contentInstanceBusyHandlers.h2_rating}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-h2-html" style={{ display: externalView === 'h2-html' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={h2HtmlRuntimeEffectsActive}
          storageKey="_h2_html"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={H2_HTML_DEFAULT_PROMPT}
          primaryPromptLabel="H2 Body HTML Prompt"
          extraColumns={[
            { key: 'pageName', label: 'Page Name', width: 'w-[88px]', compact: true },
            { key: 'h2Name', label: 'H2 Name', width: 'w-[112px]', compact: true },
            { key: 'h2Content', label: 'H2 Content', width: 'w-[176px]' },
            { key: H2_HTML_VALIDATION_STATUS_KEY, label: 'Validate', width: 'w-[72px]', compact: true },
          ]}
          populateFromSource={htmlSource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Generate HTML"
          primaryOutputHeaderLabel="Output (HTML)"
          lockMetadataKey={H2_HTML_LOCK_REASON_KEY}
          transformPrimaryOutput={({ rawOutput }) => validateGeneratedHtmlOutput(rawOutput)}
          onBusyStateChange={contentInstanceBusyHandlers.h2_html}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-h2-summary" style={{ display: externalView === 'h2-summary' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={h2SummaryRuntimeEffectsActive}
          storageKey="_h2_summary"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={H2_SUMMARY_DEFAULT_PROMPT}
          primaryPromptLabel="H2 Summary Prompt"
          extraColumns={H2_SUMMARY_EXTRA_COLUMNS}
          populateFromSource={summarySource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Generate Summary"
          primaryOutputHeaderLabel="Summary"
          primaryColumnPreset="compact"
          onBusyStateChange={contentInstanceBusyHandlers.h2_summary}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-h1-body" style={{ display: externalView === 'h1-body' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={h1BodyRuntimeEffectsActive}
          storageKey="_h1_body"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={H1_BODY_DEFAULT_PROMPT}
          primaryPromptLabel="H1 Body Prompt"
          extraColumns={H1_BODY_EXTRA_COLUMNS}
          populateFromSource={h1BodySource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Generate H1"
          primaryOutputHeaderLabel="H1 Body"
          primaryColumnPreset="compact"
          onBusyStateChange={contentInstanceBusyHandlers.h1_body}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-h1-html" style={{ display: externalView === 'h1-html' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={h1HtmlRuntimeEffectsActive}
          storageKey="_h1_html"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={H1_HTML_DEFAULT_PROMPT}
          primaryPromptLabel="H1 Body HTML Prompt"
          extraColumns={[
            ...H1_HTML_EXTRA_COLUMNS,
            { key: H2_HTML_VALIDATION_STATUS_KEY, label: 'Validate', width: 'w-[72px]', compact: true },
          ]}
          populateFromSource={h1HtmlSource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Generate HTML"
          primaryOutputHeaderLabel="Output (HTML)"
          transformPrimaryOutput={({ rawOutput }) => validateGeneratedHtmlOutput(rawOutput)}
          primaryColumnPreset="compact"
          onBusyStateChange={contentInstanceBusyHandlers.h1_html}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-quick-answer" style={{ display: externalView === 'quick-answer' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={quickAnswerRuntimeEffectsActive}
          storageKey="_quick_answer"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={QUICK_ANSWER_DEFAULT_PROMPT}
          primaryPromptLabel="Quick Answer Prompt"
          extraColumns={QUICK_ANSWER_EXTRA_COLUMNS}
          populateFromSource={quickAnswerSource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Generate Quick Answer"
          primaryOutputHeaderLabel="Quick Answer"
          primaryColumnPreset="compact"
          onBusyStateChange={contentInstanceBusyHandlers.quick_answer}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-quick-answer-html" style={{ display: externalView === 'quick-answer-html' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={quickAnswerHtmlRuntimeEffectsActive}
          storageKey="_quick_answer_html"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={QUICK_ANSWER_HTML_DEFAULT_PROMPT}
          primaryPromptLabel="Quick Answer HTML Prompt"
          extraColumns={[
            ...QUICK_ANSWER_HTML_EXTRA_COLUMNS,
            { key: H2_HTML_VALIDATION_STATUS_KEY, label: 'Validate', width: 'w-[72px]', compact: true },
          ]}
          populateFromSource={quickAnswerHtmlSource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Generate HTML"
          primaryOutputHeaderLabel="Output (HTML)"
          transformPrimaryOutput={({ rawOutput }) => validateGeneratedHtmlOutput(rawOutput)}
          primaryColumnPreset="compact"
          onBusyStateChange={contentInstanceBusyHandlers.quick_answer_html}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-metas-slug-ctas" style={{ display: externalView === 'metas-slug-ctas' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={metasSlugCtasRuntimeEffectsActive}
          storageKey="_metas_slug_ctas"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={META_DESCRIPTION_DEFAULT_PROMPT}
          promptSlots={[META_SLUG_SLOT, META_CTA_SLOT]}
          primaryPromptLabel="Meta Description"
          extraColumns={METAS_SLUG_CTAS_EXTRA_COLUMNS}
          populateFromSource={metasSlugCtasSource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Generate Metas"
          primaryOutputHeaderLabel="Meta Description"
          primaryColumnPreset="compact"
          onBusyStateChange={contentInstanceBusyHandlers.metas_slug_ctas}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-tips-redflags" style={{ display: externalView === 'tips-redflags' ? undefined : 'none' }}>
        <GenerateTabInstance
          runtimeEffectsActive={tipsRedflagsRuntimeEffectsActive}
          storageKey="_tips_redflags"
          logsStorageKey="_page_names"
          sharedSelectedModelStorageKey="_page_names"
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          defaultPrompt={PRO_TIP_DEFAULT_PROMPT}
          promptSlots={[RED_FLAG_SLOT, KEY_TAKEAWAYS_SLOT]}
          primaryPromptLabel="Pro Tip"
          extraColumns={TIPS_REDFLAGS_EXTRA_COLUMNS}
          populateFromSource={tipsRedflagsSource}
          rootLayout="flush"
          showSyncButton={false}
          generateButtonLabel="Generate Pro Tip"
          primaryOutputHeaderLabel="Pro Tip"
          primaryColumnPreset="compact"
          onBusyStateChange={contentInstanceBusyHandlers.tips_redflags}
          {...sharedContentPanelProps}
        />
      </div>

      <div data-testid="content-panel-final-pages" style={{ display: externalView === 'final-pages' ? undefined : 'none' }}>
        <FinalPagesPanel activeProjectId={activeProjectId} onSourceSelect={handleContentSubtabSelect} />
      </div>
    </div>
  );
}
