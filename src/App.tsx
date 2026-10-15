/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/layout/Navbar';
import { NochafAI } from './components/nochaf-ai/NochafAI';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { TextSomeonePage } from './components/messaging/TextSomeonePage';
import { AuthModal } from './components/auth/AuthModal';
import { AIMemory } from './types';
import { auth, db, collection, onSnapshot } from './lib/firebase';
import { initPresence } from './services/presence';

function NochafApp() {
  const { user, profile, error: authError, clearError } = useAuth();
  const [isAdminView, setIsAdminView] = useState(false);
  const [currentView, setCurrentView] = useState<'ai' | 'messages' | 'admin'>('ai');
  const [inActiveConversation, setInActiveConversation] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState<'create_account' | 'login' | undefined>(undefined);
  const [backTrigger, setBackTrigger] = useState(0);

  useEffect(() => {
    if (currentView !== 'messages') {
      setInActiveConversation(false);
    }
  }, [currentView]);

  // Initialize browser history and support device/browser back key to go to previous page
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.history.state == null) {
      window.history.replaceState({ view: 'ai' }, '');
    }

    const handlePopState = () => {
      if (showAuthModal) {
        setShowAuthModal(false);
        return;
      }
      if (currentView === 'messages') {
        if (inActiveConversation) {
          // Tell TextSomeonePage to exit the current chat back to chat list
          setBackTrigger((prev) => prev + 1);
        } else {
          // On chats list: back key goes to Nochaf AI page
          setCurrentView('ai');
          setIsAdminView(false);
        }
        return;
      }
      if (currentView === 'admin') {
        setCurrentView('ai');
        setIsAdminView(false);
        return;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showAuthModal, currentView, inActiveConversation]);

  const handleOpenAuth = (mode?: 'create_account' | 'login') => {
    if (typeof window !== 'undefined') {
      window.history.pushState({ modal: 'auth' }, '');
    }
    setAuthModalInitialMode(mode);
    setShowAuthModal(true);
  };

  // AI Workspace & Memory state: ONLY preserved for authenticated accounts
  const [memories, setMemories] = useState<AIMemory[]>([]);

  useEffect(() => {
    // If not logged in or guest demo: forget everything and clear memories
    if (!user || user.uid.startsWith('guest_')) {
      setMemories([]);
      try {
        localStorage.removeItem('nochaf_persistent_memories');
      } catch {}
      return;
    }

    // Authenticated user: Load memories only for this specific account
    try {
      const saved = localStorage.getItem(`nochaf_memories_${user.uid}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMemories(parsed);
        }
      }
    } catch {}

    const memoriesRef = collection(db, 'users', user.uid, 'memories');
    const unsub = onSnapshot(
      memoriesRef,
      (snap) => {
        const items: AIMemory[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }));
        try {
          localStorage.setItem(`nochaf_memories_${user.uid}`, JSON.stringify(items));
        } catch {}
        setMemories(items);
      },
      (err) => {
        console.warn('Memory sync notice:', err.message);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  // WhatsApp-style presence initialization: Foreground online, onDisconnect offline, background > 60s offline, 15s heartbeat, Firestore mirroring
  useEffect(() => {
    if (!user?.uid || user.uid.startsWith('guest_')) return;
    const cleanup = initPresence(user.uid);
    return () => cleanup();
  }, [user?.uid]);

  // Unread messages from someone while in Nochaf AI
  const [unreadSender, setUnreadSender] = useState<{
    name: string;
    avatar?: string;
  } | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // Online toast notification banner (disappears in 3 seconds)
  const [onlineToast, setOnlineToast] = useState<string | null>(null);

  const triggerOnlineToast = (name: string) => {
    setOnlineToast(name);
    setTimeout(() => {
      setOnlineToast(null);
    }, 3000); // exactly 3 seconds
  };

  // Auto-clear auth error notice after 3 seconds
  useEffect(() => {
    if (authError) {
      const timer = setTimeout(() => {
        clearError();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [authError, clearError]);

  // Request browser notification permission for phone notification shade
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, []);

  const showPhoneNotification = (title: string, body: string, icon?: string, tag?: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => {
          reg.showNotification(title, {
            body,
            icon: icon || '/manifest.json',
            tag: tag || 'nochaf_dm',
          }).catch(() => {
            try {
              new Notification(title, { body, icon: icon || '/manifest.json', tag });
            } catch {}
          });
        })
        .catch(() => {
          try {
            new Notification(title, { body, icon: icon || '/manifest.json', tag });
          } catch {}
        });
    } else {
      try {
        new Notification(title, { body, icon: icon || '/manifest.json', tag });
      } catch {}
    }
  };

  // Track contacts online status across all conversations so 3-second top toast fires when they come online
  const prevUsersOnlineRef = useRef<Record<string, boolean>>({});

  // Listen to incoming direct messages for notification shade & top right badge
  useEffect(() => {
    if (!user || user.uid.startsWith('guest_')) {
      setUnreadSender(null);
      setUnreadCount(0);
      return;
    }

    const dmRef = collection(db, 'directMessages');
    const unsub = onSnapshot(dmRef, (snap) => {
      let pendingCount = 0;
      let latestSender: { name: string; avatar?: string } | null = null;

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const participants: string[] = data.participants || [];
        const deletedFor: string[] = data.deletedFor || [];

        if (participants.includes(user.uid) && !deletedFor.includes(user.uid)) {
          const otherUid = participants.find((id) => id !== user.uid) || user.uid;
          const otherIdx = participants.indexOf(otherUid);
          const otherHandleRaw = (data.participantHandles && data.participantHandles[otherIdx]) || '';
          const otherHandle = otherHandleRaw.replace(/^@+/, '');
          const otherNameRaw = (data.participantNames && data.participantNames[otherIdx]) || '';
          const otherName = otherNameRaw ? otherNameRaw.replace(/^@+/, '') : (otherHandle ? otherHandle : 'Someone');
          const otherAvatar = (data.participantAvatars && data.participantAvatars[otherUid]) || undefined;

          // If thread has an unread message from the other person
          if (data.lastSenderId && data.lastSenderId !== user.uid && (!data.readBy || !data.readBy.includes(user.uid))) {
            const threadCount = typeof data.unreadCounts?.[user.uid] === 'number' && data.unreadCounts[user.uid] > 0
              ? data.unreadCounts[user.uid]
              : 1;
            pendingCount += threadCount;
            latestSender = { name: otherName, avatar: otherAvatar };

            // Phone notification shade if user is not in messages page or tab is in background
            if (currentView !== 'messages' || (typeof document !== 'undefined' && document.hidden)) {
              showPhoneNotification(
                otherName,
                data.lastMessage || 'Sent you a message',
                otherAvatar,
                `dm_${docSnap.id}`
              );
            }
          }
        }
      });

      if (currentView === 'messages') {
        // Clear badge when actively in messages page
        setUnreadSender(null);
        setUnreadCount(0);
      } else {
        setUnreadSender(latestSender);
        setUnreadCount(pendingCount);
      }
    }, (err) => {
      console.warn('Direct messages badge sync notice:', err.message);
    });

    return () => unsub();
  }, [user?.uid, currentView]);

  const handleSelectView = (view: 'ai' | 'messages' | 'admin') => {
    if (view !== currentView && typeof window !== 'undefined') {
      window.history.pushState({ view }, '');
    }
    setCurrentView(view);
    if (view === 'admin') {
      setIsAdminView(true);
    } else {
      setIsAdminView(false);
    }
  };

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-[#0a0a0c] text-neutral-100 flex flex-col font-sans selection:bg-white selection:text-black relative">
      {/* 1-Second Activity Notification Banner at the top */}
      {onlineToast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full bg-emerald-500 text-black font-bold text-xs shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-md flex items-center gap-2 select-none border border-emerald-300">
          <span className="h-2 w-2 rounded-full bg-black animate-pulse" />
          <span>{onlineToast} is active</span>
        </div>
      )}

      {/* Global Dismissible Error Pop-up Message with (×) to cancel it */}
      {authError && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-[92%] max-w-sm animate-in fade-in slide-in-from-top-3 duration-150">
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-red-500/40 bg-[#161218]/95 p-3.5 text-xs text-red-100 shadow-2xl backdrop-blur-xl ring-1 ring-red-500/30">
            <div className="space-y-0.5 flex-1 pr-1">
              <p className="font-semibold text-red-300">Notice</p>
              <p className="text-[11px] leading-relaxed text-red-200/95">{authError}</p>
            </div>
            <button
              type="button"
              onClick={() => clearError()}
              className="rounded-lg p-1 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer shrink-0"
              title="Dismiss warning (×)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Top Header */}
      <Navbar
        onOpenAuth={() => handleOpenAuth()}
        onOpenAdmin={() => {
          setIsAdminView(true);
          setCurrentView('admin');
        }}
        showAdminTab={profile?.role === 'admin'}
        isAdminView={isAdminView}
        setIsAdminView={setIsAdminView}
        currentView={currentView}
        onSelectView={handleSelectView}
        inActiveConversation={inActiveConversation}
      />

      {/* Main Content Area — Kept mounted so switching views NEVER loses responses or chat state */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        {currentView === 'admin' && profile?.role === 'admin' && (
          <div className="h-full w-full flex flex-col">
            <AdminDashboard />
          </div>
        )}

        <div className={`h-full w-full flex flex-col ${currentView === 'messages' ? '' : 'hidden'}`}>
          <TextSomeonePage
            onBackToAI={() => setCurrentView('ai')}
            onOpenAuth={() => handleOpenAuth('create_account')}
            onOnlineNotification={triggerOnlineToast}
            onActiveChatChange={setInActiveConversation}
            backTrigger={backTrigger}
          />
        </div>

        <div className={`h-full w-full flex flex-col ${currentView === 'ai' && !isAdminView ? '' : 'hidden'}`}>
          <NochafAI
            memories={memories}
            onOpenAuth={() => handleOpenAuth()}
            onOpenTextSomeone={() => setCurrentView('messages')}
            unreadSender={unreadSender}
            unreadCount={unreadCount}
          />
        </div>
      </main>

      {/* Global Modals */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialMode={authModalInitialMode}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NochafApp />
    </AuthProvider>
  );
}
