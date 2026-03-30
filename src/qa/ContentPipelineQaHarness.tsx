import React, { useEffect, useMemo, useState } from 'react';
import AppStatusBar from '../AppStatusBar';
import ContentTab from '../ContentTab';
import { appSettingsIdbKey } from '../appSettingsPersistence';
import { deleteFromIDB } from '../projectStorage';
import {
  getContentPipelineQaScenario,
  QA_PROJECT_ID,
  getQaSharedApiKey,
  resetContentPipelineQaRuntime,
} from './contentPipelineQaRuntime';

const SHARED_API_KEY_CACHE_KEY = 'kwg_generate_cache:apiKeyShared';

const QA_DOC_IDS = [
  'generate_rows_page_names',
  'generate_rows_h2_content',
  'generate_rows_h2_rating',
  'generate_rows_h2_html',
  'generate_rows_h2_summary',
  'generate_rows_h1_body',
  'generate_rows_h1_html',
  'generate_rows_quick_answer',
  'generate_rows_quick_answer_html',
  'generate_rows_metas_slug_ctas',
  'generate_rows_tips_redflags',
  'generate_logs_page_names',
  'generate_settings_page_names',
  'generate_settings_h2_content',
  'generate_settings_h2_rating',
  'generate_settings_h2_html',
  'generate_settings_h2_summary',
  'generate_settings_h1_body',
  'generate_settings_h1_html',
  'generate_settings_quick_answer',
  'generate_settings_quick_answer_html',
  'generate_settings_metas_slug_ctas',
  'generate_settings_tips_redflags',
  'generate_view_state_page_names',
  'generate_view_state_h2_content',
  'generate_view_state_h2_rating',
  'generate_view_state_h2_html',
  'generate_view_state_h2_summary',
  'generate_view_state_h1_body',
  'generate_view_state_h1_html',
  'generate_view_state_quick_answer',
  'generate_view_state_quick_answer_html',
  'generate_view_state_metas_slug_ctas',
  'generate_view_state_tips_redflags',
];

export default function ContentPipelineQaHarness() {
  const [ready, setReady] = useState(false);
  const [starredModels, setStarredModels] = useState<Set<string>>(() => new Set(['openrouter/qa-model']));
  const scenario = useMemo(() => getContentPipelineQaScenario(), []);

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      resetContentPipelineQaRuntime(scenario);
      const localKeys = Object.keys(localStorage).filter(
        (key) => key.startsWith('kwg_generate_cache:') || key.startsWith('__app_settings__:'),
      );
      for (const key of localKeys) localStorage.removeItem(key);
      await Promise.all(QA_DOC_IDS.map((docId) => deleteFromIDB(appSettingsIdbKey(docId)).catch(() => undefined)));
      localStorage.setItem(SHARED_API_KEY_CACHE_KEY, getQaSharedApiKey());
      if (alive) setReady(true);
    };
    void bootstrap();
    return () => {
      alive = false;
    };
  }, [scenario]);

  if (!ready) {
    return (
      <div className="max-w-4xl mx-auto mt-6 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 shadow-sm">
        Preparing content pipeline QA harness...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-3 py-2">
      <AppStatusBar activeProjectId={null} />
      <ContentTab
        activeProjectId={QA_PROJECT_ID}
        starredModels={starredModels}
        onToggleStar={(modelId) => {
          setStarredModels((prev) => {
            const next = new Set(prev);
            if (next.has(modelId)) next.delete(modelId);
            else next.add(modelId);
            return next;
          });
        }}
      />
    </div>
  );
}
