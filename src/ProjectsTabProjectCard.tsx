import React from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
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
      className={`group/row flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer border-l-2 ${isActive ? 'border-l-indigo-500 bg-indigo-50/30' : 'border-l-transparent hover:bg-zinc-50'}`}
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
      <GripVertical className="w-3.5 h-3.5 text-zinc-300 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />

      <h3
        className="text-sm font-medium text-zinc-900 truncate flex-1 min-w-0 cursor-text"
        onClick={(e) => {
          e.stopPropagation();
          const el = e.currentTarget;
          el.classList.remove('truncate');
          el.contentEditable = 'true';
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          const finish = async () => {
            el.contentEditable = 'false';
            el.classList.add('truncate');
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

      <span className="text-[11px] text-zinc-400 shrink-0 hidden sm:inline">
        {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>

      {project.fileName && (
        <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium shrink-0 hidden sm:inline">CSV</span>
      )}

      {isActive && (
        <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-semibold shrink-0">Active</span>
      )}

      <select
        id={`move-project-${project.id}`}
        value={moveValue}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          const v = e.target.value;
          void moveProjectToFolder(project.id, v === '' ? null : v);
        }}
        className="text-[10px] border border-zinc-200 rounded-md px-1 py-0.5 bg-white text-zinc-600 max-w-[7rem] shrink-0 focus:outline-none focus:ring-1 focus:ring-indigo-400"
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
        className="p-1 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0 opacity-0 group-hover/row:opacity-100"
        title="Move to deleted"
        type="button"
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden />
      </button>
    </article>
  );
}
