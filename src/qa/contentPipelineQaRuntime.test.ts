import { describe, expect, it } from 'vitest';

import { parseScenarioKey } from './contentPipelineQaRuntime';

describe('contentPipelineQaRuntime parseScenarioKey', () => {
  it('extracts the actual scenario and doc id from QA doc storage keys', () => {
    expect(
      parseScenarioKey(
        'kwg:qa:content-pipeline:doc',
        'kwg:qa:content-pipeline:doc:two-session-collab:generate_rows_h2_content',
      ),
    ).toEqual({
      scenario: 'two-session-collab',
      name: 'generate_rows_h2_content',
    });
  });

  it('extracts the actual scenario and cache key from QA cache storage keys', () => {
    expect(
      parseScenarioKey(
        'kwg:qa:content-pipeline:cache',
        'kwg:qa:content-pipeline:cache:two-session-collab:__app_settings__:project_qa-content-project__generate_rows_h2_content',
      ),
    ).toEqual({
      scenario: 'two-session-collab',
      name: '__app_settings__:project_qa-content-project__generate_rows_h2_content',
    });
  });

  it('rejects keys outside the requested QA storage prefix', () => {
    expect(
      parseScenarioKey(
        'kwg:qa:content-pipeline:doc',
        'kwg:qa:content-pipeline:cache:two-session-collab:generate_rows_h2_content',
      ),
    ).toBeNull();
  });
});
