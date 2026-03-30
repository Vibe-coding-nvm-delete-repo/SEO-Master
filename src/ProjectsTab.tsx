import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Folder, FolderPlus, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { Project, ProjectFolder } from './types';
import {
  batchSetProjectsFolderId,
  LS_PROJECT_FOLDERS_KEY,
  PROJECT_FOLDERS_FS_DOC,
  saveProjectFoldersToFirestore,
  saveProjectToFirestore,
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
  markListenerSnapshot,
} from './cloudSyncStatus';
import { reportPersistFailure } from './persistenceErrors';
import ProjectsTabProjectCard, { PROJECT_DRAG_MIME } from './ProjectsTabProjectCard';

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
  const projectsRef = useRef(projects);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'app_settings', PROJECT_FOLDERS_FS_DOC),
      (snap) => {
        markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectFolders, snap);
        if (!snap.exists()) {
          setProjectFolders([]);
          return;
        }
        const data = snap.data();
        setProjectFolders(parseProjectFoldersFromFirestore(data?.folders));
      },
      (err) => {
        markListenerError(CLOUD_SYNC_CHANNELS.projectFolders);
        reportPersistFailure(addToast, 'project folders sync', err);
      },
    );
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
    setProjects((prev) => prev.map((p) => (p.id === projectId ? next : p)));
    try {
      await saveProjectToFirestore(next);
    } catch (err) {
      reportPersistFailure(addToast, 'move project to folder', err);
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const id = newFolderId();
    const order = projectFolders.length === 0 ? 0 : Math.max(...projectFolders.map((f) => f.order)) + 1;
    const next = [...projectFolders, { id, name, order }];
    setProjectFolders(next);
    try {
      await saveProjectFoldersToFirestore(next);
    } catch (err) {
      reportPersistFailure(addToast, 'create folder', err);
    }
    setNewFolderName('');
  };

  const handleRenameFolder = async (folderId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = projectFolders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f));
    setProjectFolders(next);
    try {
      await saveProjectFoldersToFirestore(next);
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
    setProjectFolders(nextFolders);
    try {
      await saveProjectFoldersToFirestore(nextFolders);
      await batchSetProjectsFolderId(ids, null);
      setProjects((prev) =>
        prev.map((p) => (p.folderId === folderId && !p.deletedAt ? { ...p, folderId: null } : p)),
      );
    } catch (err) {
      reportPersistFailure(addToast, 'remove folder', err);
    }
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

  const subTabBtnBase = 'px-3 py-1 text-xs font-medium rounded-md transition-all';
  const subTabBtnInactive = 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50';

  const renderProjectCard = (p: Project) => (
    <ProjectsTabProjectCard
      project={p}
      activeProjectId={activeProjectId}
      effectiveFolderId={effectiveProjectFolderId(p, validFolderIds)}
      projectFolders={projectFolders}
      selectProject={selectProject}
      deleteProject={deleteProject}
      setProjects={setProjects}
      moveProjectToFolder={moveProjectToFolder}
      addToast={addToast}
    />
  );

  const dropClass = (key: string) =>
    `rounded-2xl border-2 border-dashed transition-colors min-h-[120px] ${
      dragOverTarget === key ? 'border-indigo-400 bg-indigo-50/40' : 'border-zinc-200/80 bg-transparent'
    }`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">Projects</h2>
          <p className="text-zinc-500 text-sm">
            Organize projects into folders, drag cards between sections, or use the Move to folder control on each card.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreatingProject(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">New folder</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="flex-1 px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateFolder();
              }}
            />
            <button
              type="button"
              onClick={() => void handleCreateFolder()}
              disabled={!newFolderName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-zinc-100 text-zinc-800 hover:bg-zinc-200 border border-zinc-200 disabled:opacity-50"
            >
              <FolderPlus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      </div>

      {isCreatingProject && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-md animate-in zoom-in-95 duration-200">
          <h3 className="text-lg font-medium text-zinc-900 mb-4">Create New Project</h3>

          {projectError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" />
              {projectError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Project Name</label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g., Q1 SEO Strategy"
                className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Description (Optional)</label>
              <textarea
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="What is this project about?"
                className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all h-24 resize-none"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsCreatingProject(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createProject()}
                disabled={!newProjectName.trim() || isProjectLoading}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isProjectLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {isProjectLoading ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {projects.length === 0 && (
        <div className="py-16 bg-white border border-dashed border-zinc-300 rounded-2xl flex flex-col items-center justify-center text-center">
          <Folder className="w-12 h-12 text-zinc-300 mb-4" />
          <h3 className="text-lg font-medium text-zinc-900 mb-1">No projects yet</h3>
          <p className="text-zinc-500 max-w-xs">Create your first project to start organizing your keyword data.</p>
        </div>
      )}

      {projects.length > 0 && (
        <>
          <section
            className={dropClass('__root')}
            onDragOver={(e) => onDragOver(e, '__root')}
            onDragLeave={(e) => onDragLeave(e, '__root')}
            onDrop={(e) => onDrop(e, null)}
          >
            <div className="flex items-center justify-between px-1 pb-3">
              <h3 className="text-sm font-semibold text-zinc-800">Unassigned</h3>
              <span className="text-[10px] text-zinc-400">{projectsInFolder(null).length} projects</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projectsInFolder(null).length === 0 ? (
                <div className="col-span-full py-10 text-center text-sm text-zinc-400 border border-zinc-100 rounded-xl bg-zinc-50/50">
                  No unassigned projects. Drag a project here or create one.
                </div>
              ) : (
                projectsInFolder(null).map((p) => (
                <React.Fragment key={p.id}>{renderProjectCard(p)}</React.Fragment>
              ))
              )}
            </div>
          </section>

          {projectFolders.map((folder) => (
            <section
              key={folder.id}
              className={dropClass('__f_' + folder.id)}
              onDragOver={(e) => onDragOver(e, '__f_' + folder.id)}
              onDragLeave={(e) => onDragLeave(e, '__f_' + folder.id)}
              onDrop={(e) => onDrop(e, folder.id)}
            >
              <div className="flex items-center justify-between px-1 pb-3 gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Folder className="w-4 h-4 text-zinc-400 shrink-0" />
                  <EditableFolderName
                    name={folder.name}
                    onCommit={(name) => void handleRenameFolder(folder.id, name)}
                  />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-zinc-400">{projectsInFolder(folder.id).length}</span>
                  <button
                    type="button"
                    title="Remove folder"
                    onClick={() => void handleRemoveFolder(folder.id)}
                    className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projectsInFolder(folder.id).length === 0 ? (
                  <div className="col-span-full py-10 text-center text-sm text-zinc-400 border border-zinc-100 rounded-xl bg-zinc-50/50">
                    Drop projects here or drag from Unassigned.
                  </div>
                ) : (
                  projectsInFolder(folder.id).map((p) => (
                    <React.Fragment key={p.id}>{renderProjectCard(p)}</React.Fragment>
                  ))
                )}
              </div>
            </section>
          ))}
        </>
      )}

      {deletedProjects.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-800">Deleted projects</h3>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
              {deletedProjects.length}
            </span>
          </div>
          <p className="px-4 py-2 text-xs text-zinc-500 border-b border-zinc-50">
            Restore a project to use it again, or delete permanently to remove all data.
          </p>
          <ul className="divide-y divide-zinc-100 max-h-80 overflow-y-auto">
            {deletedProjects.map((p) => (
              <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50/80">
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
                    className={`${subTabBtnBase} ${subTabBtnInactive} inline-flex items-center gap-1`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => void permanentlyDeleteProject(p.id)}
                    className="px-3 py-1 text-xs font-medium rounded-md text-red-600 hover:bg-red-50 border border-red-100"
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
        className="text-sm font-semibold text-zinc-900 min-w-0 flex-1 px-2 py-0.5 border border-indigo-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
    );
  }

  return (
    <button
      type="button"
      title="Rename folder"
      onClick={() => setEditing(true)}
      className="text-sm font-semibold text-zinc-900 truncate text-left hover:text-indigo-700 min-w-0"
    >
      {name}
    </button>
  );
}
