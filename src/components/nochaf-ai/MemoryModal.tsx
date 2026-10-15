import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AIMemory } from '../../types';
import { auth, db, collection, doc, setDoc, deleteDoc, onSnapshot, getDocs } from '../../lib/firebase';
import { Brain, Trash2, Plus, AlertCircle, ShieldCheck } from 'lucide-react';

interface MemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  memories: AIMemory[];
  setMemories: React.Dispatch<React.SetStateAction<AIMemory[]>>;
  memoryEnabled: boolean;
  setMemoryEnabled: (enabled: boolean) => void;
}

export const MemoryModal: React.FC<MemoryModalProps> = ({
  isOpen,
  onClose,
  memories,
  setMemories,
  memoryEnabled,
  setMemoryEnabled,
}) => {
  const { user } = useAuth();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [category, setCategory] = useState<'preference' | 'instruction' | 'context' | 'fact'>('preference');
  const [loading, setLoading] = useState(false);

  // Firestore sync for current user's UID
  useEffect(() => {
    if (!user || !auth.currentUser || user.uid.startsWith('guest_')) return;
    const memoriesRef = collection(db, 'users', user.uid, 'memories');
    const unsub = onSnapshot(memoriesRef, (snap) => {
      const items: AIMemory[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }));
      setMemories(items);
    }, (err) => {
      console.warn('Memory sync notice:', err.message);
    });

    return () => unsub();
  }, [user]);

  if (!isOpen) return null;

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim() || !user) return;
    setLoading(true);

    const memId = 'mem_' + Date.now();
    const item: AIMemory = {
      id: memId,
      userId: user.uid,
      key: newKey.trim(),
      value: newValue.trim(),
      category,
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'users', user.uid, 'memories', memId), item);
      setNewKey('');
      setNewValue('');
    } catch {
      // Optimistic local state update
      setMemories((prev) => [item, ...prev]);
      setNewKey('');
      setNewValue('');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'memories', id));
    } catch {
      setMemories((prev) => prev.filter((m) => m.id !== id));
    }
  };

  const handleClearAll = async () => {
    if (!user || memories.length === 0) return;
    if (!confirm('Are you sure you want to clear all your saved AI memories? This action is permanent.')) return;

    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'memories'));
      const batchPromises = snap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(batchPromises);
      setMemories([]);
    } catch {
      setMemories([]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-white/20 bg-[#101015] p-6 text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 border border-white/10">
              <Brain className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Private AI Memory (UID Isolated)</h2>
              <p className="text-[11px] text-neutral-400">Strictly isolated to your account • Never shared</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>

        {/* Global Memory Toggle */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-neutral-900/60 p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <div>
              <p className="text-xs font-semibold text-white">Enable AI Memory in Chat</p>
              <p className="text-[11px] text-neutral-400">
                {memoryEnabled ? 'Nochaf.AI utilizes your saved memories for personalized context' : 'Memory injection disabled for chat sessions'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMemoryEnabled(!memoryEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              memoryEnabled ? 'bg-white' : 'bg-neutral-800'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out ${
                memoryEnabled ? 'translate-x-4 bg-black' : 'translate-x-0 bg-neutral-400'
              }`}
            />
          </button>
        </div>

        {/* Add Memory Form */}
        <form onSubmit={handleAddMemory} className="mt-4 rounded-xl border border-white/10 bg-neutral-950 p-3 space-y-2">
          <p className="text-[11px] font-mono uppercase text-neutral-400">Add New Memory</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Key (e.g. Coding Preference)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="rounded-lg border border-white/10 bg-neutral-900 py-1.5 px-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white/30"
            />
            <input
              type="text"
              placeholder="Value (e.g. Always use TypeScript & Tailwind)"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="sm:col-span-2 rounded-lg border border-white/10 bg-neutral-900 py-1.5 px-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white/30"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              {(['preference', 'instruction', 'fact'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`rounded-md px-2 py-0.5 text-[10px] font-mono capitalize transition-colors ${
                    category === cat ? 'bg-neutral-200 text-black font-semibold' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={loading || !newKey.trim() || !newValue.trim()}
              className="flex items-center gap-1 rounded-lg bg-neutral-100 px-3 py-1 text-xs font-semibold text-black hover:bg-white disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
              <span>Remember</span>
            </button>
          </div>
        </form>

        {/* Saved Memories List */}
        <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
          <div className="flex items-center justify-between pb-1">
            <span className="text-[11px] font-mono uppercase text-neutral-400">
              Saved Memories ({memories.length})
            </span>
            {memories.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-[11px] text-red-400 hover:text-red-300 underline"
              >
                Clear All
              </button>
            )}
          </div>

          {memories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-neutral-500">
              No private memories saved yet. Add facts, preferences, or instructions you want Nochaf.AI to remember.
            </div>
          ) : (
            memories.map((m) => (
              <div
                key={m.id}
                className="flex items-start justify-between rounded-xl border border-white/10 bg-neutral-900/60 p-3 hover:border-white/20 transition-colors"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">{m.key}</span>
                    <span className="rounded bg-neutral-800 px-1.5 py-0.2 text-[9px] font-mono uppercase text-neutral-400">
                      {m.category}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-300 leading-relaxed">{m.value}</p>
                </div>
                <button
                  onClick={() => handleDeleteMemory(m.id)}
                  className="rounded-lg p-1 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                  title="Delete memory"
                >
                  <Trash2 className="h-3.5 w-3.5 text-neutral-400 hover:text-neutral-200" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-neutral-800 px-4 py-1.5 text-xs text-white hover:bg-neutral-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
