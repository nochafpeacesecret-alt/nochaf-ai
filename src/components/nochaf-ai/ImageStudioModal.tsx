import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { GeneratedImageItem } from '../../types';
import { auth, db, collection, doc, setDoc, deleteDoc, onSnapshot } from '../../lib/firebase';
import { Image, Zap, Download, Trash2, AlertTriangle, ShieldCheck, RefreshCw, X } from 'lucide-react';

interface ImageStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImageStudioModal: React.FC<ImageStudioModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3'>('1:1');
  const [images, setImages] = useState<GeneratedImageItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<GeneratedImageItem | null>(null);

  // Firestore sync for current user's generated images
  useEffect(() => {
    if (!user || !auth.currentUser || user.uid.startsWith('guest_')) return;
    const imgRef = collection(db, 'users', user.uid, 'generatedImages');
    const unsub = onSnapshot(imgRef, (snap) => {
      const items: GeneratedImageItem[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }));
      setImages(items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }, (err) => {
      console.warn('Image gallery sync notice:', err.message);
    });

    return () => unsub();
  }, [user]);

  if (!isOpen) return null;

  const handleGenerate = async (e?: React.FormEvent, customPrompt?: string) => {
    if (e) e.preventDefault();
    const finalPrompt = customPrompt || prompt;
    if (!finalPrompt.trim() || generating || !user) return;

    setError(null);
    setGenerating(true);

    try {
      const res = await fetch('/api/gemini/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt.trim(),
          aspectRatio,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Image generation failed');
      }

      const imgItem: GeneratedImageItem = {
        id: 'img_' + Date.now(),
        userId: user.uid,
        prompt: finalPrompt.trim(),
        imageUrl: data.imageUrl,
        aspectRatio,
        createdAt: new Date().toISOString(),
      };

      try {
        await setDoc(doc(db, 'users', user.uid, 'generatedImages', imgItem.id), imgItem);
      } catch {
        setImages((prev) => [imgItem, ...prev]);
      }

      setPreviewImage(imgItem);
    } catch (err: any) {
      console.error('Image gen error:', err);
      setError(err.message || 'Generation failed. Try a different prompt.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'generatedImages', id));
      if (previewImage?.id === id) setPreviewImage(null);
    } catch {
      setImages((prev) => prev.filter((img) => img.id !== id));
    }
  };

  const downloadImage = (item: GeneratedImageItem) => {
    const a = document.createElement('a');
    a.href = item.imageUrl;
    a.download = `nochaf-${item.prompt.slice(0, 20).replace(/[^a-z0-9]/gi, '_')}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="relative flex h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-white/20 bg-[#101015] text-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 border border-white/10">
              <Image className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Nochaf Creative Image Studio</h2>
              <p className="text-[11px] text-neutral-400">High-speed generation • Strictly isolated to your UID</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>

        {/* Studio Content */}
        <div className="flex flex-1 flex-col sm:flex-row overflow-hidden">
          {/* Generation Controls */}
          <div className="w-full sm:w-80 border-b sm:border-b-0 sm:border-r border-white/10 bg-neutral-950 p-4 space-y-4">
            <form onSubmit={handleGenerate} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">Prompt Description</label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Futuristic black and silver chrome concept hypercar speeding on neon highway"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-neutral-900 p-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white/30"
                />
              </div>

              {/* Aspect Ratio */}
              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">Aspect Ratio</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['1:1', '16:9', '9:16', '4:3'] as const).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={`rounded-lg py-1.5 text-[11px] font-mono transition-colors ${
                        aspectRatio === ratio
                          ? 'bg-neutral-100 text-black font-semibold'
                          : 'bg-neutral-900 text-neutral-400 border border-white/10 hover:text-white'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              {/* Safety notice */}
              <div className="flex items-start gap-1.5 rounded-lg bg-neutral-900/60 p-2 text-[10px] text-neutral-400 border border-white/5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>Strict content safety filtering enforced. Nudity, sexual, or violent content is prohibited.</span>
              </div>

              {error && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] w-[92%] max-w-sm animate-in fade-in slide-in-from-top-3 duration-150">
                  <div className="flex items-start justify-between gap-3 rounded-2xl border border-red-500/40 bg-[#161218]/95 p-3.5 text-xs text-red-100 shadow-2xl backdrop-blur-xl ring-1 ring-red-500/30">
                    <div className="space-y-0.5 flex-1 pr-1">
                      <p className="font-semibold text-red-300">Notice</p>
                      <p className="text-[11px] leading-relaxed text-red-200/95">{error}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setError(null)}
                      className="rounded-lg p-1 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer shrink-0"
                      title="Dismiss warning (×)"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={generating || !prompt.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 py-2.5 text-xs font-semibold text-black hover:bg-white disabled:opacity-50 transition-all shadow"
              >
                {generating ? (
                  <span className="animate-pulse">Generating artwork...</span>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" />
                    <span>Generate Artwork</span>
                  </>
                )}
              </button>
            </form>

            {/* Quick Inspiration Chips */}
            <div className="space-y-1.5 pt-2">
              <span className="text-[10px] font-mono uppercase text-neutral-500">Fast Presets</span>
              <div className="space-y-1">
                {[
                  'Futuristic silver and matte black cybernetic drone',
                  'Minimalist monochrome architectural villa in Kenya',
                  'Holographic glowing neural network sphere in silver void',
                ].map((p, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setPrompt(p);
                      handleGenerate(undefined, p);
                    }}
                    className="block w-full text-left truncate rounded-lg bg-neutral-900/70 px-2 py-1 text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                  >
                    "{p}"
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Gallery / Viewer */}
          <div className="flex-1 flex flex-col bg-[#111116] overflow-hidden p-4">
            {previewImage ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-3 overflow-hidden">
                <div className="relative max-h-[60vh] max-w-full rounded-xl overflow-hidden border border-white/20 shadow-2xl bg-black">
                  <img
                    src={previewImage.imageUrl}
                    alt={previewImage.prompt}
                    className="max-h-[55vh] w-auto object-contain"
                  />
                </div>
                <div className="flex items-center justify-between w-full max-w-md px-2">
                  <p className="text-xs text-neutral-300 truncate max-w-[240px]">"{previewImage.prompt}"</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => downloadImage(previewImage)}
                      className="flex items-center gap-1 rounded-lg border border-white/15 bg-neutral-800 px-3 py-1.5 text-xs text-white hover:bg-neutral-700"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download</span>
                    </button>
                    <button
                      onClick={() => handleDelete(previewImage.id)}
                      className="rounded-lg p-1 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-neutral-400 hover:text-neutral-200" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center text-xs text-neutral-500">
                {generating ? 'Processing high-fidelity visual generation...' : 'Enter a prompt or select a generated artwork from below.'}
              </div>
            )}

            {/* User Gallery Grid */}
            <div className="border-t border-white/10 pt-3 mt-auto">
              <span className="text-[10px] font-mono uppercase text-neutral-400 mb-2 block">
                Your Saved Generations ({images.length})
              </span>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {images.map((img) => (
                  <div
                    key={img.id}
                    onClick={() => setPreviewImage(img)}
                    className={`relative h-16 w-16 shrink-0 rounded-lg overflow-hidden border cursor-pointer transition-transform hover:scale-105 ${
                      previewImage?.id === img.id ? 'border-white ring-2 ring-white/30' : 'border-white/15'
                    }`}
                  >
                    <img src={img.imageUrl} alt={img.prompt} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
