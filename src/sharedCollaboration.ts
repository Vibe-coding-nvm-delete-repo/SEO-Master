import type { CloudSyncChannelId } from './cloudSyncStatus';

export type SharedScope =
  | 'global_shared'
  | 'project_metadata'
  | 'project_group_v2'
  | 'project_generate_content'
  | 'auxiliary';

export type SharedChannelKind =
  | 'project_collection'
  | 'project_metadata'
  | 'project_folders'
  | 'workspace_preferences'
  | 'app_settings_doc'
  | 'app_settings_rows'
  | 'app_settings_logs'
  | 'app_settings_settings'
  | 'app_settings_pipeline_settings'
  | 'project_v2_canonical'
  | 'project_v2_entity'
  | 'project_v2_listener'
  | 'auxiliary_cache'
  | 'auxiliary_feed';

export type SharedOptimisticPolicy = 'after_accept' | 'local_cache_only';
export type SharedRecoveryPolicy = 'reload_authoritative' | 'operation_lock' | 'local_cache_fallback' | 'noop';
export type SharedListenerEchoPolicy = 'suppress_pending_writes' | 'self_filter' | 'not_applicable';

export interface SharedActionRegistryEntry {
  id: string;
  label: string;
  scope: SharedScope;
  channelKind: SharedChannelKind;
  storageChannel: string;
  listenerChannel?: CloudSyncChannelId | null;
  userVisibleSharedState: boolean;
  optimisticPolicy: SharedOptimisticPolicy;
  listenerEchoPolicy: SharedListenerEchoPolicy;
  recovery: SharedRecoveryPolicy;
  testIds: {
    contract: string;
    browser: string;
    rules?: string;
  };
}

export type FirestoreCallsiteClassificationStatus =
  | 'contract_managed'
  | 'to_migrate'
  | 'out_of_scope_non_collab'
  | 'internal_admin_or_support'
  | 'test_or_qa_only';

export interface FirestoreCallsiteClassification {
  path: string;
  line: number;
  operation: string;
  status: FirestoreCallsiteClassificationStatus;
  featureOwner: string;
  purpose: string;
  scope: SharedScope | 'out_of_scope' | 'test_only';
  userVisibleSharedState: boolean;
  migrationLane:
    | 'group_project_v2'
    | 'project_metadata'
    | 'shared_app_settings'
    | 'generate_content'
    | 'support'
    | 'tests'
    | 'none';
}

const registryEntries = {
  projectCollection: {
    id: 'project.collection',
    label: 'Projects list',
    scope: 'project_metadata',
    channelKind: 'project_collection',
    storageChannel: 'projects/*',
    listenerChannel: 'projects',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'reload_authoritative',
    testIds: {
      contract: 'projects-collection-converges',
      browser: 'projects-collection-two-session',
    },
  },
  projectMetadata: {
    id: 'project.metadata',
    label: 'Project metadata',
    scope: 'project_metadata',
    channelKind: 'project_metadata',
    storageChannel: 'projects/{projectId}',
    listenerChannel: 'projects',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'reload_authoritative',
    testIds: {
      contract: 'project-metadata-converges',
      browser: 'project-metadata-two-session',
    },
  },
  projectFolders: {
    id: 'project.folders',
    label: 'Project folders',
    scope: 'project_metadata',
    channelKind: 'project_folders',
    storageChannel: 'app_settings/project_folders',
    listenerChannel: 'project_folders',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'reload_authoritative',
    testIds: {
      contract: 'project-folders-converges',
      browser: 'project-folders-two-session',
    },
  },
  workspacePreferences: {
    id: 'workspace.preferences',
    label: 'Workspace preferences',
    scope: 'global_shared',
    channelKind: 'workspace_preferences',
    storageChannel: 'app_settings/user_preferences',
    listenerChannel: 'user_preferences',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'workspace-preferences-converges',
      browser: 'workspace-preferences-two-session',
    },
  },
  groupReviewSettings: {
    id: 'settings.group_review',
    label: 'Group review settings',
    scope: 'global_shared',
    channelKind: 'app_settings_doc',
    storageChannel: 'app_settings/group_review_settings',
    listenerChannel: 'group_review_settings',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'group-review-settings-converges',
      browser: 'group-review-settings-two-session',
    },
  },
  autoGroupSettings: {
    id: 'settings.autogroup',
    label: 'Auto Group settings',
    scope: 'global_shared',
    channelKind: 'app_settings_doc',
    storageChannel: 'app_settings/autogroup_settings',
    listenerChannel: 'autogroup_settings',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'autogroup-settings-converges',
      browser: 'autogroup-settings-two-session',
    },
  },
  topicsLoans: {
    id: 'settings.topics_loans',
    label: 'Topics library',
    scope: 'global_shared',
    channelKind: 'app_settings_doc',
    storageChannel: 'app_settings/topics_loans',
    listenerChannel: 'topics_loans',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'topics-library-converges',
      browser: 'topics-library-two-session',
    },
  },
  starredModels: {
    id: 'settings.starred_models',
    label: 'Starred models',
    scope: 'global_shared',
    channelKind: 'app_settings_doc',
    storageChannel: 'app_settings/starred_models',
    listenerChannel: 'starred_models',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'starred-models-converges',
      browser: 'starred-models-two-session',
    },
  },
  universalBlocked: {
    id: 'settings.universal_blocked',
    label: 'Universal blocked tokens',
    scope: 'global_shared',
    channelKind: 'app_settings_doc',
    storageChannel: 'app_settings/universal_blocked',
    listenerChannel: 'universal_blocked',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'universal-blocked-converges',
      browser: 'universal-blocked-two-session',
    },
  },
  generateRows: {
    id: 'generate.rows',
    label: 'Generate rows',
    scope: 'project_generate_content',
    channelKind: 'app_settings_rows',
    storageChannel: 'app_settings/generate_rows*',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'suppress_pending_writes',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'generate-rows-converges',
      browser: 'generate-rows-two-session',
    },
  },
  generateLogs: {
    id: 'generate.logs',
    label: 'Generate logs',
    scope: 'project_generate_content',
    channelKind: 'app_settings_logs',
    storageChannel: 'app_settings/generate_logs*',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'suppress_pending_writes',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'generate-logs-converges',
      browser: 'generate-logs-two-session',
    },
  },
  generateSettings: {
    id: 'generate.settings',
    label: 'Generate settings',
    scope: 'project_generate_content',
    channelKind: 'app_settings_settings',
    storageChannel: 'app_settings/generate_settings*',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'suppress_pending_writes',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'generate-settings-converges',
      browser: 'generate-settings-two-session',
    },
  },
  generatePipelineSettings: {
    id: 'generate.pipeline_settings',
    label: 'Generate pipeline settings',
    scope: 'project_generate_content',
    channelKind: 'app_settings_pipeline_settings',
    storageChannel: 'app_settings/generate_pipeline_settings*',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'suppress_pending_writes',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'generate-pipeline-settings-converges',
      browser: 'generate-pipeline-settings-two-session',
    },
  },
  cosineSummaries: {
    id: 'autogroup.cosine_cache',
    label: 'Cosine summary cache',
    scope: 'auxiliary',
    channelKind: 'auxiliary_cache',
    storageChannel: 'app_settings/kwg_cosine_summaries_*',
    userVisibleSharedState: false,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'local_cache_fallback',
    testIds: {
      contract: 'cosine-cache-converges',
      browser: 'cosine-cache-two-session',
    },
  },
  projectV2Canonical: {
    id: 'project_v2.canonical',
    label: 'Shared project canonical state',
    scope: 'project_group_v2',
    channelKind: 'project_v2_canonical',
    storageChannel: 'projects/{projectId}/base_commits/*',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'self_filter',
    recovery: 'operation_lock',
    testIds: {
      contract: 'project-v2-canonical-converges',
      browser: 'project-v2-two-session',
      rules: 'project-v2-canonical-rules',
    },
  },
  projectV2Entity: {
    id: 'project_v2.entity',
    label: 'Shared project entity doc',
    scope: 'project_group_v2',
    channelKind: 'project_v2_entity',
    storageChannel: 'projects/{projectId}/{entity}/*',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'self_filter',
    recovery: 'reload_authoritative',
    testIds: {
      contract: 'project-v2-entity-converges',
      browser: 'project-v2-two-session',
      rules: 'project-v2-entity-rules',
    },
  },
  projectV2Listener: {
    id: 'project_v2.listener',
    label: 'Shared project listener',
    scope: 'project_group_v2',
    channelKind: 'project_v2_listener',
    storageChannel: 'projects/{projectId}/listeners/*',
    userVisibleSharedState: true,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'self_filter',
    recovery: 'reload_authoritative',
    testIds: {
      contract: 'project-v2-listener-converges',
      browser: 'project-v2-two-session',
      rules: 'project-v2-listener-rules',
    },
  },
  feedback: {
    id: 'support.feedback',
    label: 'Feedback',
    scope: 'auxiliary',
    channelKind: 'auxiliary_feed',
    storageChannel: 'feedback/*',
    listenerChannel: 'feedback',
    userVisibleSharedState: false,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'noop',
    testIds: {
      contract: 'feedback-channel-covered',
      browser: 'feedback-modal-flow',
    },
  },
  notifications: {
    id: 'support.notifications',
    label: 'Notifications',
    scope: 'auxiliary',
    channelKind: 'auxiliary_feed',
    storageChannel: 'notifications/*',
    listenerChannel: 'notifications',
    userVisibleSharedState: false,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'noop',
    testIds: {
      contract: 'notifications-channel-covered',
      browser: 'notifications-tab-flow',
    },
  },
  changelog: {
    id: 'support.changelog',
    label: 'Changelog',
    scope: 'auxiliary',
    channelKind: 'auxiliary_feed',
    storageChannel: 'changelog/*',
    listenerChannel: 'changelog',
    userVisibleSharedState: false,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'noop',
    testIds: {
      contract: 'changelog-channel-covered',
      browser: 'updates-tab-flow',
    },
  },
  buildInfo: {
    id: 'support.build_info',
    label: 'Build info',
    scope: 'auxiliary',
    channelKind: 'auxiliary_feed',
    storageChannel: 'build_info/current',
    listenerChannel: 'build_info',
    userVisibleSharedState: false,
    optimisticPolicy: 'after_accept',
    listenerEchoPolicy: 'not_applicable',
    recovery: 'noop',
    testIds: {
      contract: 'build-info-channel-covered',
      browser: 'updates-tab-flow',
    },
  },
} as const satisfies Record<string, SharedActionRegistryEntry>;

export const SHARED_ACTION_REGISTRY = Object.freeze(registryEntries);
export type SharedActionId = (typeof registryEntries)[keyof typeof registryEntries]['id'];

const GLOBAL_APP_SETTINGS_DOC_IDS = new Map<string, SharedActionRegistryEntry>([
  ['group_review_settings', registryEntries.groupReviewSettings],
  ['autogroup_settings', registryEntries.autoGroupSettings],
  ['topics_loans', registryEntries.topicsLoans],
  ['starred_models', registryEntries.starredModels],
  ['universal_blocked', registryEntries.universalBlocked],
  ['user_preferences', registryEntries.workspacePreferences],
  ['project_folders', registryEntries.projectFolders],
]);

const LEGACY_GENERATE_DOC_PREFIXES = [
  'generate_rows',
  'generate_logs',
  'generate_settings',
];

export type AppSettingsRegistryKind =
  | 'doc'
  | 'rows'
  | 'logs'
  | 'settings'
  | 'shared-selected-model'
  | 'upstream'
  | 'pipeline-settings'
  | 'cosine'
  | 'overview'
  | 'final-pages'
  | 'content-tab';

export function getSharedActionRegistryEntry(id: SharedActionId): SharedActionRegistryEntry {
  const entry = Object.values(registryEntries).find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown shared action id "${id}".`);
  return entry;
}

export function isProjectScopedDocId(docId: string): boolean {
  return /^project_[^_].+?__.+/.test(docId);
}

function isGenerateContentDocId(docId: string): boolean {
  return LEGACY_GENERATE_DOC_PREFIXES.some((prefix) => docId.startsWith(prefix));
}

function isCosineCacheDocId(docId: string): boolean {
  return docId.startsWith('kwg_cosine_summaries_');
}

export function resolveAppSettingsRegistryEntry(docId: string, kind: AppSettingsRegistryKind): SharedActionRegistryEntry | null {
  const globalDoc = GLOBAL_APP_SETTINGS_DOC_IDS.get(docId);
  if (globalDoc) return globalDoc;

  if (isCosineCacheDocId(docId) || kind === 'cosine') {
    return registryEntries.cosineSummaries;
  }

  if (isProjectScopedDocId(docId) || isGenerateContentDocId(docId)) {
    if (kind === 'rows' || docId.includes('generate_rows')) return registryEntries.generateRows;
    if (kind === 'logs' || docId.includes('generate_logs')) return registryEntries.generateLogs;
    if (kind === 'pipeline-settings' || kind === 'upstream' || kind === 'overview' || kind === 'final-pages' || kind === 'content-tab') {
      return registryEntries.generatePipelineSettings;
    }
    return registryEntries.generateSettings;
  }

  return null;
}

export function requireAppSettingsRegistryEntry(docId: string, kind: AppSettingsRegistryKind): SharedActionRegistryEntry {
  const entry = resolveAppSettingsRegistryEntry(docId, kind);
  if (entry) return entry;
  throw new Error(`Unregistered app settings ${kind} doc "${docId}". Register the shared action before using Firestore sync.`);
}
