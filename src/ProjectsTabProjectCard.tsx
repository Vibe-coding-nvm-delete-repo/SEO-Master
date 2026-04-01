import React from 'react';
import { Calendar, FileText, Folder, Trash2 } from 'lucide-react';
import type { Project, ProjectFolder } from './types';

export const PROJECT_DRAG_MIME = 'application/x-kwg-project-id';

export interface ProjectsTabProjectCardProps {
  project: Project;
  activeProjectId: string | null;
  /** Current folder placement after resolving orphan ids. */
  effectiveFolderId: string | null;
  projectFolders: ProjectFolder[];
  selectProject: (id: string) => void | Promise<void>;
  deleteProject: (id: string) => void | Promise<void>;
  renameProject: (projectId: string, newName: string) => Promise<void>;
  moveProjectToFolder: (projectId: string, folderId: string | null) => void | Promise<void>;
  addToast: (msg: string, type?: 'error' | 'success' | 'info') => void;
}

export default function ProjectsTabProjectCard({
  project,
  activeProjectId,
  effectiveFolderId,
  projectFolders,
  selectProject,
  deleteProject,
  renameProject,
  moveProjectToFolder,
}: ProjectsTabProjectCardProps) {
  const isActive = activeProjectId === project.id;
  const moveValue = effectiveFolderId ?? '';

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PROJECT_DRAG_MIME, project.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`bg-white border rounded-2xl shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing relative overflow-hidden ${isActive ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-200 hover:border-zinc-300'}`}
      onClick={() => void selectProject(project.id)}
      onKeyDown={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest('select, button, [contenteditable="true"]')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void selectProject(project.id);
        }
      }}
      tabIndex={0}
      aria-label={`Project ${project.name}. Press Enter to open, or use Move to folder.`}
    >
      {isActive && <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-500" />}

      <div className="p-5">
        <div className="flex items-center gap-3 mb-2">
          <div
            className={`p-2 rounded-lg shrink-0 ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-400'}`}
          >
            <Folder className="w-5 h-5" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="text-sm font-semibold text-zinc-900 truncate cursor-text"
              onClick={(e) => {
                e.stopPropagation();
                const el = e.currentTarget;
                el.contentEditable = 'true';
                el.focus();
                const range = document.createRange();
                range.selectNodeContents(el);
                window.getSelection()?.removeAllRanges();
                window.getSelection()?.addRange(range);
                const finish = async () => {
                  el.contentEditable = 'false';
                  const newName = el.textContent?.trim();
                  if (newName && newName !== project.name) {
                    try {
                      await renameProject(project.id, newName);
                    } catch {
                      el.textContent = project.name;
                    }
                  } else {
                    el.textContent = project.name;
                  }
                };
                el.onblur = () => {
                  void finish();
                };
                el.onkeydown = (ev: KeyboardEvent) => {
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    el.blur();
                  }
                  if (ev.key === 'Escape') {
                    el.textContent = project.name;
                    el.blur();
                  }
                };
              }}
              title="Click to rename"
              suppressContentEditableWarning
            >
              {project.name}
            </h3>
          </div>
          <select
            id={`move-project-${project.id}`}
            value={moveValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              const v = e.target.value;
              void moveProjectToFolder(project.id, v === '' ? null : v);
            }}
            className="text-[11px] border border-zinc-200 rounded-md px-1.5 py-1 bg-white text-zinc-700 max-w-[9rem] shrink-0 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label={`Move ${project.name} to folder`}
          >
            <option value="">Unassigned</option>
            {projectFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void deleteProject(project.id);
            }}
            className="p-1.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0"
            title="Move to deleted"
            type="button"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>

        {project.description && (
          <p className="text-xs text-zinc-400 mb-3 line-clamp-2 pl-11">{project.description}</p>
        )}

        <div className="flex items-center gap-3 pl-11 text-[11px]">
          <span className="text-zinc-400 flex items-center gap-1">
            <Calendar className="w-3 h-3" aria-hidden />
            {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          {project.fileName && (
            <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
              <FileText className="w-3 h-3" aria-hidden />
              CSV
            </span>
          )}
          {isActive && (
            <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-semibold">Active</span>
          )}
        </div>
      </div>
    </article>
  );
}
