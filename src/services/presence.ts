/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  db,
  doc,
  updateDoc,
  onSnapshot,
  rtdb,
  rtdbRef,
  rtdbSet,
  rtdbUpdate,
  rtdbRemove,
  rtdbOnValue,
  rtdbOnDisconnect,
  rtdbServerTimestamp,
} from '../lib/firebase';

export interface UserPresenceState {
  online: boolean;
  state: 'online' | 'offline';
  lastSeen?: number | string | any;
  typingTo?: string | null;
}

export interface UserStatusInfo {
  online: boolean;
  lastSeen?: number | string | any;
}

/**
 * Initializes WhatsApp-style presence for the current user using Firebase Realtime Database.
 * - Reference at status/{userId}
 * - Listens to .info/connected
 * - When connected = true, sets { online: true, lastSeen: serverTimestamp() }
 * - Uses onDisconnect to set { online: false, lastSeen: serverTimestamp() }
 */
export function initPresence(uid: string) {
  if (!uid || uid.startsWith('guest_')) return () => {};

  let isOnline = true;
  let heartbeatInterval: any = null;
  let backgroundTimer: any = null;

  const mirrorToFirestore = async (online: boolean) => {
    try {
      const userDocRef = doc(db, 'users', uid);
      await updateDoc(userDocRef, {
        online,
        isOnline: online,
        lastSeen: new Date().toISOString(),
      });
    } catch {
      // Ignore background write errors
    }
  };

  const setOnline = async () => {
    isOnline = true;
    if (rtdb) {
      try {
        const statusRef = rtdbRef(rtdb, `status/${uid}`);
        await rtdbSet(statusRef, {
          online: true,
          state: 'online',
          lastSeen: rtdbServerTimestamp(),
          typingTo: null,
        });

        const disconnectRef = rtdbOnDisconnect(statusRef);
        await disconnectRef.set({
          online: false,
          state: 'offline',
          lastSeen: rtdbServerTimestamp(),
          typingTo: null,
        });
      } catch (err) {
        console.warn('RTDB setOnline warning:', err);
      }
    }
    await mirrorToFirestore(true);
  };

  const setOffline = async () => {
    isOnline = false;
    if (rtdb) {
      try {
        const statusRef = rtdbRef(rtdb, `status/${uid}`);
        await rtdbSet(statusRef, {
          online: false,
          state: 'offline',
          lastSeen: rtdbServerTimestamp(),
          typingTo: null,
        });
      } catch (err) {
        console.warn('RTDB setOffline warning:', err);
      }
    }
    await mirrorToFirestore(false);
  };

  const heartbeat = async () => {
    if (!isOnline) return;
    if (rtdb) {
      try {
        const statusRef = rtdbRef(rtdb, `status/${uid}`);
        await rtdbUpdate(statusRef, {
          online: true,
          state: 'online',
          lastSeen: rtdbServerTimestamp(),
        });
      } catch {}
    }
    await mirrorToFirestore(true);
  };

  // Start online
  setOnline();

  // RTDB .info/connected listener: re-synchronizes online status when connection is re-established
  let unsubConnected: any = null;
  if (rtdb) {
    try {
      const connectedRef = rtdbRef(rtdb, '.info/connected');
      unsubConnected = rtdbOnValue(connectedRef, (snapshot) => {
        if (snapshot.val() === true) {
          setOnline();
        }
      });
    } catch (err) {
      console.warn('RTDB .info/connected listener warning:', err);
    }
  }

  // Heartbeat every 20 seconds
  heartbeatInterval = setInterval(heartbeat, 20000);

  // Background handling: if in background > 60s, go offline; resume -> go online
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      if (backgroundTimer) clearTimeout(backgroundTimer);
      backgroundTimer = setTimeout(() => {
        setOffline();
      }, 60000);
    } else {
      if (backgroundTimer) {
        clearTimeout(backgroundTimer);
        backgroundTimer = null;
      }
      if (!isOnline) {
        setOnline();
      }
    }
  };

  const handleWindowFocus = () => {
    if (backgroundTimer) {
      clearTimeout(backgroundTimer);
      backgroundTimer = null;
    }
    if (!isOnline) {
      setOnline();
    }
  };

  const handleWindowBlur = () => {
    if (!backgroundTimer) {
      backgroundTimer = setTimeout(() => {
        setOffline();
      }, 60000);
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleWindowFocus);
  window.addEventListener('blur', handleWindowBlur);

  return () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (backgroundTimer) clearTimeout(backgroundTimer);
    if (unsubConnected) {
      try {
        unsubConnected();
      } catch {}
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleWindowFocus);
    window.removeEventListener('blur', handleWindowBlur);
    setOffline();
  };
}

/**
 * Updates typing status:
 * Sets typing/{chatId}/{myUserId} = true in Realtime Database.
 * When user stops typing, sets path to null.
 * Uses onDisconnect to guarantee path is cleared if user closes app.
 */
export async function setTypingPresence(
  chatId: string,
  myUserId: string,
  isTyping: boolean
) {
  if (!myUserId || myUserId.startsWith('guest_') || !chatId) return;

  if (rtdb) {
    try {
      const typingRef = rtdbRef(rtdb, `typing/${chatId}/${myUserId}`);
      if (isTyping) {
        await rtdbSet(typingRef, true);
        rtdbOnDisconnect(typingRef).set(null);
      } else {
        await rtdbSet(typingRef, null);
      }
    } catch (e) {
      console.warn('RTDB setTypingPresence warning:', e);
    }
  }
}

/**
 * Subscribes to typing status in a given chat:
 * Listens to typing/{chatId}/{otherUserId} with onValue.
 * Stays open until unsubscribed.
 */
export function subscribeToTyping(
  chatId: string,
  otherUserId: string,
  callback: (isTyping: boolean) => void
) {
  if (!rtdb || !chatId || !otherUserId) {
    callback(false);
    return () => {};
  }

  try {
    const typingRef = rtdbRef(rtdb, `typing/${chatId}/${otherUserId}`);
    const unsub = rtdbOnValue(
      typingRef,
      (snapshot) => {
        const val = snapshot.val();
        callback(val === true);
      },
      (err) => {
        console.warn('RTDB subscribeToTyping error:', err);
        callback(false);
      }
    );
    return () => {
      unsub();
    };
  } catch {
    callback(false);
    return () => {};
  }
}

/**
 * Subscribes to a target user's presence:
 * Listens with onValue to status/{otherUserId} in Realtime Database.
 * Reports { online: boolean, lastSeen: timestamp }.
 * Stays open until cleaned up.
 */
export function subscribeToUserStatus(
  targetUid: string,
  callback: (status: UserStatusInfo) => void
) {
  if (!targetUid || targetUid.startsWith('guest_')) {
    callback({ online: false });
    return () => {};
  }

  let debounceTimer: any = null;
  let lastReportedOnline = false;

  const dispatchStatus = (online: boolean, lastSeen?: any) => {
    if (online) {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      lastReportedOnline = true;
      callback({ online: true, lastSeen });
    } else {
      // Debounce offline by 4 seconds to prevent brief socket flicker
      if (lastReportedOnline) {
        if (!debounceTimer) {
          debounceTimer = setTimeout(() => {
            lastReportedOnline = false;
            callback({ online: false, lastSeen });
            debounceTimer = null;
          }, 4000);
        }
      } else {
        callback({ online: false, lastSeen });
      }
    }
  };

  if (rtdb) {
    try {
      const statusRef = rtdbRef(rtdb, `status/${targetUid}`);
      const unsub = rtdbOnValue(
        statusRef,
        (snapshot) => {
          const val = snapshot.val();
          if (val) {
            const isOnline = val.online === true || val.state === 'online';
            dispatchStatus(isOnline, val.lastSeen);
          } else {
            dispatchStatus(false);
          }
        },
        (err) => {
          console.warn('RTDB subscribeToUserStatus error:', err);
        }
      );

      return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        unsub();
      };
    } catch {}
  }

  // Fallback to Firestore listener
  try {
    const unsubFirestore = onSnapshot(doc(db, 'users', targetUid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const isOnline = !!data?.online || !!data?.isOnline;
        dispatchStatus(isOnline, data?.lastSeen);
      } else {
        dispatchStatus(false);
      }
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubFirestore();
    };
  } catch {
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }
}

/**
 * Backward compatibility alias for subscribeToPresenceWithDebounce
 */
export function subscribeToPresenceWithDebounce(
  targetUid: string,
  callback: (isOnline: boolean) => void
) {
  return subscribeToUserStatus(targetUid, (status) => callback(status.online));
}

/**
 * Formats a lastSeen timestamp into WhatsApp style:
 * "just now", "5m ago", "today at 14:30", "yesterday at 09:15", or "Oct 12 at 18:00"
 */
export function formatLastSeen(lastSeen?: any): string {
  if (!lastSeen) return '';
  let timeMs = 0;
  if (typeof lastSeen === 'number') {
    timeMs = lastSeen;
  } else if (typeof lastSeen === 'string') {
    const parsed = Date.parse(lastSeen);
    if (!isNaN(parsed)) timeMs = parsed;
  } else if (lastSeen?.toMillis) {
    timeMs = lastSeen.toMillis();
  } else if (lastSeen?.seconds) {
    timeMs = lastSeen.seconds * 1000;
  }
  if (!timeMs) return '';

  const diffSec = Math.floor((Date.now() - timeMs) / 1000);
  if (diffSec < 0 || diffSec < 60) return 'just now';
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return `${mins}m ago`;
  }

  const dateObj = new Date(timeMs);
  const now = new Date();
  const isToday =
    dateObj.getDate() === now.getDate() &&
    dateObj.getMonth() === now.getMonth() &&
    dateObj.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    dateObj.getDate() === yesterday.getDate() &&
    dateObj.getMonth() === yesterday.getMonth() &&
    dateObj.getFullYear() === yesterday.getFullYear();

  const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `today at ${timeStr}`;
  if (isYesterday) return `yesterday at ${timeStr}`;

  return `${dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}
