import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ProjectWorkspace, ProjectTask, ProjectSnippet } from '../../types';
import { auth, db, collection, doc, setDoc, deleteDoc, onSnapshot } from '../../lib/firebase';
import { Folder, Plus, Trash2, CheckSquare, Square, Code, FileText, Check } from 'lucide-react';

interface ProjectWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProject: ProjectWorkspace | null;
  setActiveProject: (proj: ProjectWorkspace | null) => void;
}

export const ProjectWorkspaceModal: React.FC<ProjectWorkspaceModalProps> = ({
  isOpen,
  onClose,
  activeProject,
  setActiveProject,
}) => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectWorkspace[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(activeProject?.id || null);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'notes' | 'tasks' | 'snippets'>('overview');

  // New task/snippet states
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newSnippetTitle, setNewSnippetTitle] = useState('');
  const [newSnippetLang, setNewSnippetLang] = useState('typescript');
  const [newSnippetCode, setNewSnippetCode] = useState('');
  const [notesContent, setNotesContent] = useState('');

  // Firestore sync for projects
  useEffect(() => {
    if (!user || !auth.currentUser || user.uid.startsWith('guest_')) return;
    const projRef = collection(db, 'users', user.uid, 'projects');
    const unsub = onSnapshot(
      projRef,
      (snap) => {
        const items: ProjectWorkspace[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }));
        setProjects(items);
        if (items.length > 0 && !selectedProjectId) {
          setSelectedProjectId(items[0].id);
          setNotesContent(items[0].notes || '');
        }
      },
      (err) => {
        console.warn('Projects sync notice:', err.message);
      }
    );

    return () => unsub();
  }, [user]);

  const currentProject = projects.find((p) => p.id === selectedProjectId) || null;

  useEffect(() => {
    if (currentProject) {
      setNotesContent(currentProject.notes || '');
    }
  }, [selectedProjectId]);

  if (!isOpen) return null;

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !user) return;

    const projId = 'proj_' + Date.now();
    const newProj: ProjectWorkspace = {
      id: projId,
      userId: user.uid,
      name: newProjectName.trim(),
      description: newProjectDesc.trim(),
      notes: 'Initial project notes and system architecture.',
      tasks: [
        { id: 't1', title: 'Define data models & endpoints', completed: true, priority: 'high' },
        { id: 't2', title: 'Implement frontend visual components', completed: false, priority: 'medium' },
      ],
      codeSnippets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'users', user.uid, 'projects', projId), newProj);
      setSelectedProjectId(projId);
      setActiveProject(newProj);
      setIsCreating(false);
      setNewProjectName('');
      setNewProjectDesc('');
    } catch {
      // Local fallback
      setProjects((prev) => [newProj, ...prev]);
      setSelectedProjectId(projId);
      setActiveProject(newProj);
      setIsCreating(false);
    }
  };

  const handleUpdateNotes = async () => {
    if (!currentProject || !user) return;
    const updated = { ...currentProject, notes: notesContent, updatedAt: new Date().toISOString() };
    try {
      await setDoc(doc(db, 'users', user.uid, 'projects', currentProject.id), updated);
      if (activeProject?.id === currentProject.id) {
        setActiveProject(updated);
      }
    } catch {
      setProjects((prev) => prev.map((p) => (p.id === currentProject.id ? updated : p)));
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject || !user || !newTaskTitle.trim()) return;

    const newTask: ProjectTask = {
      id: 'task_' + Date.now(),
      title: newTaskTitle.trim(),
      completed: false,
      priority: 'medium',
    };
    const updated = {
      ...currentProject,
      tasks: [...(currentProject.tasks || []), newTask],
      updatedAt: new Date().toISOString(),
    };

    await setDoc(doc(db, 'users', user.uid, 'projects', currentProject.id), updated);
    setNewTaskTitle('');
    if (activeProject?.id === currentProject.id) setActiveProject(updated);
  };

  const handleToggleTask = async (taskId: string) => {
    if (!currentProject || !user) return;
    const updatedTasks = currentProject.tasks.map((t) =>
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );
    const updated = { ...currentProject, tasks: updatedTasks, updatedAt: new Date().toISOString() };
    await setDoc(doc(db, 'users', user.uid, 'projects', currentProject.id), updated);
    if (activeProject?.id === currentProject.id) setActiveProject(updated);
  };

  const handleAddSnippet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject || !user || !newSnippetTitle.trim()) return;

    const snippet: ProjectSnippet = {
      id: 'snip_' + Date.now(),
      title: newSnippetTitle.trim(),
      language: newSnippetLang,
      code: newSnippetCode,
    };
    const updated = {
      ...currentProject,
      codeSnippets: [...(currentProject.codeSnippets || []), snippet],
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', user.uid, 'projects', currentProject.id), updated);
    setNewSnippetTitle('');
    setNewSnippetCode('');
    if (activeProject?.id === currentProject.id) setActiveProject(updated);
  };

  const handleDeleteProject = async (id: string) => {
    if (!user) return;
    if (!confirm('Are you sure you want to delete this project?')) return;
    await deleteDoc(doc(db, 'users', user.uid, 'projects', id));
    if (activeProject?.id === id) setActiveProject(null);
    setSelectedProjectId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="relative flex h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-white/20 bg-[#101015] text-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 border border-white/10">
              <Folder className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">AI Project Workspace</h2>
              <p className="text-[11px] text-neutral-400">Contextual intelligence across tasks, notes, & code</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>

        {/* Workspace Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Projects Sidebar */}
          <div className="w-56 sm:w-64 border-r border-white/10 bg-neutral-950 p-3 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[10px] font-mono uppercase text-neutral-400">Your Projects</span>
                <button
                  onClick={() => setIsCreating(true)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  title="New Project"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {projects.length === 0 && !isCreating && (
                <div className="p-3 text-center text-xs text-neutral-500 border border-dashed border-white/10 rounded-lg">
                  No projects yet. Click + to create one.
                </div>
              )}

              {isCreating && (
                <form onSubmit={handleCreateProject} className="rounded-lg border border-white/20 bg-neutral-900 p-2.5 space-y-2">
                  <input
                    type="text"
                    required
                    placeholder="Project Title"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    className="w-full rounded border border-white/10 bg-black px-2 py-1 text-xs text-white focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Short description"
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                    className="w-full rounded border border-white/10 bg-black px-2 py-1 text-xs text-white focus:outline-none"
                  />
                  <div className="flex justify-end gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsCreating(false)}
                      className="px-2 py-0.5 text-[10px] text-neutral-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded bg-white px-2.5 py-0.5 text-[10px] font-semibold text-black hover:bg-neutral-200"
                    >
                      Create
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-1 overflow-y-auto max-h-[50vh]">
                {projects.map((proj) => (
                  <button
                    key={proj.id}
                    onClick={() => {
                      setSelectedProjectId(proj.id);
                      setActiveProject(proj);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                      selectedProjectId === proj.id
                        ? 'bg-neutral-800 text-white font-semibold border border-white/15'
                        : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'
                    }`}
                  >
                    <div className="truncate pr-1">
                      <p className="truncate">{proj.name}</p>
                      <p className="text-[10px] text-neutral-500 truncate">{proj.description || 'No description'}</p>
                    </div>
                    {activeProject?.id === proj.id && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="Active in AI chat" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Set as Active Context Button */}
            {currentProject && (
              <div className="pt-2 border-t border-white/10 space-y-2">
                <button
                  onClick={() => setActiveProject(activeProject?.id === currentProject.id ? null : currentProject)}
                  className={`w-full rounded-lg py-1.5 text-xs font-medium transition-colors ${
                    activeProject?.id === currentProject.id
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-neutral-800 text-white hover:bg-neutral-700'
                  }`}
                >
                  {activeProject?.id === currentProject.id ? '✓ Active Chat Context' : 'Set as Active Chat Context'}
                </button>
              </div>
            )}
          </div>

          {/* Project Details Panel */}
          {currentProject ? (
            <div className="flex-1 flex flex-col bg-[#111116] overflow-hidden">
              {/* Tabs */}
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 bg-neutral-900/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">{currentProject.name}</span>
                  <div className="flex items-center rounded-lg bg-neutral-950 p-0.5 border border-white/10 text-xs">
                    {(['overview', 'notes', 'tasks', 'snippets'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`rounded-md px-2.5 py-1 text-[11px] capitalize transition-colors ${
                          activeTab === tab ? 'bg-neutral-200 text-black font-semibold' : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteProject(currentProject.id)}
                  className="rounded p-1 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                  title="Delete Project"
                >
                  <Trash2 className="h-3.5 w-3.5 text-neutral-400 hover:text-neutral-200" />
                </button>
              </div>

              {/* Tab Contents */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeTab === 'overview' && (
                  <div className="space-y-4 text-xs">
                    <div className="rounded-xl border border-white/10 bg-neutral-900/80 p-4 space-y-2">
                      <p className="text-[10px] font-mono uppercase text-neutral-400">Context Summary for Nochaf.AI</p>
                      <p className="text-neutral-200">{currentProject.description || 'No description provided.'}</p>
                      <div className="flex items-center gap-4 text-neutral-400 pt-1 text-[11px]">
                        <span>Tasks: {currentProject.tasks?.length || 0}</span>
                        <span>Snippets: {currentProject.codeSnippets?.length || 0}</span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-300">
                      When this project is active, Nochaf.AI automatically reads its notes, tasks, and snippets during your conversation so you never need to re-explain the setup.
                    </div>
                  </div>
                )}

                {activeTab === 'notes' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-neutral-400">Project Notes & Architecture</span>
                      <button
                        onClick={handleUpdateNotes}
                        className="flex items-center gap-1 rounded bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-black hover:bg-white"
                      >
                        <Check className="h-3 w-3" />
                        <span>Save Notes</span>
                      </button>
                    </div>
                    <textarea
                      rows={12}
                      value={notesContent}
                      onChange={(e) => setNotesContent(e.target.value)}
                      placeholder="Write specs, architecture decisions, requirements..."
                      className="w-full rounded-xl border border-white/10 bg-neutral-950 p-3 text-xs font-mono text-neutral-200 focus:outline-none focus:border-white/30"
                    />
                  </div>
                )}

                {activeTab === 'tasks' && (
                  <div className="space-y-3">
                    <form onSubmit={handleAddTask} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Add a new project task..."
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        className="flex-1 rounded-lg border border-white/10 bg-neutral-950 px-3 py-1.5 text-xs text-white focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-black hover:bg-white"
                      >
                        Add Task
                      </button>
                    </form>

                    <div className="space-y-1.5">
                      {currentProject.tasks?.map((task) => (
                        <div
                          key={task.id}
                          onClick={() => handleToggleTask(task.id)}
                          className="flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/50 p-2.5 text-xs cursor-pointer hover:bg-neutral-800/50"
                        >
                          {task.completed ? (
                            <CheckSquare className="h-4 w-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Square className="h-4 w-4 text-neutral-500 shrink-0" />
                          )}
                          <span className={task.completed ? 'line-through text-neutral-500' : 'text-neutral-200'}>
                            {task.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'snippets' && (
                  <div className="space-y-3">
                    <form onSubmit={handleAddSnippet} className="rounded-xl border border-white/10 bg-neutral-950 p-3 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          placeholder="Snippet Title (e.g. auth-middleware.ts)"
                          value={newSnippetTitle}
                          onChange={(e) => setNewSnippetTitle(e.target.value)}
                          className="flex-1 rounded border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-white"
                        />
                        <select
                          value={newSnippetLang}
                          onChange={(e) => setNewSnippetLang(e.target.value)}
                          className="rounded border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-white"
                        >
                          <option value="typescript">TypeScript</option>
                          <option value="python">Python</option>
                          <option value="sql">SQL</option>
                          <option value="json">JSON</option>
                        </select>
                      </div>
                      <textarea
                        rows={4}
                        placeholder="// paste snippet code..."
                        value={newSnippetCode}
                        onChange={(e) => setNewSnippetCode(e.target.value)}
                        className="w-full rounded border border-white/10 bg-neutral-900 p-2 text-xs font-mono text-neutral-200"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          className="rounded bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-neutral-200"
                        >
                          Add Snippet
                        </button>
                      </div>
                    </form>

                    <div className="space-y-2">
                      {currentProject.codeSnippets?.map((snip) => (
                        <div key={snip.id} className="rounded-xl border border-white/10 bg-neutral-900/60 p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-white">{snip.title}</span>
                            <span className="text-[10px] font-mono uppercase text-neutral-400">{snip.language}</span>
                          </div>
                          <pre className="rounded bg-black/60 p-2.5 text-[11px] font-mono text-neutral-300 overflow-x-auto">
                            {snip.code}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-neutral-500">
              Select or create a project on the left to inspect its workspace.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
