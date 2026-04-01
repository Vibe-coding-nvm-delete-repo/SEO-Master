import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Folder, FolderPlus, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Project, ProjectFolder } from './types';
import {
  LS_PROJECT_FOLDERS_KEY,
  PROJECT_FOLDERS_FS_DOC,
} from './projectStorage';
import {
  effectiveProjectFolderId,
  newFolderId,
  parseProjectFoldersFromFirestore,
} from './projectFoldersUtils';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
} from './cloudSyncStatus';
import { reportPersistFailure } from './persistenceErrors';
import ProjectsTabProjectCard, { PROJECT_DRAG_MIME } from './ProjectsTabProjectCard';
import {
  appSettingsIdbKey,
  cacheStateLocallyBestEffort,
  subscribeAppSettingsDoc,
} from './appSettingsPersistence';
import {
  assignProjectsToFolder,
  persistProjectFolders,
  persistProjectMetadata,
} from './projectMetadataCollab';

type ToastFn = (msg: string, type?: 'error' | 'success' | 'info') => void;

export interface ProjectsTabProps {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  activeProjectId: string | null;
  selectProject: (id: string) => void | Promise<void>;
  deleteProject: (id: string) => void | Promise<void>;
  reviveProject: (id: string) => void | Promise<void>;
  permanentlyDeleteProject: (id: string) => void | Promise<void>;
  createProject: () => void | Promise<void>;
  isCreatingProject: boolean;
  setIsCreatingProject: (v: boolean) => void;
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  newProjectDescription: string;
  setNewProjectDescription: (v: string) => void;
  projectError: string | null;
  isProjectLoading: boolean;
  addToast: ToastFn;
}

export default function ProjectsTab({
  projects,
  setProjects,
  activeProjectId,
  selectProject,
  deleteProject,
  reviveProject,
  permanentlyDeleteProject,
  createProject,
  isCreatingProject,
  setIsCreatingProject,
  newProjectName,
  setNewProjectName,
  newProjectDescription,
  setNewProjectDescription,
  projectError,
  isProjectLoading,
  addToast,
}: ProjectsTabProps) {
  const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>(() => {
    try {
      const cached = localStorage.getItem(LS_PROJECT_FOLDERS_KEY);
      if (cached) {
        const parsed = parseProjectFoldersFromFirestore(JSON.parse(cached));
        if (parsed.length > 0) return parsed;
      }
    } catch {
      /* ignore */
    }
    return [];
  });
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [showDeleted, setShowDeleted] = useState(false);
  const projectsRef = useRef(projects);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const unsub = subscribeAppSettingsDoc({
      docId: PROJECT_FOLDERS_FS_DOC,
      channel: CLOUD_SYNC_CHANNELS.projectFolders,
      onData: (snap) => {
        if (!snap.exists()) {
          setProjectFolders([]);
          return;
        }
        const data = snap.data();
        const nextFolders = parseProjectFoldersFromFirestore(data?.folders);
        cacheStateLocallyBestEffort({
          idbKey: appSettingsIdbKey(PROJECT_FOLDERS_FS_DOC),
          value: { folders: nextFolders, updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : new Date().toISOString() },
          localStorageKey: LS_PROJECT_FOLDERS_KEY,
        });
        setProjectFolders(nextFolders);
      },
      onError: (err) => {
        markListenerError(CLOUD_SYNC_CHANNELS.projectFolders);
        reportPersistFailure(addToast, 'project folders sync', err);
      },
    });
    return () => {
      clearListenerError(CLOUD_SYNC_CHANNELS.projectFolders);
      if (typeof unsub === 'function') unsub();
    };
  }, [addToast]);

  const validFolderIds = useMemo(() => new Set(projectFolders.map((f) => f.id)), [projectFolders]);

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  const deletedProjects = useMemo(
    () => projects.filter((p) => !!p.deletedAt).sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || '')),
    [projects],
  );

  const projectsInFolder = useCallback(
    (folderId: string | null) =>
      activeProjects.filter((p) => effectiveProjectFolderId(p, validFolderIds) === folderId),
    [activeProjects, validFolderIds],
  );

  const moveProjectToFolder = async (projectId: string, folderId: string | null) => {
    const proj = projectsRef.current.find((p) => p.id === projectId);
    if (!proj || proj.deletedAt) return;
    const next: Project = { ...proj, folderId };
    try {
      await persistProjectMetadata(next);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? next : p)));
    } catch (err) {
      reportPersistFailure(addToast, 'move project to folder', err);
    }
  };

  const renameProject = async (projectId: string, name: string) => {
    const proj = projectsRef.current.find((p) => p.id === projectId);
    if (!proj || proj.deletedAt) return;
    const next: Project = { ...proj, name };
    try {
      await persistProjectMetadata(next);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? next : p)));
    } catch (err) {
      reportPersistFailure(addToast, 'rename project', err);
      throw err;
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const id = newFolderId();
    const order = projectFolders.length === 0 ? 0 : Math.max(...projectFolders.map((f) => f.order)) + 1;
    const next = [...projectFolders, { id, name, order }];
    try {
      await persistProjectFolders(next);
      setProjectFolders(next);
    } catch (err) {
      reportPersistFailure(addToast, 'create folder', err);
    }
    setNewFolderName('');
  };

  const handleRenameFolder = async (folderId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = projectFolders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f));
    try {
      await persistProjectFolders(next);
      setProjectFolders(next);
    } catch (err) {
      reportPersistFailure(addToast, 'rename folder', err);
    }
  };

  const handleRemoveFolder = async (folderId: string) => {
    if (
      !window.confirm(
        'Remove this folder? Projects inside will stay in your library — they move back to Unassigned.',
      )
    )
      return;
    const ids = projects.filter((p) => !p.deletedAt && p.folderId === folderId).map((p) => p.id);
    const nextFolders = projectFolders.filter((f) => f.id !== folderId);
    try {
      await persistProjectFolders(nextFolders);
      await assignProjectsToFolder(ids, null);
      setProjectFolders(nextFolders);
      setProjects((prev) =>
        prev.map((p) => (p.folderId === folderId && !p.deletedAt ? { ...p, folderId: null } : p)),
      );
    } catch (err) {
      reportPersistFailure(addToast, 'remove folder', err);
    }
  };

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const onDragOver = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverTarget !== targetKey) setDragOverTarget(targetKey);
  };

  const onDragLeave = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (dragOverTarget === targetKey) setDragOverTarget(null);
  };

  const onDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverTarget(null);
    const pid = e.dataTransfer.getData(PROJECT_DRAG_MIME);
    if (!pid) return;
    await moveProjectToFolder(pid, folderId);
  };

  const renderProjectCard = (p: Project) => (
    <ProjectsTabProjectCard
      project={p}
      activeProjectId={activeProjectId}
      effectiveFolderId={effectiveProjectFolderId(p, validFolderIds)}
      projectFolders={projectFolders}
      selectProject={selectProject}
      deleteProject={deleteProject}
      renameProject={renameProject}
      moveProjectToFolder={moveProjectToFolder}
      addToast={addToast}
    />
  );

  const dropClass = (key: string) =>
    `rounded-xl border-2 border-dashed transition-colors min-h-[48px] p-1 ${
      dragOverTarget === key ? 'border-indigo-400 bg-indigo-50/40' : 'border-zinc-200/80 bg-transparent'
    }`;

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">Projects</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFolderInput((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 border border-zinc-200 transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Folder
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingProject(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </button>
        </div>
      </div>

      {/* Inline folder creation */}
      {showFolderInput && (
        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <input
            autoFocus
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="flex-1 px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleCreateFolder();
                setShowFolderInput(false);
              }
              if (e.key === 'Escape') setShowFolderInput(false);
            }}
          />
          <button
            type="button"
            onClick={() => {
              void handleCreateFolder();
              setShowFolderInput(false);
            }}
            disabled={!newFolderName.trim()}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-100 text-zinc-800 hover:bg-zinc-200 border border-zinc-200 disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setShowFolderInput(false)}
            className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-600"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Create project form */}
      {isCreatingProject && (
        <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-md animate-in zoom-in-95 duration-200">
          <h3 className="text-sm font-semibold text-zinc-900 mb-3">Create New Project</h3>

          {projectError && (
            <div className="mb-3 p-2.5 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-xs">
              <AlertCircle className="w-3.5 h-3.5" />
              {projectError}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Project Name</label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g., Q1 SEO Strategy"
                className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Description (Optional)</label>
              <textarea
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="What is this project about?"
                className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all h-16 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreatingProject(false)}
                className="px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createProject()}
                disabled={!newProjectName.trim() || isProjectLoading}
                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {isProjectLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isProjectLoading ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="py-6 bg-white border border-dashed border-zinc-200 rounded-xl text-center">
          <Folder className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">
            No projects yet. Click <strong>New Project</strong> to get started.
          </p>
        </div>
      )}

      {/* Project sections */}
      {projects.length > 0 && (
        <>
          {/* Unassigned section */}
          <section
            className={dropClass('__root')}
            onDragOver={(e) => onDragOver(e, '__root')}
            onDragLeave={(e) => onDragLeave(e, '__root')}
            onDrop={(e) => onDrop(e, null)}
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Unassigned ({projectsInFolder(null).length})
              </h3>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden divide-y divide-zinc-100">
              {projectsInFolder(null).length === 0 ? (
                <div className="py-3 text-center text-xs text-zinc-400">
                  No unassigned projects.
                </div>
              ) : (
                projectsInFolder(null).map((p) => (
                  <React.Fragment key={p.id}>{renderProjectCard(p)}</React.Fragment>
                ))
              )}
            </div>
          </section>

          {/* Folder sections */}
          {projectFolders.map((folder) => {
            const isCollapsed = collapsedFolders.has(folder.id);
            const count = projectsInFolder(folder.id).length;
            return (
              <section
                key={folder.id}
                className={`group/folder ${dropClass('__f_' + folder.id)}`}
                onDragOver={(e) => onDragOver(e, '__f_' + folder.id)}
                onDragLeave={(e) => onDragLeave(e, '__f_' + folder.id)}
                onDrop={(e) => onDrop(e, folder.id)}
              >
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder.id)}
                    className="p-0.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <Folder className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <EditableFolderName
                    name={folder.name}
                    onCommit={(name) => void handleRenameFolder(folder.id, name)}
                  />
                  <span className="text-[10px] text-zinc-400 ml-0.5">{count}</span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    title="Remove folder"
                    onClick={() => void handleRemoveFolder(folder.id)}
                    className="p-1 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover/folder:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden divide-y divide-zinc-100">
                    {count === 0 ? (
                      <div className="py-3 text-center text-xs text-zinc-400">
                        Drop projects here or drag from Unassigned.
                      </div>
                    ) : (
                      projectsInFolder(folder.id).map((p) => (
                        <React.Fragment key={p.id}>{renderProjectCard(p)}</React.Fragment>
                      ))
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      {/* Deleted projects — collapsed by default */}
      {deletedProjects.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDeleted((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors py-1"
          >
            {showDeleted ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            Deleted ({deletedProjects.length})
          </button>
          {showDeleted && (
            <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden mt-1">
              <ul className="divide-y divide-zinc-100 max-h-60 overflow-y-auto">
                {deletedProjects.map((p) => (
                  <li key={p.id} className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-zinc-50/80">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 truncate">{p.name}</div>
                      <div className="text-[10px] text-zinc-400">
                        Deleted {p.deletedAt ? new Date(p.deletedAt).toLocaleString() : '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void reviveProject(p.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void permanentlyDeleteProject(p.id)}
                        className="px-2 py-1 text-xs font-medium rounded-md text-red-600 hover:bg-red-50 border border-red-100"
                      >
                        Delete forever
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditableFolderName({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  useEffect(() => {
    setVal(name);
  }, [name]);

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const t = val.trim();
          if (t && t !== name) onCommit(t);
          else setVal(name);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setVal(name);
            setEditing(false);
          }
        }}
        className="text-xs font-semibold text-zinc-900 min-w-0 flex-1 px-1.5 py-0.5 border border-indigo-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
    );
  }

  return (
    <button
      type="button"
      title="Rename folder"
      onClick={() => setEditing(true)}
      className="text-xs font-semibold text-zinc-800 uppercase tracking-wide truncate text-left hover:text-indigo-700 min-w-0"
    >
      {name}
    </button>
  );
}
