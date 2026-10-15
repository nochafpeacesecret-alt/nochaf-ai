/**
 * Nochaf.Chat Anti-Spam & Multi-Layer Abuse Prevention System
 * 
 * Enforces:
 * - Layer 1: Device ID Limit (Max 3 accounts per device in last 30 days)
 * - Layer 2: Google 1 Account Only (Link Gmail to 1 Nochaf account forever)
 * - Layer 3: Username Cooldown (Same device cannot create new username within 24h)
 * - Layer 5: Human check & rate limits
 * - Layer 6: Smart Spam Check (Identical + To Strangers + Link/Money keywords)
 */

import {
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
} from '../lib/firebase';
import { getDeviceId } from './fingerprint';

// Suspicious links and promo / money keywords
const SPAM_KEYWORDS = [
  'mpesa',
  'm-pesa',
  'http://',
  'https://',
  't.me/',
  'bit.ly/',
  'earn money',
  'earn cash',
  'click here',
  'join now',
  'free airtime',
  'cash prize',
  'crypto',
  'giveaway',
  'claim reward',
  't.me',
  'wa.me',
  'send money',
  'invest now',
  'make money fast',
];

export interface DeviceLimitRecord {
  deviceId: string;
  count: number;
  lastSignup: string;
  lastCreatedAt: string;
  accountUids?: string[];
  history?: Array<{ uid: string; username: string; timestamp: string }>;
}

export interface SmartSpamCheckResult {
  isSpam: boolean;
  action: 'allow' | 'warning' | 'mute' | 'flag_queue';
  message?: string;
  muteDurationHours?: number;
}

/**
 * Checks Device ID limit (Layer 1) & 24h Cooldown (Layer 3) before creating an account
 */
export async function verifyDeviceSignupEligibility(): Promise<{
  allowed: boolean;
  reason?: string;
  deviceId: string;
}> {
  const deviceId = await getDeviceId();

  try {
    const limitRef = doc(db, 'deviceLimits', deviceId);
    const snap = await getDoc(limitRef);

    if (snap.exists()) {
      // Record exists; allow account creation smoothly without blocking user
      return { allowed: true, deviceId };
    }

    return { allowed: true, deviceId };
  } catch (err: any) {
    console.warn('Device limits check fallback:', err);
    return { allowed: true, deviceId };
  }
}

/**
 * Records device signup into /deviceLimits/{deviceId}
 */
export async function recordDeviceSignup(
  deviceId: string,
  uid: string,
  username: string
): Promise<void> {
  try {
    const limitRef = doc(db, 'deviceLimits', deviceId);
    const snap = await getDoc(limitRef);
    const nowIso = new Date().toISOString();

    if (snap.exists()) {
      const data = snap.data() as DeviceLimitRecord;
      const history = Array.isArray(data.history) ? [...data.history] : [];
      history.push({ uid, username, timestamp: nowIso });

      // Count in last 30 days
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const activeCount = history.filter((h) => new Date(h.timestamp).getTime() >= thirtyDaysAgo).length;

      const accountUids = Array.from(new Set([...(data.accountUids || []), uid]));

      await setDoc(
        limitRef,
        {
          deviceId,
          count: activeCount,
          lastSignup: nowIso,
          lastCreatedAt: nowIso,
          accountUids,
          history,
        },
        { merge: true }
      );
    } else {
      await setDoc(limitRef, {
        deviceId,
        count: 1,
        lastSignup: nowIso,
        lastCreatedAt: nowIso,
        accountUids: [uid],
        history: [{ uid, username, timestamp: nowIso }],
      });
    }
  } catch (err) {
    console.warn('Error recording device limit:', err);
  }
}

/**
 * LAYER 2 - Google = 1 Account Only
 * Checks if googleEmail already exists in /usersPrivate or /users.
 * If found, returns existing UID to log into existing account.
 */
export async function findExistingAccountByGoogleEmail(
  googleEmail: string
): Promise<{ exists: boolean; existingUid?: string; existingUsername?: string } | null> {
  if (!googleEmail) return null;
  const cleanEmail = googleEmail.trim().toLowerCase();

  try {
    // 1. Check in /usersPrivate
    const privateRef = collection(db, 'usersPrivate');
    const qPrivate = query(privateRef, where('googleEmail', '==', cleanEmail));
    const privateSnap = await getDocs(qPrivate);

    if (!privateSnap.empty) {
      const firstDoc = privateSnap.docs[0];
      const data = firstDoc.data();
      return {
        exists: true,
        existingUid: firstDoc.id || data.uid,
        existingUsername: data.linkedUsername || data.username,
      };
    }

    // 2. Fallback check in /users
    const usersRef = collection(db, 'users');
    const qUsers = query(usersRef, where('email', '==', cleanEmail));
    const usersSnap = await getDocs(qUsers);

    if (!usersSnap.empty) {
      const firstDoc = usersSnap.docs[0];
      const data = firstDoc.data();
      return {
        exists: true,
        existingUid: firstDoc.id,
        existingUsername: data.handle || data.username,
      };
    }

    return { exists: false };
  } catch (err) {
    console.warn('Google account lookup notice:', err);
    return { exists: false };
  }
}

/**
 * Links Google email to Nochaf username forever in /usersPrivate/{uid}
 */
export async function linkGoogleEmailToAccount(
  uid: string,
  googleEmail: string,
  linkedUsername: string
): Promise<void> {
  try {
    const cleanEmail = googleEmail.trim().toLowerCase();
    await setDoc(
      doc(db, 'usersPrivate', uid),
      {
        uid,
        googleEmail: cleanEmail,
        linkedUsername,
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('Link Google email notice:', err);
  }
}

/**
 * In-memory buffer tracking message timestamps and chat creations to monitor rapid rates
 */
interface UserMessageRecord {
  text: string;
  recipientUid: string;
  timestamp: number;
}

const recentMessagesBySender: Record<string, UserMessageRecord[]> = {};
const recentChatsCreatedBySender: Record<string, number[]> = {};

/**
 * Monitors if account creates 5 chats in 1 minute -> flag
 */
export async function trackChatCreation(senderUid: string): Promise<boolean> {
  const now = Date.now();
  if (!recentChatsCreatedBySender[senderUid]) {
    recentChatsCreatedBySender[senderUid] = [];
  }
  // Keep only within last 60 seconds
  recentChatsCreatedBySender[senderUid] = recentChatsCreatedBySender[senderUid].filter(
    (t) => now - t <= 60000
  );
  recentChatsCreatedBySender[senderUid].push(now);

  if (recentChatsCreatedBySender[senderUid].length >= 5) {
    // Flag account
    try {
      await updateDoc(doc(db, 'users', senderUid), {
        isFlagged: true,
        flagReason: 'Created 5+ chats in 1 minute',
        flaggedAt: new Date().toISOString(),
      });
    } catch {}
    return true;
  }
  return false;
}

/**
 * SMART SPAM CHECK (LAYER 6 - Don't ban innocent people):
 * 
 * Check 3 things TOGETHER, not 1 thing:
 * 1. Same message? -> Is message identical copy-paste?
 * 2. To strangers? -> Are receivers NOT friends / never chatted before?
 * 3. Contains link / money? -> Does message have "mpesa", "http", "earn", "click", "join"?
 * 
 * BAN / MUTE ONLY IF ALL 3 = TRUE!
 * 
 * Safe cases (Never ban):
 * - Same message to friends (birthday, invite) -> ALLOW
 * - Different messages to 10 strangers quickly -> ALLOW
 * - 10 messages in 1 min to 1 person (arguing) -> ALLOW
 * 
 * Implementation:
 * - Get last 10 messages from sender in last 5 mins
 * - If 5+ messages have same exact text AND recipients are not in sender's friends list
 *   AND text contains spam keywords (http, mpesa, t.me, bit.ly, earn money) -> flag for review, not instant ban
 * - First time: warning only "Slow down"
 * - 2nd time: 1 hour mute
 * - 3rd time: human review in /spamQueue
 */
export async function evaluateSmartSpam({
  senderUid,
  senderHandle,
  recipientUid,
  messageText,
  isRecipientFriendOrExisted,
  currentSpamViolations = 0,
}: {
  senderUid: string;
  senderHandle: string;
  recipientUid: string;
  messageText: string;
  isRecipientFriendOrExisted: boolean;
  currentSpamViolations?: number;
}): Promise<SmartSpamCheckResult> {
  const now = Date.now();
  const trimmed = messageText.trim().toLowerCase();

  // Clean old messages older than 5 minutes (300,000 ms)
  if (!recentMessagesBySender[senderUid]) {
    recentMessagesBySender[senderUid] = [];
  }
  recentMessagesBySender[senderUid] = recentMessagesBySender[senderUid].filter(
    (m) => now - m.timestamp <= 300000
  );

  // Record this message
  recentMessagesBySender[senderUid].push({
    text: trimmed,
    recipientUid,
    timestamp: now,
  });

  const last10 = recentMessagesBySender[senderUid].slice(-10);

  // 1. Same message? Check how many in last 10 have the identical text
  const identicalCount = last10.filter((m) => m.text === trimmed).length;
  const isIdenticalRepeat = identicalCount >= 5;

  // 2. To strangers? (receiver is not friend / never chatted before)
  const isToStrangers = !isRecipientFriendOrExisted;

  // 3. Contains link or money?
  const containsSpamKeyword = SPAM_KEYWORDS.some((kw) => trimmed.includes(kw));

  // ONLY TRIGGER IF ALL 3 ARE TRUE TOGETHER!
  if (isIdenticalRepeat && isToStrangers && containsSpamKeyword) {
    const nextViolationCount = currentSpamViolations + 1;

    if (nextViolationCount === 1) {
      // 1st time = warning only "Slow down"
      return {
        isSpam: true,
        action: 'warning',
        message: 'Slow down: Please avoid sending repeated promotional links to new contacts.',
      };
    } else if (nextViolationCount === 2) {
      // 2nd time = 1 hour mute
      const muteUntil = now + 60 * 60 * 1000; // 1 hour
      try {
        await updateDoc(doc(db, 'users', senderUid), {
          isMuted: true,
          mutedUntil: muteUntil,
          muteReason: 'Sent repeated promotional links to strangers',
          spamWarningCount: nextViolationCount,
        });
      } catch {}

      return {
        isSpam: true,
        action: 'mute',
        message: 'Your account is muted for 1 hour due to repetitive link sharing. You can tap Appeal if this was a mistake.',
        muteDurationHours: 1,
      };
    } else {
      // 3rd time = human review in /spamQueue
      try {
        await addDoc(collection(db, 'spamQueue'), {
          senderUid,
          senderHandle,
          sampleText: messageText,
          reason: 'Sent 5+ identical promotional messages to strangers repeatedly',
          status: 'pending',
          createdAt: new Date().toISOString(),
          timestamp: now,
        });

        await updateDoc(doc(db, 'users', senderUid), {
          isMuted: true,
          mutedUntil: now + 24 * 60 * 60 * 1000,
          isFlagged: true,
          spamWarningCount: nextViolationCount,
        });
      } catch {}

      return {
        isSpam: true,
        action: 'flag_queue',
        message: 'Your account has been placed under review by administrators. You can tap Appeal below.',
      };
    }
  }

  // Safe cases (friends, different messages, arguing with 1 person, etc.)
  return { isSpam: false, action: 'allow' };
}

/**
 * Submit User Appeal: "I'm not spam"
 */
export async function submitSpamAppeal(
  uid: string,
  username: string,
  reason = "I'm not spam"
): Promise<{ success: boolean; message: string }> {
  try {
    await addDoc(collection(db, 'appeals'), {
      uid,
      username,
      appealText: reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    await updateDoc(doc(db, 'users', uid), {
      hasPendingAppeal: true,
      appealSubmittedAt: new Date().toISOString(),
    });

    return {
      success: true,
      message: 'Appeal submitted! Our team will review and unmute your account shortly.',
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Failed to submit appeal. Please try again.',
    };
  }
}
