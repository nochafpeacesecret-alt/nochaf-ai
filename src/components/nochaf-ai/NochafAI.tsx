/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ChatMessage, AIMemory, Conversation, ChatMode, MediaAttachment } from '../../types';
import { auth, db, doc, setDoc, deleteDoc, collection, onSnapshot } from '../../lib/firebase';
import { MarkdownView, sanitizeSafetyOutput } from '../ui/MarkdownView';
import {
  Send,
  Volume2,
  VolumeX,
  Loader2,
  Plus,
  X,
  Image as ImageIcon,
  HelpCircle,
  FileText,
  Trash2,
  Video,
  Check,
  Eye,
  Sun,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Globe,
  MessageSquare,
  Copy,
} from 'lucide-react';
import { GeniusDiscussionsModal } from './GeniusDiscussionsModal';

export interface FontOption {
  id: string;
  name: string;
  sample: string;
  fontFamily: string;
  desc: string;
}

// All 9 distinctive fonts unlocked and available in Nochaf AI
export const CHAT_FONTS: FontOption[] = [
  {
    id: 'sans',
    name: 'Modern Sans',
    sample: 'Aa',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    desc: 'Clean & minimalist',
  },
  {
    id: 'serif',
    name: 'Editorial Serif',
    sample: 'Aa',
    fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif',
    desc: 'Warm & classic book',
  },
  {
    id: 'mono',
    name: 'Code Monospace',
    sample: '>_',
    fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
    desc: 'Crisp & technical',
  },
  {
    id: 'cinzel',
    name: 'Cinzel Roman',
    sample: 'IV',
    fontFamily: '"Cinzel", serif',
    desc: 'Classical engraved imperial display',
  },
  {
    id: 'syne',
    name: 'Syne Avant-Garde',
    sample: 'Aa',
    fontFamily: '"Syne", sans-serif',
    desc: 'Eccentric French art-house display',
  },
  {
    id: 'space_grotesk',
    name: 'Space Grotesk',
    sample: '01',
    fontFamily: '"Space Grotesk", sans-serif',
    desc: 'Technical brutalist with sharp ink traps',
  },
  {
    id: 'fraunces',
    name: 'Fraunces Retro',
    sample: 'Aa',
    fontFamily: '"Fraunces", serif',
    desc: 'Expressive vintage display serif with soft curves',
  },
  {
    id: 'orbitron',
    name: 'Orbitron Cyber',
    sample: 'AI',
    fontFamily: '"Orbitron", sans-serif',
    desc: 'Futuristic sci-fi spacecraft typography',
  },
  {
    id: 'casual',
    name: 'Casual Note',
    sample: 'Aa',
    fontFamily: '"Comic Sans MS", "Caveat", "Segoe Print", "Chalkboard SE", cursive',
    desc: 'Relaxed handwriting',
  },
];

export interface WallpaperConfig {
  type: 'color' | 'image';
  value: string;
  name: string;
  blur?: number; // 0 to 20 px, 0 = crystal clear
  brightness?: number; // 30 to 160 %, 100 = standard light
  dim?: number; // 0 to 80 %, 0 = clear
}

export const WALLPAPER_PALETTE: WallpaperConfig[] = [
  { type: 'color', value: '#ef4444', name: 'Red', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#2563eb', name: 'Blue', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#38bdf8', name: 'Light Blue', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#f97316', name: 'Orange', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#22c55e', name: 'Green', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#15803d', name: 'Dark Green', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#eab308', name: 'Yellow', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#a855f7', name: 'Purple', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#581c87', name: 'Dark Purple', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#000000', name: 'Black', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#6b7280', name: 'Grey', blur: 0, brightness: 100, dim: 0 },
  { type: 'color', value: '#27272a', name: 'Dark Grey', blur: 0, brightness: 100, dim: 0 },
];

interface NochafAIProps {
  memories: AIMemory[];
  onOpenAuth: () => void;
  onOpenTextSomeone?: () => void;
  unreadSender?: { name: string; avatar?: string } | null;
  unreadCount?: number;
}

export const NochafAI: React.FC<NochafAIProps> = ({
  memories,
  onOpenAuth,
  onOpenTextSomeone,
  unreadSender,
  unreadCount = 0,
}) => {
  const { user } = useAuth();

  // Helper key to isolate each account independently
  const userStorageKey = user?.uid && !user.uid.startsWith('guest_') ? user.uid : 'guest';

  // CHAT STATE — Strictly isolated per account
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`nochaf_messages_${userStorageKey}`);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });

  const [activeConvId, setActiveConvId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`nochaf_conv_id_${userStorageKey}`) || 'chat_' + Date.now();
    }
    return 'chat_' + Date.now();
  });

  const [chatFontId, setChatFontId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`nochaf_font_${userStorageKey}`) || 'sans';
      if (CHAT_FONTS.some((f) => f.id === saved)) {
        return saved;
      }
      return 'sans';
    }
    return 'sans';
  });

  // WALLPAPER STATE — Strictly isolated per account
  const [wallpaper, setWallpaper] = useState<WallpaperConfig>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`nochaf_wallpaper_${userStorageKey}`);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return WALLPAPER_PALETTE[9]; // Black
  });

  // Copy notice toast state (shows copied text visibly during the process)
  const [copiedTextNotice, setCopiedTextNotice] = useState<string | null>(null);

  // When account changes (login, logout, switch account), reload independent data for that account
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentKey = user?.uid && !user.uid.startsWith('guest_') ? user.uid : 'guest';
    try {
      const savedMsg = localStorage.getItem(`nochaf_messages_${currentKey}`);
      setMessages(savedMsg ? JSON.parse(savedMsg) : []);

      const savedConv = localStorage.getItem(`nochaf_conv_id_${currentKey}`);
      setActiveConvId(savedConv || 'chat_' + Date.now());

      const savedFont = localStorage.getItem(`nochaf_font_${currentKey}`);
      setChatFontId(savedFont && CHAT_FONTS.some((f) => f.id === savedFont) ? savedFont : 'sans');

      const savedWp = localStorage.getItem(`nochaf_wallpaper_${currentKey}`);
      setWallpaper(savedWp ? JSON.parse(savedWp) : WALLPAPER_PALETTE[9]);
    } catch {}
  }, [user?.uid]);

  const updateMessages = (updater: React.SetStateAction<ChatMessage[]>) => {
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem(`nochaf_messages_${userStorageKey}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const updateActiveConvId = (id: string) => {
    setActiveConvId(id);
    try {
      localStorage.setItem(`nochaf_conv_id_${userStorageKey}`, id);
    } catch {}
  };

  const updateWallpaper = (newWp: WallpaperConfig | ((prev: WallpaperConfig) => WallpaperConfig)) => {
    setWallpaper((prev) => {
      const next = typeof newWp === 'function' ? newWp(prev) : newWp;
      try {
        localStorage.setItem(`nochaf_wallpaper_${userStorageKey}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [inputText, setInputText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Drawer collapsible controls
  const [isFontDropdownOpen, setIsFontDropdownOpen] = useState(false);
  const [isTopFontDropdownOpen, setIsTopFontDropdownOpen] = useState(false);
  const topFontDropdownRef = useRef<HTMLDivElement>(null);
  const [isTextSomeoneOpen, setIsTextSomeoneOpen] = useState(false);
  const [discussionInitialTab, setDiscussionInitialTab] = useState<'direct' | 'group'>('direct');

  // Close top font dropdown when clicking outside
  useEffect(() => {
    if (!isTopFontDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (topFontDropdownRef.current && !topFontDropdownRef.current.contains(e.target as Node)) {
        setIsTopFontDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isTopFontDropdownOpen]);

  // Active Mode: 'general' | 'math' | 'story' | 'business'
  const [activeMode, setActiveMode] = useState<ChatMode>('general');

  const [showWallpaperModal, setShowWallpaperModal] = useState<boolean>(false);
  const [isAdjustingWallpaper, setIsAdjustingWallpaper] = useState<boolean>(false);

  useEffect(() => {
    if (!isAdjustingWallpaper) return;
    const handleRelease = () => setIsAdjustingWallpaper(false);
    window.addEventListener('pointerup', handleRelease);
    window.addEventListener('touchend', handleRelease);
    return () => {
      window.removeEventListener('pointerup', handleRelease);
      window.removeEventListener('touchend', handleRelease);
    };
  }, [isAdjustingWallpaper]);
  const [fullscreenMedia, setFullscreenMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  // Conversations state
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // Discussions modal state (Text Someone)
  const [showDiscussionsModal, setShowDiscussionsModal] = useState<boolean>(false);

  const activeFont = CHAT_FONTS.find((f) => f.id === chatFontId) || CHAT_FONTS[0];

  const handleSelectFont = (fontId: string) => {
    const selected = CHAT_FONTS.find((f) => f.id === fontId);
    if (!selected) return;

    setChatFontId(fontId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`nochaf_font_${userStorageKey}`, fontId);
    }
  };

  // Media Attachment state (Photos & Videos, maximum 4 at once)
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const [mediaLimitNotice, setMediaLimitNotice] = useState<string | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const isSelectingTextRef = useRef<boolean>(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Document Attachment state (Analyse Document)
  const [attachedDocument, setAttachedDocument] = useState<{
    name: string;
    size: string;
    content: string;
    mimeType?: string;
  } | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Audio Playback state
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const speechIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioAbortControllerRef = useRef<AbortController | null>(null);

  // Immediately stop all audio playback, timers and pending TTS requests
  const stopAllAudio = () => {
    if (audioAbortControllerRef.current) {
      audioAbortControllerRef.current.abort();
      audioAbortControllerRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (speechIntervalRef.current) {
      clearInterval(speechIntervalRef.current);
      speechIntervalRef.current = null;
    }
    activeUtteranceRef.current = null;
    setPlayingAudioId(null);
    setLoadingAudioId(null);
  };

  const handleCopyText = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTextNotice(text);
      setTimeout(() => {
        setCopiedTextNotice(null);
      }, 2500);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  // When leaving page, switching tabs, or unmounting, stop audio immediately
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopAllAudio();
      }
    };
    const handleLeave = () => {
      stopAllAudio();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);

    return () => {
      stopAllAudio();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleLeave);
      window.removeEventListener('beforeunload', handleLeave);
    };
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Close plus menu when clicked outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setShowPlusMenu(false);
      }
    };
    if (showPlusMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPlusMenu]);

  // Load conversation list
  useEffect(() => {
    if (!user || user.uid.startsWith('guest_')) {
      try {
        const saved = localStorage.getItem('nochaf_guest_conversations');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed.sort((a, b) => {
              const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
              const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
              return timeB - timeA;
            });
            setConversations(parsed);
          } else {
            setConversations([]);
          }
        }
      } catch {
        setConversations([]);
      }
      return;
    }

    try {
      const userCached = localStorage.getItem(`nochaf_convs_${user.uid}`);
      if (userCached) {
        const parsed = JSON.parse(userCached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.sort((a, b) => {
            const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
            const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return timeB - timeA;
          });
          setConversations(parsed);
        }
      }
    } catch {}

    const convsRef = collection(db, 'users', user.uid, 'conversations');
    const unsub = onSnapshot(
      convsRef,
      (snap) => {
        const list: Conversation[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as any) });
        });
        list.sort((a, b) => {
          const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return timeB - timeA;
        });
        try {
          localStorage.setItem(`nochaf_convs_${user.uid}`, JSON.stringify(list));
        } catch {}
        setConversations(list);
      },
      (err) => console.warn('Conversations sync notice:', err.message)
    );

    return () => unsub();
  }, [user?.uid]);

  // Load active conversation messages from Firestore
  useEffect(() => {
    if (user && activeConvId && !user.uid.startsWith('guest_') && auth.currentUser) {
      const convDocRef = doc(db, 'users', user.uid, 'conversations', activeConvId);
      const unsub = onSnapshot(
        convDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data?.messages && Array.isArray(data.messages)) {
              updateMessages(data.messages);
              if (data.mode) setActiveMode(data.mode);
            }
          }
        },
        (err) => {
          console.warn('Active conversation sync notice:', err.message);
        }
      );
      return () => unsub();
    }
  }, [user?.uid, activeConvId]);

  useEffect(() => {
    if (isSelectingTextRef.current) return;
    const activeSelection = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
    if (activeSelection && activeSelection.length > 0) return;

    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Handle Document Pick
  const handleDocSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeKb = Math.round(file.size / 1024);
    const sizeStr = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

    const textTypes = ['text/', 'application/json', 'application/csv', 'application/xml', 'application/javascript'];
    const isText =
      textTypes.some((t) => file.type.startsWith(t)) ||
      /\.(txt|md|csv|json|xml|html|js|ts|tsx|jsx|py|java|c|cpp|sql|yaml|yml|log|env|rst|tex)$/i.test(file.name);

    if (isText) {
      const reader = new FileReader();
      reader.onload = () => {
        const textContent = reader.result as string;
        setAttachedDocument({
          name: file.name,
          size: sizeStr,
          content: textContent.slice(0, 150000),
          mimeType: file.type || 'text/plain',
        });
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setAttachedDocument({
          name: file.name,
          size: sizeStr,
          content: base64,
          mimeType: file.type || 'application/octet-stream',
        });
      };
      reader.readAsDataURL(file);
    }

    if (docInputRef.current) docInputRef.current.value = '';
    setShowPlusMenu(false);
  };

  // Handle Media Pick (maximum 4)
  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(e.target.files || []);
    if (rawFiles.length === 0) return;

    const remainingSlots = 4 - attachments.length;
    if (remainingSlots <= 0) {
      setMediaLimitNotice('Maximum 4 photos or videos allowed at once.');
      setTimeout(() => setMediaLimitNotice(null), 3000);
      if (mediaInputRef.current) mediaInputRef.current.value = '';
      setShowPlusMenu(false);
      return;
    }

    if (rawFiles.length > remainingSlots) {
      setMediaLimitNotice(`Maximum 4 media items allowed at once. Selected the first ${remainingSlots}.`);
      setTimeout(() => setMediaLimitNotice(null), 3500);
    }

    const filesToProcess = rawFiles.slice(0, remainingSlots);

    filesToProcess.forEach((file) => {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isImage && !isVideo) return;

      const sizeMb = file.size / (1024 * 1024);
      const sizeStr = sizeMb >= 1 ? `${sizeMb.toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`;

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];

        const newMedia: MediaAttachment = {
          id: 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          type: isVideo ? 'video' : 'image',
          base64,
          mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
          name: file.name,
          size: sizeStr,
          intent: 'general',
        };

        setAttachments((prev) => {
          if (prev.length >= 4) return prev;
          return [...prev, newMedia];
        });
      };
      reader.readAsDataURL(file);
    });

    if (mediaInputRef.current) mediaInputRef.current.value = '';
    setShowPlusMenu(false);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Save conversation to storage
  const saveConversationToStorage = async (
    convId: string,
    msgs: ChatMessage[],
    customTitle?: string
  ) => {
    const title =
      customTitle ||
      (msgs.find((m) => m.role === 'user')?.content.slice(0, 36) || 'New Conversation');

    const updatedItem: Conversation = {
      id: convId,
      userId: user ? user.uid : 'guest',
      title: title.trim(),
      messages: msgs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: activeMode,
    };

    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== convId);
      return [updatedItem, ...filtered];
    });

    try {
      localStorage.setItem(`nochaf_conv_messages_${convId}`, JSON.stringify(msgs));
    } catch {}

    if (user) {
      try {
        const convRef = doc(db, 'users', user.uid, 'conversations', convId);
        await setDoc(
          convRef,
          {
            title: updatedItem.title,
            messages: msgs,
            updatedAt: new Date().toISOString(),
            mode: activeMode,
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('Could not sync conversation to Firestore:', err);
      }
    } else {
      try {
        const saved = localStorage.getItem('nochaf_guest_conversations');
        const parsed = saved ? JSON.parse(saved) : [];
        const filtered = parsed.filter((c: any) => c.id !== convId);
        localStorage.setItem(
          'nochaf_guest_conversations',
          JSON.stringify([updatedItem, ...filtered])
        );
      } catch (err) {
        console.warn('Could not save guest conversation to localStorage:', err);
      }
    }
  };

  const handleSelectConversation = (conv: Conversation) => {
    updateActiveConvId(conv.id);
    updateMessages(conv.messages || []);
    if (conv.mode) setActiveMode(conv.mode);
    setIsSidebarOpen(false);
  };

  const handleNewChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStreaming(false);
    updateMessages([]);
    setInputText('');
    setAttachments([]);
    setAttachedDocument(null);
    const newId = 'chat_' + Date.now();
    updateActiveConvId(newId);
    setIsSidebarOpen(false);
  };

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations((prev) => prev.filter((c) => c.id !== convId));

    if (user) {
      try {
        const convRef = doc(db, 'users', user.uid, 'conversations', convId);
        await deleteDoc(convRef);
      } catch (err) {
        console.warn('Failed to delete conversation:', err);
      }
    } else {
      try {
        const saved = localStorage.getItem('nochaf_guest_conversations');
        if (saved) {
          const parsed = JSON.parse(saved);
          const filtered = parsed.filter((c: any) => c.id !== convId);
          localStorage.setItem('nochaf_guest_conversations', JSON.stringify(filtered));
        }
      } catch {}
    }

    if (activeConvId === convId) {
      handleNewChat();
    }
  };

  const handleClearAllConversations = async () => {
    setConversations([]);
    handleNewChat();

    if (user) {
      try {
        localStorage.removeItem(`nochaf_convs_${user.uid}`);
      } catch {}
    } else {
      localStorage.removeItem('nochaf_guest_conversations');
    }
  };

  // Wallpaper selection handlers
  const handleSelectWallpaperColor = (wp: WallpaperConfig) => {
    const updated: WallpaperConfig = {
      ...wp,
      blur: 0,
      brightness: 100,
      dim: 0,
    };
    updateWallpaper(updated);
  };

  const handlePickGalleryWallpaper = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file from your gallery.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const customWp: WallpaperConfig = {
        type: 'image',
        value: result,
        name: file.name.slice(0, 20) || 'Gallery Picture',
        blur: 0,
        brightness: 100,
        dim: 0,
      };
      updateWallpaper(customWp);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUpdateWallpaperBlur = (blur: number) => {
    updateWallpaper({ ...wallpaper, blur });
  };

  const handleUpdateWallpaperBrightness = (brightness: number) => {
    updateWallpaper({ ...wallpaper, brightness });
  };

  const handleUpdateWallpaperDim = (dim: number) => {
    updateWallpaper({ ...wallpaper, dim });
  };

  const handleResetWallpaper = () => {
    const def = WALLPAPER_PALETTE.find((w) => w.name === 'Black') || WALLPAPER_PALETTE[9];
    updateWallpaper(def);
  };

  // Pure Online Internet Messaging via Gemini 2.5 Flash
  const handleSendMessage = async () => {
    if (!inputText.trim() && attachments.length === 0 && !attachedDocument) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const currentAbort = new AbortController();
    abortControllerRef.current = currentAbort;

    const isFreshConversation = messages.length === 0;
    const userMsgId = 'user_' + Date.now();
    const finalContent = inputText.trim();

    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content:
        finalContent ||
        (attachedDocument
          ? `Analyse ${attachedDocument.name}`
          : attachments.length > 0
          ? `Sent ${attachments.length} media file${attachments.length > 1 ? 's' : ''}`
          : 'Media query'),
      taskType: activeMode === 'math' ? 'mathematics' : activeMode,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      imageBase64: attachments.find((a) => a.type === 'image')?.base64,
      imageMimeType: attachments.find((a) => a.type === 'image')?.mimeType,
      documentName: attachedDocument?.name,
      documentSize: attachedDocument?.size,
      documentContent: attachedDocument?.content,
    };

    const newHistory = [...messages, userMsg];
    updateMessages(newHistory);
    setInputText('');
    setAttachments([]);
    setAttachedDocument(null);

    const assistantMsgId = 'asst_' + Date.now();

    // Asynchronously save memory in background if requested, but never intercept with hardcoded canned reply
    const rememberMatch = finalContent.match(/^(?:please\s+)?remember\s+(?:that\s+)?(.+)/i);
    if (rememberMatch && user) {
      const fact = rememberMatch[1].trim();
      try {
        const memRef = doc(collection(db, 'users', user.uid, 'memories'));
        setDoc(memRef, {
          id: memRef.id,
          userId: user.uid,
          key: fact.slice(0, 40),
          value: fact,
          category: 'fact',
          createdAt: new Date().toISOString(),
        }).catch((err) => console.warn('Memory save notice:', err));
      } catch (err) {
        console.warn('Memory save notice:', err);
      }
    }

    // =========================================================================
    // Direct High-Speed Online Streaming via Gemini Flash
    // Answer starts generating and rendering when the 3 animated bubbles move twice (~1400ms)
    // No canned templates or robotic prefixes: natural, human conversation
    // =========================================================================
    setStreaming(true);
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      taskType: activeMode === 'math' ? 'mathematics' : activeMode,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    updateMessages([...newHistory, assistantMsg]);

    // Wave delivery timing:
    // By the time the 3 animated bubbles move two times (~1400ms),
    // the answer has already started generating and streaming into view
    const waveThresholdMs = 1400;
    const sendStartTime = Date.now();

    let accumulatedText = '';
    let isDeliveringToUI = false;

    // Timer that unlocks UI streaming delivery once the 3 bubbles complete 2 wave cycles
    const waveDeliveryTimer = setTimeout(() => {
      if (!currentAbort.signal.aborted) {
        isDeliveringToUI = true;
        if (accumulatedText && accumulatedText.trim().length > 0) {
          updateMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: accumulatedText } : m
            )
          );
        }
      }
    }, waveThresholdMs);

    try {
      const res = await fetch('/api/gemini/chat-stream', {
        method: 'POST',
        signal: currentAbort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newHistory.map((m) => ({
            role: m.role,
            content: m.content,
            attachments: m.attachments,
            imageBase64: m.imageBase64,
            imageMimeType: m.imageMimeType,
            documentName: m.documentName,
            documentContent: m.documentContent,
          })),
          userId: user ? user.uid : undefined,
          memories: memories.length > 0 ? memories : [],
          mode: activeMode,
          userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Nairobi',
          userClientTimeFormatted: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }),
          userClientDateFormatted: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        }),
      });

      if (!res.body) throw new Error('No streaming response');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const data = JSON.parse(raw);
              if (data.text) {
                const cleanChunk = sanitizeSafetyOutput(data.text);
                if (cleanChunk) {
                  accumulatedText += cleanChunk;
                  const elapsed = Date.now() - sendStartTime;
                  if (elapsed >= waveThresholdMs || isDeliveringToUI) {
                    isDeliveringToUI = true;
                    updateMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMsgId ? { ...m, content: accumulatedText } : m
                      )
                    );
                  }
                }
              }
              if (data.error) {
                accumulatedText += `\n[Notice: ${data.error}]`;
                if (isDeliveringToUI) {
                  updateMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: accumulatedText } : m
                    )
                  );
                }
              }
            } catch {
              // ignore partial json
            }
          }
        }
      }

      clearTimeout(waveDeliveryTimer);

      // Conclude sentence cleanly and ensure full delivery (never leave hanging, blank, or dot)
      let finalizedText = accumulatedText.trim();
      if (!finalizedText || /^[.\s]+$/.test(finalizedText)) {
        // Guarantee message is NEVER left unanswered, blank, or a single dot
        finalizedText = finalContent
          ? "I'm right here and ready to help. Could you tell me a bit more about what you'd like to explore?"
          : "Hello! I'm Nochaf.AI. How can I help you today?";
      } else {
        const dangling = /\b(and|or|but|so|because|with|having|that|which|to|for|is|are|was|were|a|an|the|of|in|on|at|by|from|as)$/i;
        if (dangling.test(finalizedText)) {
          finalizedText = finalizedText.replace(dangling, '').trim();
        }
        if (finalizedText.length > 2 && !/[.!?]$/.test(finalizedText) && !finalizedText.endsWith('```')) {
          finalizedText += '.';
        }
      }

      updateMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, content: finalizedText } : m))
      );

      const finalConversation = [
        ...newHistory,
        {
          id: assistantMsgId,
          role: 'assistant' as const,
          content: finalizedText,
          taskType: activeMode === 'math' ? 'mathematics' : activeMode,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ];
      updateMessages(finalConversation);
      await saveConversationToStorage(activeConvId, finalConversation, finalContent.slice(0, 36));
    } catch (err: any) {
      clearTimeout(waveDeliveryTimer);
      if (err.name === 'AbortError') {
        return;
      }
      console.error('Chat stream error:', err);
      const fallbackReply = accumulatedText.trim() && !/^[.\s]+$/.test(accumulatedText.trim())
        ? accumulatedText.trim()
        : "I ran into a temporary connection issue. Please send your message again and I'll answer right away.";
      updateMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: fallbackReply,
              }
            : m
        )
      );
    } finally {
      if (abortControllerRef.current === currentAbort) {
        setStreaming(false);
        abortControllerRef.current = null;
      }
    }
  };

  // Detect language of text for speech synthesis
  const detectSpeechLanguage = (text: string): { bcp47: string; prefix: string; name: string } => {
    if (!text) return { bcp47: 'en-US', prefix: 'en', name: 'English' };

    if (/[\u0600-\u06FF]/.test(text)) return { bcp47: 'ar-SA', prefix: 'ar', name: 'Arabic' };
    if (/[\u0900-\u097F]/.test(text)) return { bcp47: 'hi-IN', prefix: 'hi', name: 'Hindi' };
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return { bcp47: 'ja-JP', prefix: 'ja', name: 'Japanese' };
    if (/[\u4E00-\u9FFF]/.test(text)) return { bcp47: 'zh-CN', prefix: 'zh', name: 'Chinese' };
    if (/[\u0400-\u04FF]/.test(text)) return { bcp47: 'ru-RU', prefix: 'ru', name: 'Russian' };

    const lower = text.toLowerCase();
    const swahiliWords = /\b(habari|jambo|asante|tafadhali|karibu|mimi|wewe|yeye|sisi|ninyi|wao|nini|kwa nini|kwanini|ndio|hapana|jina|katika|kuwa|kufanya|kuhusu|nzuri|sana|pole|hakuna|matata|kazi|kitu|watu|rafiki|siku|leo|kesho|jana|mambo|poa|salama|vizuri|bwana|mama|mtu|watoto|shule|chakula|mungu|lakini|au|kama|hata|hapa|pale|yote|wote|zaidi|kidogo|yako|yangu|yake|yetu|wangu|wako|wake|wetu|kwenye|kutoka|hadi|mpaka|nimefurahi|kwaheri|hujambo|sijambo|shikamoo|marahaba|sawasawa|shida)\b/gi;
    if ((lower.match(swahiliWords) || []).length >= 1) {
      return { bcp47: 'sw-KE', prefix: 'sw', name: 'Swahili' };
    }
    return { bcp47: 'en-US', prefix: 'en', name: 'English' };
  };

  // Play audio using server TTS with full text without truncation
  const playServerTTS = async (
    msgId: string,
    textToSpeak: string,
    langPrefix: string,
    signal?: AbortSignal
  ): Promise<boolean> => {
    try {
      setLoadingAudioId(msgId);
      const res = await fetch('/api/gemini/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          text: textToSpeak,
          lang: langPrefix,
          voice: 'Puck',
        }),
      });

      if (signal?.aborted) return false;
      const data = await res.json();
      if (signal?.aborted) return false;

      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        currentAudioRef.current = audio;
        audio.onended = () => {
          setPlayingAudioId(null);
          setLoadingAudioId(null);
          currentAudioRef.current = null;
        };
        audio.onerror = () => {
          setPlayingAudioId(null);
          setLoadingAudioId(null);
          currentAudioRef.current = null;
        };
        setPlayingAudioId(msgId);
        setLoadingAudioId(null);
        await audio.play();
        return true;
      }
      setLoadingAudioId(null);
      return false;
    } catch {
      if (!signal?.aborted) {
        setPlayingAudioId(null);
        setLoadingAudioId(null);
      }
      return false;
    }
  };

  // Speak message aloud (Tap to start, tap again to stop; never overlap; reads full paragraph)
  const speakMessage = async (msgId: string, text: string) => {
    // If this message is currently playing or loading, tap again immediately stops it
    if (playingAudioId === msgId || loadingAudioId === msgId) {
      stopAllAudio();
      return;
    }

    // Stop any existing voice or pending request first so voices never override each other
    stopAllAudio();

    const cleanSpeechText = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~#>]/g, '')
      .trim();

    if (!cleanSpeechText) return;

    const abortController = new AbortController();
    audioAbortControllerRef.current = abortController;
    setLoadingAudioId(msgId);

    const langInfo = detectSpeechLanguage(cleanSpeechText);
    const serverSuccess = await playServerTTS(
      msgId,
      cleanSpeechText,
      langInfo.prefix,
      abortController.signal
    );
    if (serverSuccess) return;

    // If request was aborted by user or leaving, abort fallback
    if (abortController.signal.aborted) return;

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setLoadingAudioId(null);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();

      const utterance = new SpeechSynthesisUtterance(cleanSpeechText);
      utterance.lang = langInfo.bcp47;
      utterance.rate = 0.93;
      utterance.pitch = 0.98;

      utterance.onend = () => {
        setPlayingAudioId(null);
        setLoadingAudioId(null);
        activeUtteranceRef.current = null;
      };
      utterance.onerror = () => {
        setPlayingAudioId(null);
        setLoadingAudioId(null);
        activeUtteranceRef.current = null;
      };

      setPlayingAudioId(msgId);
      setLoadingAudioId(null);
      activeUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } catch {
      setPlayingAudioId(null);
      setLoadingAudioId(null);
    }
  };

  return (
    <div
      className="relative flex flex-1 h-full min-h-0 flex-col overflow-hidden transition-all duration-300"
      style={{
        backgroundColor: wallpaper.type === 'color' ? wallpaper.value : '#000000',
      }}
    >
      {/* Wallpaper Layer */}
      <div
        className="absolute inset-0 pointer-events-none z-0 overflow-hidden transition-all duration-150"
        style={{
          backgroundColor: wallpaper.type === 'color' ? wallpaper.value : '#000000',
        }}
      >
        {wallpaper.type === 'image' && (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-75"
              style={{
                backgroundImage: `url(${wallpaper.value})`,
                filter: `blur(${wallpaper.blur || 0}px) brightness(${wallpaper.brightness ?? 100}%)`,
                transform: (wallpaper.blur || 0) > 0 ? 'scale(1.06)' : 'none',
              }}
            />
            {(wallpaper.dim ?? 0) > 0 && (
              <div
                className="absolute inset-0 transition-opacity duration-150"
                style={{
                  backgroundColor: `rgba(0, 0, 0, ${(wallpaper.dim ?? 0) / 100})`,
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Left side drawer button: '>>' button to open details/sidebar drawer (transparent so it doesn't block words) */}
      <button
        type="button"
        onClick={() => setIsSidebarOpen(true)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-12 w-6 rounded-r-lg bg-transparent hover:bg-white/10 text-white/35 hover:text-white border-0 transition-all select-none group cursor-pointer"
        title="Open Details & Conversations"
        aria-label="Open sidebar details"
      >
        <span className="font-mono text-xs font-bold tracking-tighter group-hover:translate-x-0.5 transition-transform text-white/35 group-hover:text-white">
          &gt;&gt;
        </span>
      </button>

      {/* Hidden file inputs */}
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={handleMediaSelect}
        className="hidden"
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".txt,.md,.csv,.json,.xml,.html,.js,.ts,.tsx,.jsx,.py,.pdf,.doc,.docx"
        onChange={handleDocSelect}
        className="hidden"
      />

      {/* Slide-out Sidebar Drawer */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsSidebarOpen(false)}
        >
          <div
            className="w-80 max-w-[85vw] h-full bg-neutral-950 border-r border-white/15 p-4 flex flex-col justify-between shadow-2xl animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="font-semibold text-sm text-white">Nochaf.AI</span>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="rounded-lg p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* WALLPAPER OPTION */}
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsSidebarOpen(false);
                    setShowWallpaperModal(true);
                  }}
                  className="w-full flex items-center justify-between rounded-xl bg-neutral-900 border border-white/15 hover:border-white/30 px-3 py-2.5 text-xs text-white transition-all cursor-pointer"
                  title="Customize chat wallpaper"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🖼️</span>
                    <span className="font-medium text-white">Wallpaper</span>
                  </div>
                </button>
              </div>

              {/* 4. NEW CHAT BUTTON */}
              <button
                onClick={handleNewChat}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 active:bg-neutral-700 text-white font-medium py-2 px-3 text-xs border border-white/15 shadow-sm transition-colors cursor-pointer"
                title="Start a new chat"
              >
                <Plus className="h-4 w-4 text-white" />
                <span className="font-medium text-white">New Chat</span>
              </button>

              {/* 5. RECENT CONVERSATIONS */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <span className="text-[11px] font-mono uppercase text-neutral-400 tracking-wider">
                  Conversations
                </span>
                {conversations.length > 0 && (
                  <button
                    onClick={handleClearAllConversations}
                    className="text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {conversations.length === 0 ? (
                <div className="py-6 text-center text-xs text-neutral-500">
                  No conversations yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => handleSelectConversation(c)}
                      className={`group flex items-center justify-between rounded-xl px-3 py-2 text-xs cursor-pointer transition-colors ${
                        activeConvId === c.id
                          ? 'bg-neutral-800 text-white font-medium border border-white/20'
                          : 'text-neutral-300 hover:bg-neutral-900 hover:text-white'
                      }`}
                    >
                      <div className="truncate flex-1 pr-2">
                        <span className="truncate block">{c.title || 'Untitled conversation'}</span>
                        <span className="text-[10px] text-neutral-400 font-mono capitalize">
                          {c.mode || 'general'}
                        </span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteConversation(c.id, e)}
                        className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors shrink-0"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {!user && (
                <div className="rounded-xl border border-white/10 bg-neutral-950 p-2.5 text-xs text-neutral-400 space-y-2 mt-2">
                  <p className="text-[11px] leading-relaxed text-neutral-400">
                    Sign in to sync your conversations across devices.
                  </p>
                  <button
                    onClick={() => {
                      setIsSidebarOpen(false);
                      onOpenAuth();
                    }}
                    className="w-full rounded-lg bg-white py-1 text-xs font-semibold text-black hover:bg-neutral-200 transition-colors cursor-pointer"
                  >
                    Sign In
                  </button>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="pt-3 border-t border-white/10 text-[11px] text-neutral-500 font-mono flex items-center justify-between">
              <span>Nochaf.AI</span>
              <span className="text-[10px] text-neutral-400 capitalize font-mono">{activeMode}</span>
            </div>
          </div>
        </div>
      )}

      {/* Top Controls Bar - Sticky, always visible above conversation */}
      <div className="sticky top-0 z-30 flex-shrink-0 flex items-center justify-between py-2 px-3 sm:px-5 border-b border-white/[0.08] bg-[#0a0a0c]/60 backdrop-blur-md text-xs">
        {/* Top Left: Always writes "fonts" with dropdown arrow */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsTopFontDropdownOpen(!isTopFontDropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white hover:text-neutral-200 bg-neutral-900/90 hover:bg-neutral-800 rounded-full transition-colors cursor-pointer select-none border border-white/15 shadow-sm outline-none"
            title="Choose font style"
          >
            <span>fonts</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-neutral-300 transition-transform duration-200 ${
                isTopFontDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Dropdown list appearing directly below choose font button */}
          {isTopFontDropdownOpen && (
            <div
              ref={topFontDropdownRef}
              className="absolute top-full left-0 mt-1.5 w-60 rounded-2xl bg-[#121217]/95 border border-white/20 p-1.5 shadow-2xl backdrop-blur-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-neutral-400 border-b border-white/10 mb-1 flex items-center justify-between">
                <span>Select Font</span>
                <span className="text-[9px] text-neutral-400">9 Available</span>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {CHAT_FONTS.map((font) => {
                  const isSelected = chatFontId === font.id;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      onClick={() => {
                        handleSelectFont(font.id);
                        setIsTopFontDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-white text-black font-semibold shadow-sm'
                          : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                      }`}
                    >
                      <div className="truncate pr-2">
                        <span
                          className="block font-medium truncate text-sm"
                          style={{ fontFamily: font.fontFamily }}
                        >
                          {font.name}
                        </span>
                        <span className="text-[10px] opacity-75 block truncate">{font.desc}</span>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-current stroke-[2.5]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Top Right: Text Someone / Read message(s) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenTextSomeone}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-sm select-none ${
              unreadCount > 0
                ? 'bg-neutral-900 border-emerald-500/40 text-white hover:border-emerald-400 hover:bg-neutral-850 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                : 'bg-neutral-900/90 text-neutral-200 hover:text-white hover:bg-neutral-800 border-white/15'
            }`}
            title={unreadCount > 0 ? 'unread' : 'Text someone'}
          >
            {unreadCount > 0 ? (
              <>
                {/* 3D circle notification appearing at the left side showing the number */}
                <div
                  className="relative flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full text-[10.5px] font-extrabold text-white shadow-[0_2px_6px_rgba(16,185,129,0.6),inset_0_1.5px_2px_rgba(255,255,255,0.85),inset_0_-2px_4px_rgba(0,0,0,0.6)] bg-gradient-to-b from-emerald-400 via-emerald-600 to-emerald-900 border border-emerald-300/40 shrink-0 select-none animate-in zoom-in-75"
                >
                  <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-2 h-0.5 bg-white/80 rounded-full pointer-events-none" />
                  <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] leading-none font-mono">
                    {unreadCount}
                  </span>
                </div>
                {/* Replaced read message with unread */}
                <span className="font-semibold text-white">
                  unread
                </span>
              </>
            ) : (
              <>
                <MessageSquare className="h-3.5 w-3.5 text-neutral-300" />
                <span>text someone</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Center Screen: Clean Normal Font affected by font selector (disappears when typing starts) */}
        {messages.length === 0 && !inputText.trim() && attachments.length === 0 && !attachedDocument && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none px-4 text-center z-10 animate-in fade-in duration-200">
            <h1
              style={{ fontFamily: activeFont.fontFamily }}
              className="text-2xl sm:text-3xl md:text-4xl font-normal tracking-normal text-neutral-200 transition-all drop-shadow-md"
            >
              How may I help you?
            </h1>
          </div>
        )}

        {/* Chat Messages List */}
        <div
          ref={chatContainerRef}
          onMouseDown={() => {
            isSelectingTextRef.current = true;
          }}
          onMouseUp={() => {
            setTimeout(() => {
              isSelectingTextRef.current = false;
            }, 120);
          }}
          style={{ fontFamily: activeFont.fontFamily }}
          className="flex-1 min-h-0 overflow-y-auto space-y-6 sm:space-y-8 py-6 px-3 sm:px-5 pr-4 sm:pr-6 chat-selection-area select-text"
        >
          {messages.map((m) => {
            const isUser = m.role === 'user';

            return isUser ? (
              /* User Query */
              <div key={m.id} className="w-full flex flex-col items-end pt-1">
                {m.documentName && (
                  <div className="mb-2 flex items-center gap-2.5 rounded-2xl bg-neutral-900 border border-white/20 px-3.5 py-2 text-xs text-white max-w-[85%] sm:max-w-[75%] shadow-md select-none">
                    <FileText className="h-4 w-4 text-white shrink-0" />
                    <div className="truncate flex-1 text-left">
                      <span className="font-semibold block truncate text-[13px]">{m.documentName}</span>
                      <span className="text-[10px] text-neutral-400">{m.documentSize} • Document Analysed</span>
                    </div>
                  </div>
                )}

                {m.attachments && m.attachments.length > 0 ? (
                  <div
                    className={`mb-2.5 grid gap-2 w-full max-w-sm sm:max-w-md ${
                      m.attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                    }`}
                  >
                    {m.attachments.map((att) => (
                      <div
                        key={att.id}
                        onClick={() => {
                          setFullscreenMedia({
                            url: `data:${att.mimeType};base64,${att.base64}`,
                            type: att.type,
                          });
                        }}
                        className="relative rounded-xl overflow-hidden border border-white/10 bg-neutral-900/90 shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                        title="Tap to view full screen"
                      >
                        {att.type === 'video' ? (
                          <video
                            controls
                            playsInline
                            src={`data:${att.mimeType};base64,${att.base64}`}
                            className="max-h-52 w-full object-cover rounded-xl bg-black"
                          />
                        ) : (
                          <img
                            src={`data:${att.mimeType};base64,${att.base64}`}
                            alt=""
                            draggable={false}
                            className="max-h-52 w-full object-cover rounded-xl select-none"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ) : m.imageBase64 ? (
                  <div className="mb-2 flex justify-end">
                    <img
                      src={`data:${m.imageMimeType || 'image/jpeg'};base64,${m.imageBase64}`}
                      alt=""
                      draggable={false}
                      onClick={() => {
                        setFullscreenMedia({
                          url: `data:${m.imageMimeType || 'image/jpeg'};base64,${m.imageBase64}`,
                          type: 'image',
                        });
                      }}
                      className="max-h-56 max-w-xs rounded-2xl border border-white/10 object-contain shadow-lg select-none cursor-pointer hover:opacity-90 transition-opacity"
                      title="Tap to view full screen"
                    />
                  </div>
                ) : null}

                <div className="rounded-2xl bg-neutral-800/60 backdrop-blur-sm border border-white/10 px-4 py-3 text-white text-[15px] sm:text-base font-normal leading-relaxed break-words whitespace-pre-wrap [word-spacing:0.04em] tracking-normal max-w-[85%] sm:max-w-[75%] shadow-sm select-text">
                  {m.content}
                </div>
              </div>
            ) : (
              /* Assistant Response */
              <div key={m.id} className="group relative w-full flex flex-col items-start text-left pb-1 space-y-1">
                {!m.content && streaming && m.id === messages[messages.length - 1]?.id ? (
                  <div className="flex items-center py-2 px-1 w-fit animate-in fade-in duration-150">
                    <div className="flex items-center gap-2 py-1">
                      <span className="h-2 w-2 rounded-full bg-neutral-300 animate-wave-1" />
                      <span className="h-2 w-2 rounded-full bg-neutral-400 animate-wave-2" />
                      <span className="h-2 w-2 rounded-full bg-neutral-200 animate-wave-3" />
                    </div>
                  </div>
                ) : (
                  <div className="w-full text-neutral-200 leading-relaxed text-[15px] sm:text-base break-words [word-spacing:0.04em] tracking-normal overflow-x-auto text-left">
                    <MarkdownView content={m.content} />
                    {streaming && m.id === messages[messages.length - 1]?.id && (
                      <span className="inline-block w-1.5 h-4 ml-1 bg-white/70 animate-pulse align-middle" />
                    )}
                  </div>
                )}

                {/* Voice audio playback button */}
                {m.content && (
                  <div className="pt-1 flex items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => speakMessage(m.id, m.content)}
                      className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                        playingAudioId === m.id
                          ? 'border-white/30 text-white bg-white/10'
                          : 'border-white/10 text-neutral-400 hover:text-white hover:bg-neutral-900'
                      }`}
                      title={playingAudioId === m.id ? 'Stop Voice' : 'Read Aloud'}
                    >
                      {loadingAudioId === m.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : playingAudioId === m.id ? (
                        <VolumeX className="h-3 w-3" />
                      ) : (
                        <Volume2 className="h-3 w-3" />
                      )}
                      <span>{playingAudioId === m.id ? 'Stop' : 'Voice'}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area: Transparent so wallpaper flows perfectly around typing board */}
      <div className="flex-shrink-0 relative pt-2 pb-2 sm:pb-3 px-3 sm:px-5 bg-transparent z-10">
        {/* Attached Document Preview */}
        {attachedDocument && (
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-white/20 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 shadow-md">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-800 text-white">
              <FileText className="h-4 w-4" />
            </div>
            <div className="flex-1 truncate">
              <span className="font-semibold text-white truncate block text-xs">{attachedDocument.name}</span>
              <span className="text-[10px] text-neutral-400">{attachedDocument.size} • Ready to analyse</span>
            </div>
            <button
              type="button"
              onClick={() => setAttachedDocument(null)}
              className="rounded-full bg-neutral-800 p-1 text-neutral-400 hover:text-white transition-colors cursor-pointer"
              title="Remove document"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Media Attachments Preview */}
        {attachments.length > 0 && (
          <div className="mb-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 px-1">
              <span>Attached Media ({attachments.length}/4)</span>
              {attachments.length >= 4 && (
                <span className="text-white font-semibold text-[10px]">Max 4 reached</span>
              )}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="relative flex items-center gap-2 rounded-xl border border-white/15 bg-neutral-900/95 p-1.5 pr-2.5 shadow-lg shrink-0 max-w-[210px]"
                >
                  {att.type === 'video' ? (
                    <div className="h-10 w-10 rounded-lg bg-neutral-800 flex items-center justify-center border border-white/10 text-white shrink-0">
                      <Video className="h-5 w-5 text-neutral-200" />
                    </div>
                  ) : (
                    <img
                      src={`data:${att.mimeType};base64,${att.base64}`}
                      alt=""
                      draggable={false}
                      className="h-10 w-10 rounded-lg object-cover border border-white/10 shrink-0 select-none"
                    />
                  )}
                  <div className="flex flex-col text-xs text-neutral-300 min-w-0 pr-1">
                    <span className="font-medium truncate text-white text-[11px]">{att.type === 'video' ? 'Video' : 'Photo'}</span>
                    <span className="text-[9px] font-mono text-neutral-400 uppercase">
                      {att.type} • {att.size}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="rounded-lg p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors shrink-0 cursor-pointer"
                    title="Remove attachment"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Media limit toast notice */}
        {mediaLimitNotice && (
          <div className="mb-2 text-xs text-white bg-neutral-900 border border-white/20 rounded-xl px-3 py-1.5 animate-in fade-in">
            {mediaLimitNotice}
          </div>
        )}

        {/* Plus (+) Options Popup Menu */}
        {showPlusMenu && (
          <div
            ref={plusMenuRef}
            className="absolute bottom-14 left-2 z-30 w-60 rounded-2xl border border-white/15 bg-[#121217] p-2 shadow-2xl animate-in slide-in-from-bottom-2 duration-150"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-neutral-400 border-b border-white/10 mb-1">
              Files & Media Actions
            </div>

            <button
              type="button"
              onClick={() => {
                setShowPlusMenu(false);
                mediaInputRef.current?.click();
              }}
              className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs text-neutral-200 hover:bg-neutral-800 hover:text-white transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <ImageIcon className="h-4 w-4 text-neutral-300" />
                <span>Photos & Videos</span>
              </div>
              <span className="text-[10px] text-neutral-400 font-mono">Max 4</span>
            </button>


            <button
              type="button"
              onClick={() => {
                setShowPlusMenu(false);
                docInputRef.current?.click();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs text-neutral-200 hover:bg-neutral-800 hover:text-white transition-colors cursor-pointer"
            >
              <FileText className="h-4 w-4 text-neutral-300" />
              <span>Analyse Document</span>
            </button>
          </div>
        )}

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative flex items-center rounded-2xl border border-white/20 bg-black/80 backdrop-blur-xl px-2.5 py-1.5 shadow-2xl focus-within:border-white h-12 w-full transition-all"
        >
          {/* Left side '+' icon button */}
          <button
            type="button"
            onClick={() => setShowPlusMenu(!showPlusMenu)}
            className={`rounded-xl p-1.5 transition-colors cursor-pointer ${
              showPlusMenu || attachments.length > 0 || attachedDocument
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
            }`}
            title="Attach photos, videos, or analyse documents"
          >
            <Plus className="h-4 w-4" />
          </button>

          {/* Typing input */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={messages.length > 0 ? '' : 'say something'}
            className="flex-1 bg-transparent px-2.5 text-xs sm:text-[13px] text-white placeholder-neutral-500 focus:outline-none"
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={!inputText.trim() && attachments.length === 0 && !attachedDocument}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-100 text-black hover:bg-white disabled:opacity-30 transition-all shadow shrink-0 cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>

      {/* Chat Wallpaper Panel - Real screen live view without blocking backdrop */}
      {showWallpaperModal && (
        <div
          className={`fixed bottom-3 right-3 left-3 sm:left-auto sm:right-4 sm:w-96 z-50 rounded-2xl border border-white/20 bg-neutral-900/90 p-4 shadow-2xl backdrop-blur-md space-y-3 max-h-[50vh] sm:max-h-[60vh] overflow-y-auto transition-opacity duration-200 ${
            isAdjustingWallpaper ? 'opacity-20' : 'opacity-100'
          }`}
          onClick={(e) => e.stopPropagation()}
          onPointerUp={() => setIsAdjustingWallpaper(false)}
        >
          <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-base">🖼️</span>
              <div>
                <h3 className="text-xs font-semibold text-white">Chat Wallpaper</h3>
                <p className="text-[10px] text-neutral-400">Choose colour or gallery photo</p>
              </div>
            </div>
            <button
              onClick={() => {
                setShowWallpaperModal(false);
                setIsAdjustingWallpaper(false);
              }}
              className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 1. CHOOSE COLOUR */}
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-white flex items-center gap-1">
                <span>🎨</span>
                <span>Colours</span>
              </span>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {WALLPAPER_PALETTE.map((wp) => {
                const isSelected = wallpaper.type === 'color' && wallpaper.value.toLowerCase() === wp.value.toLowerCase();
                return (
                  <button
                    key={wp.name}
                    type="button"
                    onClick={() => handleSelectWallpaperColor(wp)}
                    title={wp.name}
                    className={`group relative flex items-center justify-center p-0.5 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-white scale-105 shadow-md ring-2 ring-white bg-neutral-800'
                        : 'border-white/20 hover:border-white/50 hover:scale-102 bg-neutral-900/60'
                    }`}
                  >
                    <div
                      className="w-full h-7 rounded flex items-center justify-center shadow-inner relative border border-white/10"
                      style={{ backgroundColor: wp.value }}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] stroke-[3]" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. CHOOSE FROM GALLERY */}
          <div className="space-y-2 pt-2 border-t border-white/10">
            <input
              ref={wallpaperInputRef}
              type="file"
              accept="image/*"
              onChange={handlePickGalleryWallpaper}
              className="hidden"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => wallpaperInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-neutral-200 text-black py-2 px-3 text-xs font-semibold shadow-md transition-all cursor-pointer"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                <span>Gallery Picture</span>
              </button>

              {wallpaper.type === 'image' && (
                <button
                  type="button"
                  onClick={handleResetWallpaper}
                  className="rounded-xl border border-white/20 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white py-2 px-3 text-xs font-medium transition-colors cursor-pointer"
                  title="Remove picture & reset to default"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* 3. BLUR & LIGHT EXPOSURE OPTIONS */}
          {wallpaper.type === 'image' && (
            <div className="space-y-2.5 pt-2 border-t border-white/10">
              {/* BLUR CONTROL */}
              <div className="rounded-xl border border-white/10 bg-neutral-950/70 p-2.5 space-y-1.5">
                <div className="flex justify-between items-center text-[11px] text-neutral-200">
                  <span className="font-medium flex items-center gap-1.5">
                    <Eye className="h-3 w-3 text-white" />
                    <span>Blur</span>
                  </span>
                  <span className="font-mono text-[10px] text-neutral-400">{wallpaper.blur ?? 0}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={wallpaper.blur ?? 0}
                  onPointerDown={() => setIsAdjustingWallpaper(true)}
                  onPointerUp={() => setIsAdjustingWallpaper(false)}
                  onTouchStart={() => setIsAdjustingWallpaper(true)}
                  onTouchEnd={() => setIsAdjustingWallpaper(false)}
                  onChange={(e) => handleUpdateWallpaperBlur(Number(e.target.value))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>

              {/* LIGHT EXPOSURE CONTROL */}
              <div className="rounded-xl border border-white/10 bg-neutral-950/70 p-2.5 space-y-1.5">
                <div className="flex justify-between items-center text-[11px] text-neutral-200">
                  <span className="font-medium flex items-center gap-1.5">
                    <Sun className="h-3 w-3 text-white" />
                    <span>Light Exposure</span>
                  </span>
                  <span className="font-mono text-[10px] text-neutral-400">{wallpaper.brightness ?? 100}%</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="160"
                  step="5"
                  value={wallpaper.brightness ?? 100}
                  onPointerDown={() => setIsAdjustingWallpaper(true)}
                  onPointerUp={() => setIsAdjustingWallpaper(false)}
                  onTouchStart={() => setIsAdjustingWallpaper(true)}
                  onTouchEnd={() => setIsAdjustingWallpaper(false)}
                  onChange={(e) => handleUpdateWallpaperBrightness(Number(e.target.value))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>

              {/* CONTRAST DIM TINT CONTROL */}
              <div className="rounded-xl border border-white/10 bg-neutral-950/70 p-2.5 space-y-1.5">
                <div className="flex justify-between items-center text-[11px] text-neutral-200">
                  <span>Dim Tint</span>
                  <span className="font-mono text-[10px] text-neutral-400">{wallpaper.dim ?? 0}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="75"
                  step="5"
                  value={wallpaper.dim ?? 0}
                  onPointerDown={() => setIsAdjustingWallpaper(true)}
                  onPointerUp={() => setIsAdjustingWallpaper(false)}
                  onTouchStart={() => setIsAdjustingWallpaper(true)}
                  onTouchEnd={() => setIsAdjustingWallpaper(false)}
                  onChange={(e) => handleUpdateWallpaperDim(Number(e.target.value))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-end items-center border-t border-white/10">
            <button
              type="button"
              onClick={() => {
                setShowWallpaperModal(false);
                setIsAdjustingWallpaper(false);
              }}
              className="rounded-xl bg-white text-black hover:bg-neutral-200 px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen Media Viewer (nothing else on borders, plain full picture/video) */}
      {fullscreenMedia && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-0 animate-in fade-in duration-200 cursor-pointer"
          onClick={() => setFullscreenMedia(null)}
        >
          <button
            type="button"
            onClick={() => setFullscreenMedia(null)}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-neutral-800/80 text-white hover:bg-neutral-700 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="h-6 w-6" />
          </button>
          {fullscreenMedia.type === 'video' ? (
            <video
              src={fullscreenMedia.url}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={fullscreenMedia.url}
              alt=""
              className="max-h-full max-w-full object-contain select-none allow-pinch-zoom"
            />
          )}
        </div>
      )}

      {/* Floating Copy Toast with visible text preview during the copy process */}
      {copiedTextNotice && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%] rounded-2xl bg-neutral-900/95 border border-white/20 p-3 shadow-2xl text-xs text-white backdrop-blur-md animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold mb-1">
            <Check className="h-3.5 w-3.5 stroke-[3]" />
            <span>Copied to clipboard</span>
          </div>
          <p className="text-[11px] text-neutral-200 line-clamp-3 italic bg-black/60 p-2 rounded-xl border border-white/10 font-mono select-text">
            "{copiedTextNotice}"
          </p>
        </div>
      )}

      {/* Discussions Modal (Text Someone - Direct & Group Messaging) */}
      <GeniusDiscussionsModal
        isOpen={showDiscussionsModal}
        onClose={() => setShowDiscussionsModal(false)}
        onOpenAuth={onOpenAuth}
        initialTab={discussionInitialTab}
      />
    </div>
  );
};
