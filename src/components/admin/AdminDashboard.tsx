import React, { useState, useEffect } from 'react';
import { Lock, ShieldAlert, CheckCircle2, UserCheck, RefreshCw, XCircle, Smartphone } from 'lucide-react';
import { db, collection, query, orderBy, onSnapshot, doc, updateDoc, getDocs } from '../../lib/firebase';

interface SpamQueueItem {
  id: string;
  senderUid: string;
  senderHandle: string;
  sampleText: string;
  reason: string;
  status: string;
  createdAt?: string;
  timestamp?: number;
}

interface AppealItem {
  id: string;
  uid: string;
  username: string;
  appealText: string;
  status: string;
  createdAt: string;
}

export const AdminDashboard: React.FC = () => {
  const [spamItems, setSpamItems] = useState<SpamQueueItem[]>([]);
  const [appeals, setAppeals] = useState<AppealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    // 1. Listen to /spamQueue
    const spamRef = collection(db, 'spamQueue');
    const unsubSpam = onSnapshot(
      spamRef,
      (snap) => {
        const items: SpamQueueItem[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }));
        setSpamItems(items);
        setLoading(false);
      },
      (err) => {
        console.warn('Spam queue listener notice:', err);
        setLoading(false);
      }
    );

    // 2. Listen to /appeals
    const appealsRef = collection(db, 'appeals');
    const unsubAppeals = onSnapshot(
      appealsRef,
      (snap) => {
        const items: AppealItem[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }));
        setAppeals(items);
      },
      (err) => {
        console.warn('Appeals listener notice:', err);
      }
    );

    return () => {
      unsubSpam();
      unsubAppeals();
    };
  }, []);

  const handleUnmuteUser = async (uid: string, username: string, appealId?: string, queueId?: string) => {
    try {
      // 1. Unmute user in /users/{uid}
      await updateDoc(doc(db, 'users', uid), {
        isMuted: false,
        mutedUntil: null,
        muteReason: null,
        isFlagged: false,
        isShadowBanned: false,
        hasPendingAppeal: false,
        spamWarningCount: 0,
      });

      // 2. Mark appeal approved if exists
      if (appealId) {
        await updateDoc(doc(db, 'appeals', appealId), {
          status: 'approved',
          resolvedAt: new Date().toISOString(),
        });
      }

      // 3. Mark queue item resolved if exists
      if (queueId) {
        await updateDoc(doc(db, 'spamQueue', queueId), {
          status: 'resolved_unmuted',
          resolvedAt: new Date().toISOString(),
        });
      }

      setActionSuccess(`Successfully unmuted @${username}!`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      alert(`Error unmuting user: ${err.message}`);
    }
  };

  const handleDismissAppeal = async (appealId: string) => {
    try {
      await updateDoc(doc(db, 'appeals', appealId), {
        status: 'rejected',
        resolvedAt: new Date().toISOString(),
      });
      setActionSuccess('Appeal dismissed.');
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const pendingAppeals = appeals.filter((a) => a.status === 'pending');
  const pendingSpamItems = spamItems.filter((s) => s.status === 'pending');

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6 overflow-y-auto">
      {/* Success Notification */}
      {actionSuccess && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Account Isolation Notice */}
      <div className="rounded-2xl border border-white/15 bg-neutral-950 p-5 flex items-start gap-4 shadow-xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 border border-white/10 text-neutral-300">
          <Lock className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-white tracking-tight">
            Strict Account Isolation Enforced
          </h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            In compliance with Nochaf privacy architecture, private user conversations, private files, and personal AI memories remain completely isolated. Administrators manage account moderation, anti-spam appeals, and spam queues.
          </p>
        </div>
      </div>

      {/* SECTION 1: Pending User Appeals ("I'm not spam") */}
      <div className="rounded-2xl border border-white/15 bg-neutral-950 p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Pending Appeals ("I'm not spam")</h3>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {pendingAppeals.length} pending
          </span>
        </div>

        {pendingAppeals.length === 0 ? (
          <p className="text-xs text-neutral-500 italic py-2">No pending appeals. All muted users are resolved.</p>
        ) : (
          <div className="space-y-3">
            {pendingAppeals.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-white/10 bg-neutral-900/80 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">@{item.username}</span>
                    <span className="text-[10px] text-neutral-400 font-mono">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-neutral-300 italic">"{item.appealText}"</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleUnmuteUser(item.uid, item.username, item.id)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 text-black font-semibold text-xs hover:bg-emerald-400 transition-colors cursor-pointer shadow-sm"
                  >
                    Unmute User
                  </button>
                  <button
                    onClick={() => handleDismissAppeal(item.id)}
                    className="px-3 py-1.5 rounded-lg border border-white/10 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 2: Spam Review Queue (/spamQueue) */}
      <div className="rounded-2xl border border-white/15 bg-neutral-950 p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Spam Queue (Human Review)</h3>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            {pendingSpamItems.length} flagged
          </span>
        </div>

        {pendingSpamItems.length === 0 ? (
          <p className="text-xs text-neutral-500 italic py-2">No flagged items in spam queue.</p>
        ) : (
          <div className="space-y-3">
            {pendingSpamItems.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-amber-500/20 bg-neutral-900/80 p-3.5 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">@{item.senderHandle}</span>
                  <span className="text-[10px] text-amber-300 font-mono bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    {item.reason}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-black/50 border border-white/5 font-mono text-[11px] text-neutral-300">
                  {item.sampleText}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => handleUnmuteUser(item.senderUid, item.senderHandle, undefined, item.id)}
                    className="px-3 py-1 rounded-lg bg-emerald-500 text-black font-semibold text-xs hover:bg-emerald-400 transition-colors cursor-pointer"
                  >
                    Unmute & Clear
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
