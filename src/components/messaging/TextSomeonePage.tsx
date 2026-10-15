/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import {
  auth,
  db,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  query,
  orderBy,
  onSnapshot,
  getDoc,
  getDocs,
  where,
  arrayUnion,
  arrayRemove,
  deleteDoc,
  increment,
  serverTimestamp,
  writeBatch,
} from '../../lib/firebase';
import {
  MessageSquare,
  Plus,
  ArrowLeft,
  ArrowRight,
  Send,
  Trash2,
  Camera,
  User as UserIcon,
  UserPlus,
  Check,
  CheckCheck,
  WifiOff,
  AlertCircle,
  X,
  ChevronRight,
  ChevronUp,
  Reply,
  Copy,
  Lock,
  Edit2,
  ZoomIn,
  Square,
  Mic,
  Play,
  Pause,
  Download,
  StopCircle,
  Disc,
  Search,
  LogOut,
  ShieldAlert,
  Flag,
  Heart,
  MoreVertical,
  Share2,
  VolumeX,
  Volume2,
  Crop,
  Scissors,
  RotateCw,
  Ban,
} from 'lucide-react';
import { normalizeUsername } from '../../utils/username';
import { evaluateSmartSpam, submitSpamAppeal, trackChatCreation } from '../../utils/antiSpam';
import {
  subscribeToPresenceWithDebounce,
  subscribeToTyping,
  setTypingPresence,
  subscribeToUserStatus,
  formatLastSeen,
  UserStatusInfo,
} from '../../services/presence';

interface DirectMessageReply {
  id: string;
  senderName: string;
  senderHandle: string;
  content: string;
}

interface DirectMessageItem {
  id: string;
  senderId: string;
  receiverId?: string;
  chatId?: string;
  text?: string;
  status?: 'sent' | 'delivered' | 'read' | 'offline';
  isOfflinePending?: boolean;
  senderHandle: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  createdAt: string;
  timestamp?: any;
  deletedFor?: string[];
  readBy?: string[];
  replyTo?: DirectMessageReply;
  reactions?: Record<string, string>;
  mediaUrl?: string;
  mediaUrls?: string[];
  mediaType?: 'image' | 'video' | 'audio';
  mediaName?: string;
  isVoiceNote?: boolean;
  duration?: number;
  durationText?: string;
  isMuted?: boolean;
}

interface QueuedOfflineMessage {
  tempId: string;
  threadId: string;
  senderUid: string;
  senderHandle: string;
  senderName: string;
  senderAvatar: string;
  receiverUid: string;
  receiverHandle: string;
  receiverName: string;
  receiverAvatar: string;
  text: string;
  createdAt: string;
  formattedTime: string;
  replyTo?: any;
}

const OFFLINE_QUEUE_KEY = 'nochaf_offline_msgs_queue';
const CHAT_CACHE_KEY_PREFIX = 'nochaf_chat_cache_';

function getOfflineQueue(): QueuedOfflineMessage[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveToOfflineQueue(msg: QueuedOfflineMessage) {
  try {
    const current = getOfflineQueue();
    if (!current.some((m) => m.tempId === msg.tempId)) {
      current.push(msg);
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(current));
    }
  } catch {}
}

function removeFromOfflineQueue(tempId: string) {
  try {
    const current = getOfflineQueue().filter((m) => m.tempId !== tempId);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(current));
  } catch {}
}

function getStoredChatCache(threadId: string): DirectMessageItem[] | null {
  try {
    const raw = sessionStorage.getItem(CHAT_CACHE_KEY_PREFIX + threadId);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return null;
}

function setStoredChatCache(threadId: string, msgs: DirectMessageItem[]) {
  try {
    const toSave = msgs.slice(-100);
    sessionStorage.setItem(CHAT_CACHE_KEY_PREFIX + threadId, JSON.stringify(toSave));
  } catch {}
}

interface ChatContact {
  threadId: string;
  otherUid: string;
  otherHandle: string;
  otherName: string;
  otherAvatar?: string;
  lastMessage?: string;
  updatedAt?: string;
  unreadCount?: number;
}

interface TextSomeonePageProps {
  onBackToAI: () => void;
  onOpenAuth: (mode?: 'create_account' | 'login') => void;
  onOnlineNotification?: (name: string) => void;
  onActiveChatChange?: (hasActiveChat: boolean) => void;
  backTrigger?: number;
}

export const TextSomeonePage: React.FC<TextSomeonePageProps> = ({
  onBackToAI,
  onOpenAuth,
  onOnlineNotification,
  onActiveChatChange,
  backTrigger,
}) => {
  const { user, profile, updateUserProfile, signOut } = useAuth();

  // Spam warning & Appeal states
  const [spamNotice, setSpamNotice] = useState<string | null>(null);
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [appealSuccessMsg, setAppealSuccessMsg] = useState<string | null>(null);
  const [reportingUser, setReportingUser] = useState(false);
  const [reportSuccessMsg, setReportSuccessMsg] = useState<string | null>(null);

  // State: contacts / conversations list
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [showGuestAddModal, setShowGuestAddModal] = useState(false);

  // Active chat target (null = viewing conversations list; object = personal chat page)
  const [activeChat, setActiveChat] = useState<ChatContact | null>(null);

  useEffect(() => {
    onActiveChatChange?.(!!activeChat);
  }, [activeChat, onActiveChatChange]);

  // Messages in active chat
  const [messages, setMessages] = useState<DirectMessageItem[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Replying to a specific message
  const [replyingTo, setReplyingTo] = useState<DirectMessageItem | null>(null);

  // Message selection state (Hold 1/2s to select, then tap others)
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const isSelectionMode = selectedMessageIds.length > 0;

  // Single held message options popover & delete choices
  const [activeOptionsMsg, setActiveOptionsMsg] = useState<DirectMessageItem | null>(null);
  const [msgOptionsCoords, setMsgOptionsCoords] = useState<{
    top: number;
    left?: number;
    right?: number;
    isMe: boolean;
  } | null>(null);
  const [showMsgDeletePrompt, setShowMsgDeletePrompt] = useState(false);
  const [deleteModalMsg, setDeleteModalMsg] = useState<DirectMessageItem | null>(null);
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);

  // Outside threads selection state (hold 1/2s to select, tap others to batch delete)
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const isThreadSelectionMode = selectedThreadIds.length > 0;

  // Attachment menu (camera, mic)
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const chatMediaInputRef = useRef<HTMLInputElement>(null);

  // Voice note recording state machine: 'idle' | 'recording' | 'recorded'
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voiceRecordStage, setVoiceRecordStage] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [recordedVoiceUrl, setRecordedVoiceUrl] = useState<string | null>(null);
  const [recordedDurationSec, setRecordedDurationSec] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isPreviewVoicePlaying, setIsPreviewVoicePlaying] = useState(false);
  const [previewVoiceProgress, setPreviewVoiceProgress] = useState<{ current: number; duration: number }>({ current: 0, duration: 0 });
  const previewVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isSendingVoiceNote, setIsSendingVoiceNote] = useState(false);
  const isSendingVoiceRef = useRef(false);
  const sentVoiceNoteUrlsRef = useRef<Set<string>>(new Set());

  // Audio playback progress for animation
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<string, { current: number; duration: number }>>({});
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Speed regulation for voice note playback ("listen it before or after, regulate it's speed")
  const [audioPlaybackSpeed, setAudioPlaybackSpeed] = useState<number>(1);
  const [previewPlaybackSpeed, setPreviewPlaybackSpeed] = useState<number>(1);
  const previewProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatAudioProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Permanence of blue ticks (opened) & active chat viewer tracking
  const blueTickedMsgIdsRef = useRef<Set<string>>(new Set());
  const [threadActiveViewers, setThreadActiveViewers] = useState<string[]>([]);

  // Cycle playback speed: 1x -> 1.5x -> 2x -> 1x
  const cycleAudioPlaybackSpeed = () => {
    setAudioPlaybackSpeed((prev) => {
      const next = prev === 1 ? 1.5 : prev === 1.5 ? 2 : 1;
      if (currentAudioRef.current) {
        currentAudioRef.current.playbackRate = next;
      }
      return next;
    });
  };

  const cyclePreviewSpeed = () => {
    setPreviewPlaybackSpeed((prev) => {
      const next = prev === 1 ? 1.5 : prev === 1.5 ? 2 : 1;
      if (previewVoiceAudioRef.current) {
        previewVoiceAudioRef.current.playbackRate = next;
      }
      return next;
    });
  };

  // Copied text notification showing the text during copy process
  const [copiedTextNotice, setCopiedTextNotice] = useState<string | null>(null);

  // Account independence: reset active chat and buffer when user account changes
  useEffect(() => {
    setActiveChat(null);
    setMessages([]);
    setSelectedMessageIds([]);
    setReplyingTo(null);
    setShowVoiceRecorder(false);
    setVoiceRecordStage('idle');
  }, [user?.uid]);

  // Full-screen image/media viewer (nothing else on borders)
  const [fullscreenMediaUrl, setFullscreenMediaUrl] = useState<string | null>(null);
  const [fullscreenMediaType, setFullscreenMediaType] = useState<'image' | 'video'>('image');

  // Media Sending Preview Modal State (Allows sending multiple pictures and videos, freehand crop for photos, trim & mute for videos)
  const [mediaSendPreview, setMediaSendPreview] = useState<{
    type: 'image' | 'video' | 'mixed';
    items: {
      type: 'image' | 'video';
      dataUrl: string;
      originalDataUrl: string;
      name: string;
      isMuted?: boolean;
      trimStartSec?: number;
      trimEndSec?: number;
      videoDurationSec?: number;
    }[];
    activeIndex: number;
    caption: string;
    isCropping: boolean;
    cropAspect: 'free' | '1:1' | '4:3' | '16:9';
    isMuted: boolean;
    trimStartSec: number;
    trimEndSec: number;
    videoDurationSec: number;
  } | null>(null);

  // Freehand crop tool state (dragging free with hand, not fixed like 1:1)
  const [freeCropRect, setFreeCropRect] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0.05,
    y: 0.05,
    width: 0.9,
    height: 0.9,
  });
  const freeCropActiveHandleRef = useRef<string | null>(null);
  const freeCropStartRef = useRef<{ clientX: number; clientY: number; rect: { x: number; y: number; width: number; height: number } }>({
    clientX: 0,
    clientY: 0,
    rect: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
  });
  const previewImageContainerRef = useRef<HTMLDivElement>(null);

  // Device / browser back key navigation effect
  useEffect(() => {
    if (backTrigger && backTrigger > 0) {
      if (mediaSendPreview) {
        setMediaSendPreview(null);
      } else if (fullscreenMediaUrl) {
        setFullscreenMediaUrl(null);
      } else if (activeChat) {
        setActiveChat(null);
      } else {
        onBackToAI();
      }
    }
  }, [backTrigger]);

  // Save received or sent photo / video directly to user device gallery
  const saveMediaToGallery = async (url: string, defaultName: string = 'media') => {
    if (!url) return;
    try {
      const isVideo = url.startsWith('data:video') || url.includes('.mp4') || url.includes('video');
      const ext = isVideo ? 'mp4' : 'jpg';
      const filename = `${defaultName}_${Date.now()}.${ext}`;

      if (url.startsWith('data:')) {
        const arr = url.split(',');
        const mime = arr[0].match(/:(.*?);/)?.[1] || (isVideo ? 'video/mp4' : 'image/jpeg');
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      triggerToast(isVideo ? 'Video saved directly to gallery!' : 'Photo saved directly to gallery!');
    } catch (err) {
      console.warn('Save to gallery error:', err);
      triggerToast('Saved to downloads!');
    }
  };

  // Online & Last Seen status (Realtime Database WhatsApp style)
  const [activeChatUserOnline, setActiveChatUserOnline] = useState<boolean>(false);
  const [activeChatUserStatus, setActiveChatUserStatus] = useState<UserStatusInfo>({ online: false });
  const [onlineContactsMap, setOnlineContactsMap] = useState<Record<string, boolean>>({});
  const [userStatusMap, setUserStatusMap] = useState<Record<string, UserStatusInfo>>({});
  const prevOnlineRef = useRef<Record<string, boolean>>({});
  const [threadReadBy, setThreadReadBy] = useState<string[]>([]);
  const lastTapTimeRef = useRef<{ id: string; time: number } | null>(null);

  // Swipe / drag to reply state
  const [dragMsgId, setDragMsgId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<number>(0);
  const touchDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const mouseDragStartRef = useRef<{ x: number; id: string } | null>(null);

  // Timers for long-press 500ms (1/2 a second)
  const msgLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMsgLongPressRef = useRef(false);
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const threadLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isThreadLongPressRef = useRef(false);

  // Toast notifications
  const [copyToast, setCopyToast] = useState(false);
  const [avatarSuccessToast, setAvatarSuccessToast] = useState(false);

  // Profile picture modal states
  const [isMyProfileModalOpen, setIsMyProfileModalOpen] = useState(false);
  const [viewingUserProfile, setViewingUserProfile] = useState<{
    name: string;
    handle: string;
    avatar?: string;
    uid?: string;
  } | null>(null);

  // Name editing in own profile
  const [nameEditValue, setNameEditValue] = useState(profile?.displayName || '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameSaveSuccess, setNameSaveSuccess] = useState(false);

  // 1x1 Image Fitting & Cropping tool state
  const [rawImageFor1x1, setRawImageFor1x1] = useState<string | null>(null);
  const [is1x1ModalOpen, setIs1x1ModalOpen] = useState(false);
  const [zoom1x1, setZoom1x1] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const isDraggingCropRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const touchPinchDistRef = useRef<number | null>(null);
  const initialZoomRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // "Add someone to chat" modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addUsernameInput, setAddUsernameInput] = useState('');
  const [addSearching, setAddSearching] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Search someone to text state (first letter automatically lowercase)
  const [searchContactQuery, setSearchContactQuery] = useState('');

  // Online / offline network connectivity state
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // In-memory messages cache per thread to display conversations immediately without empty chat
  const messagesCacheRef = useRef<Record<string, DirectMessageItem[]>>({});

  // Global search for Nochaf AI users
  const [globalSearchResults, setGlobalSearchResults] = useState<ChatContact[]>([]);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);
  const [globalSearchDone, setGlobalSearchDone] = useState(false);

  // Delete confirmation modal state
  const [threadToDelete, setThreadToDelete] = useState<ChatContact | null>(null);

  // Reaction popover emojis state (show 3 first, rest 4 on plus tap)
  const [showAllEmojis, setShowAllEmojis] = useState(false);
  // Realtime typing indicator
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const lastReactionTapRef = useRef<Record<string, number>>({});
  const typingTimerRef = useRef<any>(null);

  const formatPersonName = (name?: string, handle?: string) => {
    const cleanName = (name || '').trim();
    const strippedName = cleanName.replace(/^@+/, '').trim();
    if (
      strippedName &&
      strippedName.toLowerCase() !== 'user' &&
      !strippedName.toLowerCase().startsWith('user_') &&
      strippedName.toLowerCase() !== 'someone'
    ) {
      return strippedName;
    }
    const cleanHandle = handle ? handle.replace(/^@+/, '').trim() : '';
    if (cleanHandle && cleanHandle.toLowerCase() !== 'user') {
      return cleanHandle;
    }
    return 'Member';
  };

  // Strictly auto-clear all notices after 3 seconds
  useEffect(() => {
    if (copiedTextNotice) {
      const t = setTimeout(() => setCopiedTextNotice(null), 3000);
      return () => clearTimeout(t);
    }
  }, [copiedTextNotice]);

  useEffect(() => {
    if (avatarSuccessToast) {
      const t = setTimeout(() => setAvatarSuccessToast(false), 3000);
      return () => clearTimeout(t);
    }
  }, [avatarSuccessToast]);

  useEffect(() => {
    if (spamNotice) {
      const t = setTimeout(() => setSpamNotice(null), 3000);
      return () => clearTimeout(t);
    }
  }, [spamNotice]);

  useEffect(() => {
    if (appealSuccessMsg) {
      const t = setTimeout(() => setAppealSuccessMsg(null), 3000);
      return () => clearTimeout(t);
    }
  }, [appealSuccessMsg]);

  useEffect(() => {
    if (reportSuccessMsg) {
      const t = setTimeout(() => setReportSuccessMsg(null), 3000);
      return () => clearTimeout(t);
    }
  }, [reportSuccessMsg]);

  const myHandle = profile?.handle
    ? profile.handle.replace(/^@+/, '')
    : (user?.email ? user.email.split('@')[0] : '');
  const myName = (profile?.displayName && profile.displayName.toLowerCase() !== 'user' && profile.displayName.trim() !== '')
    ? profile.displayName
    : (myHandle ? `@${myHandle}` : '');
  const myAvatar = profile?.avatar || '';

  // Synchronize nameEditValue when profile updates
  useEffect(() => {
    if (profile?.displayName) {
      setNameEditValue(profile.displayName);
    }
  }, [profile?.displayName]);

  // Flush queued messages when internet connection is restored
  const flushOfflineQueue = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    for (const item of queue) {
      try {
        const messagesRef = collection(db, 'directMessages', item.threadId, 'messages');
        await addDoc(messagesRef, {
          text: item.text,
          senderId: item.senderUid,
          receiverId: item.receiverUid,
          chatId: item.threadId,
          timestamp: serverTimestamp(),
          status: 'sent',
          senderHandle: item.senderHandle,
          senderName: item.senderName,
          senderAvatar: item.senderAvatar,
          content: item.text,
          createdAt: item.createdAt,
          deletedFor: [],
          readBy: [item.senderUid],
          ...(item.replyTo ? { replyTo: item.replyTo } : {}),
        });

        // Update parent thread document with snippet
        await setDoc(
          doc(db, 'directMessages', item.threadId),
          {
            id: item.threadId,
            participants: [item.senderUid, item.receiverUid],
            participantHandles: [item.senderHandle, item.receiverHandle],
            participantNames: [item.senderName, item.receiverName],
            lastMessage: item.text,
            lastMessageTimestamp: item.createdAt,
            lastSenderId: item.senderUid,
            lastSenderName: item.senderName,
            readBy: [item.senderUid],
            unreadCounts: {
              [item.senderUid]: 0,
              [item.receiverUid]: increment(1),
            },
            updatedAt: item.createdAt,
            deletedFor: [],
            participantAvatars: {
              ...(item.receiverAvatar ? { [item.receiverUid]: item.receiverAvatar } : {}),
              [item.senderUid]: item.senderAvatar,
            },
          },
          { merge: true }
        );

        removeFromOfflineQueue(item.tempId);

        // Update local message in active conversation: offline icon turns into tick!
        setMessages((prev) =>
          prev.map((m) =>
            m.id === item.tempId
              ? { ...m, isOfflinePending: false, status: 'sent' }
              : m
          )
        );
      } catch (err) {
        console.warn('Retry sending queued offline message failed:', err);
      }
    }
  };

  // Online / offline network event listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      flushOfflineQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      flushOfflineQueue();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // =============================================================
  // FAVOURITE, BLOCKED & MUTED ACCOUNTS STATE & PERSISTENCE
  // =============================================================
  const [favouriteUserIds, setFavouriteUserIds] = useState<string[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<{
    uid: string;
    handle: string;
    name: string;
    avatar?: string;
    blockedAt: string;
  }[]>([]);
  const [mutedUsers, setMutedUsers] = useState<{
    uid: string;
    handle: string;
    name: string;
    avatar?: string;
    until: number;
    durationLabel: string;
    mutedAt: string;
  }[]>([]);

  // Menu Dropdowns
  const [showConvMenu, setShowConvMenu] = useState(false);
  const convMenuRef = useRef<HTMLDivElement>(null);
  const [showChatsTopMenu, setShowChatsTopMenu] = useState(false);
  const chatsTopMenuRef = useRef<HTMLDivElement>(null);
  const chatsTopMenuBtnRef = useRef<HTMLButtonElement>(null);

  // Modals for Top Right 3 dots
  const [showShareAccountModal, setShowShareAccountModal] = useState(false);
  const [showMuteModal, setShowMuteModal] = useState(false);
  const [showBlockedAccountsModal, setShowBlockedAccountsModal] = useState(false);
  const [showMutedAccountsModal, setShowMutedAccountsModal] = useState(false);
  const [showInviteFriendsModal, setShowInviteFriendsModal] = useState(false);

  // Share account state
  const [shareDirectNote, setShareDirectNote] = useState('');
  const [shareDirectToThreadId, setShareDirectToThreadId] = useState<string>('');
  const [shareDirectDirectMsgInput, setShareDirectDirectMsgInput] = useState('');
  const [shareSuccessNotice, setShareSuccessNotice] = useState<string | null>(null);

  // General Toast banner
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Sync Favourite, Blocked & Muted accounts for authenticated user
  useEffect(() => {
    if (!user?.uid || user.uid.startsWith('guest_')) {
      setFavouriteUserIds([]);
      setBlockedUsers([]);
      setMutedUsers([]);
      return;
    }

    try {
      const savedFavs = localStorage.getItem(`nochaf_favs_${user.uid}`);
      if (savedFavs) setFavouriteUserIds(JSON.parse(savedFavs));
      const savedBlocked = localStorage.getItem(`nochaf_blocked_${user.uid}`);
      if (savedBlocked) setBlockedUsers(JSON.parse(savedBlocked));
      const savedMuted = localStorage.getItem(`nochaf_muted_${user.uid}`);
      if (savedMuted) setMutedUsers(JSON.parse(savedMuted));
    } catch {}

    const userDocRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      userDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.favouriteUserIds)) {
            setFavouriteUserIds(data.favouriteUserIds);
            try {
              localStorage.setItem(`nochaf_favs_${user.uid}`, JSON.stringify(data.favouriteUserIds));
            } catch {}
          }
          if (Array.isArray(data.blockedUsers)) {
            setBlockedUsers(data.blockedUsers);
            try {
              localStorage.setItem(`nochaf_blocked_${user.uid}`, JSON.stringify(data.blockedUsers));
            } catch {}
          }
          if (Array.isArray(data.mutedUsers)) {
            setMutedUsers(data.mutedUsers);
            try {
              localStorage.setItem(`nochaf_muted_${user.uid}`, JSON.stringify(data.mutedUsers));
            } catch {}
          }
        }
      },
      (err) => {
        console.warn('User preferences sync notice:', err.message);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  // Outside click listener for menus
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (showConvMenu && convMenuRef.current && !convMenuRef.current.contains(e.target as Node)) {
        setShowConvMenu(false);
      }
      if (
        showChatsTopMenu &&
        chatsTopMenuRef.current &&
        !chatsTopMenuRef.current.contains(e.target as Node) &&
        !chatsTopMenuBtnRef.current?.contains(e.target as Node)
      ) {
        setShowChatsTopMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [showConvMenu, showChatsTopMenu]);

  // Block account handler
  const handleBlockAccount = async (target: ChatContact) => {
    if (!user || user.uid.startsWith('guest_')) {
      setShowGuestAddModal(true);
      return;
    }
    const isAlreadyBlocked = blockedUsers.some((b) => b.uid === target.otherUid);
    let updated: typeof blockedUsers = [];
    if (isAlreadyBlocked) {
      updated = blockedUsers.filter((b) => b.uid !== target.otherUid);
      triggerToast(`@${target.otherHandle} unblocked`);
    } else {
      updated = [
        ...blockedUsers.filter((b) => b.uid !== target.otherUid),
        {
          uid: target.otherUid,
          handle: target.otherHandle,
          name: target.otherName,
          avatar: target.otherAvatar,
          blockedAt: new Date().toISOString(),
        },
      ];
      triggerToast(`@${target.otherHandle} blocked`);
    }
    setBlockedUsers(updated);
    try {
      localStorage.setItem(`nochaf_blocked_${user.uid}`, JSON.stringify(updated));
      await updateDoc(doc(db, 'users', user.uid), { blockedUsers: updated });
    } catch (err) {
      console.warn('Block save notice:', err);
    }
  };

  const handleUnblockAccount = async (targetUid: string) => {
    if (!user) return;
    const target = blockedUsers.find((b) => b.uid === targetUid);
    const updated = blockedUsers.filter((b) => b.uid !== targetUid);
    setBlockedUsers(updated);
    if (target) {
      triggerToast(`@${target.handle} unblocked`);
    }
    try {
      localStorage.setItem(`nochaf_blocked_${user.uid}`, JSON.stringify(updated));
      await updateDoc(doc(db, 'users', user.uid), { blockedUsers: updated });
    } catch (err) {
      console.warn('Unblock save notice:', err);
    }
  };

  // Favourite account handler
  const handleToggleFavourite = async (targetUid: string, targetHandle: string) => {
    if (!user || user.uid.startsWith('guest_')) {
      setShowGuestAddModal(true);
      return;
    }
    const isFav = favouriteUserIds.includes(targetUid);
    const updated = isFav
      ? favouriteUserIds.filter((id) => id !== targetUid)
      : [...favouriteUserIds, targetUid];

    setFavouriteUserIds(updated);
    triggerToast(isFav ? `@${targetHandle} removed from favourites` : `@${targetHandle} added to favourites`);
    try {
      localStorage.setItem(`nochaf_favs_${user.uid}`, JSON.stringify(updated));
      await updateDoc(doc(db, 'users', user.uid), { favouriteUserIds: updated });
    } catch (err) {
      console.warn('Favourite save notice:', err);
    }
  };

  // Mute account handler
  const handleMuteAccount = async (
    target: ChatContact,
    durationMs: number,
    durationLabel: string
  ) => {
    if (!user || user.uid.startsWith('guest_')) {
      setShowGuestAddModal(true);
      return;
    }
    const until = Date.now() + durationMs;
    const updated = [
      ...mutedUsers.filter((m) => m.uid !== target.otherUid),
      {
        uid: target.otherUid,
        handle: target.otherHandle,
        name: target.otherName,
        avatar: target.otherAvatar,
        until,
        durationLabel,
        mutedAt: new Date().toISOString(),
      },
    ];
    setMutedUsers(updated);
    setShowMuteModal(false);
    setActiveChat(null); // Account is now hidden, return to chats list
    triggerToast(`@${target.otherHandle} muted for ${durationLabel}. Account is hidden.`);
    try {
      localStorage.setItem(`nochaf_muted_${user.uid}`, JSON.stringify(updated));
      await updateDoc(doc(db, 'users', user.uid), { mutedUsers: updated });
    } catch (err) {
      console.warn('Mute save notice:', err);
    }
  };

  const handleUnmuteAccount = async (targetUid: string) => {
    if (!user) return;
    const target = mutedUsers.find((m) => m.uid === targetUid);
    const updated = mutedUsers.filter((m) => m.uid !== targetUid);
    setMutedUsers(updated);
    if (target) {
      triggerToast(`@${target.handle} unmuted`);
    }
    try {
      localStorage.setItem(`nochaf_muted_${user.uid}`, JSON.stringify(updated));
      await updateDoc(doc(db, 'users', user.uid), { mutedUsers: updated });
    } catch (err) {
      console.warn('Unmute save notice:', err);
    }
  };

  const formatRemainingMute = (until: number) => {
    const diff = until - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.ceil(diff / (1000 * 60 * 60));
    if (hours < 24) return `${hours}h left`;
    const days = Math.ceil(hours / 24);
    return `${days}d left`;
  };

  // Share account to another conversation
  const handleShareAccountToConversation = async (
    targetThreadId: string,
    handleToShare: string,
    note?: string
  ) => {
    if (!user || user.uid.startsWith('guest_')) {
      setShowGuestAddModal(true);
      return;
    }
    const cleanHandle = handleToShare.replace(/^@+/, '');
    const shareContent = note?.trim()
      ? `${note.trim()}\n\nContact: @${cleanHandle}`
      : `Check out @${cleanHandle} on Nochaf AI!`;

    try {
      const msgsRef = collection(db, 'directMessages', targetThreadId, 'messages');
      await addDoc(msgsRef, {
        threadId: targetThreadId,
        senderId: user.uid,
        senderHandle: myHandle,
        senderName: myName,
        senderAvatar: myAvatar,
        content: shareContent,
        createdAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        readBy: [user.uid],
      });
      await updateDoc(doc(db, 'directMessages', targetThreadId), {
        lastMessage: shareContent,
        lastSenderId: user.uid,
        updatedAt: new Date().toISOString(),
        readBy: [user.uid],
        [`unreadCounts.${user.uid}`]: 0,
      });
      setShareSuccessNotice(`Shared @${cleanHandle} successfully!`);
      setTimeout(() => {
        setShareSuccessNotice(null);
        setShowShareAccountModal(false);
        setShareDirectNote('');
      }, 1500);
    } catch (err) {
      console.warn('Share to chat notice:', err);
    }
  };

  // -------------------------------------------------------------
  // 1. Load active direct message threads for current user
  // -------------------------------------------------------------
  useEffect(() => {
    if (!user?.uid) {
      setContacts([]);
      setActiveChat(null);
      setMessages([]);
      setSelectedMessageIds([]);
      setSelectedThreadIds([]);
      setLoadingContacts(false);
      return;
    }

    setLoadingContacts(true);
    const q = query(
      collection(db, 'directMessages'),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      async (snap) => {
        const userContacts: ChatContact[] = [];

        for (const docSnap of snap.docs) {
          const data = docSnap.data();
          const participants: string[] = data.participants || [];
          const deletedFor: string[] = data.deletedFor || [];

          // Only show threads where user is a participant, has not deleted it, and an actual text message exists
          const hasTextedContent = Boolean(
            (data.lastMessage && data.lastMessage.trim() !== '') ||
            data.lastSenderId ||
            data.hasMessages
          );
          if (participants.includes(user.uid) && !deletedFor.includes(user.uid) && hasTextedContent) {
            const otherUid = participants.find((id) => id !== user.uid) || user.uid;
            const otherIdx = participants.indexOf(otherUid);

            const otherHandleRaw =
              (data.participantHandles && data.participantHandles[otherIdx]) || '';
            const otherHandle = otherHandleRaw.replace(/^@+/, '') || 'someone';
            const otherNameRaw =
              (data.participantNames && data.participantNames[otherIdx]) || '';
            const otherName = formatPersonName(otherNameRaw, otherHandle);

            let otherAvatar =
              data.participantAvatars && data.participantAvatars[otherUid];

            // If avatar is not cached on thread, fetch latest profile avatar
            if (!otherAvatar && otherUid) {
              try {
                const uSnap = await getDoc(doc(db, 'users', otherUid));
                if (uSnap.exists()) {
                  otherAvatar = uSnap.data().avatar;
                }
              } catch {}
            }

            const readBy: string[] = data.readBy || [];
            const lastSenderId: string = data.lastSenderId || '';
            const unreadCountsMap: Record<string, number> = data.unreadCounts || {};

            let threadUnreadCount = 0;
            if (typeof unreadCountsMap[user.uid] === 'number') {
              threadUnreadCount = unreadCountsMap[user.uid];
            } else if (lastSenderId && lastSenderId !== user.uid && !readBy.includes(user.uid)) {
              threadUnreadCount = 1;
            }

            userContacts.push({
              threadId: docSnap.id,
              otherUid,
              otherHandle: otherHandle.replace(/^@+/, ''),
              otherName,
              otherAvatar,
              lastMessage: data.lastMessage || '',
              updatedAt: data.updatedAt || data.createdAt || '',
              unreadCount: threadUnreadCount,
            });
          }
        }

        setContacts(userContacts);
        setLoadingContacts(false);
      },
      (err) => {
        console.warn('Direct messages sync:', err);
        setLoadingContacts(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // -------------------------------------------------------------
  // 2. Real-time messages for active chat conversation
  // -------------------------------------------------------------
  useEffect(() => {
    if (!activeChat || !user?.uid) {
      setMessages([]);
      setSelectedMessageIds([]);
      setReplyingTo(null);
      return;
    }

    // Immediately display cached messages so an already started conversation has no loading and no empty chat
    const cached = messagesCacheRef.current[activeChat.threadId] || getStoredChatCache(activeChat.threadId);
    if (cached && cached.length > 0) {
      setMessages(cached);
    }

    const messagesRef = collection(
      db,
      'directMessages',
      activeChat.threadId,
      'messages'
    );
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: DirectMessageItem[] = [];
        const toMarkDelivered: string[] = [];
        const toMarkRead: string[] = [];

        snap.forEach((d) => {
          const item = { id: d.id, ...(d.data() as any) };
          // If message is shadow-banned, only the sender sees it
          if (item.isShadowBanned && item.senderId !== user?.uid) {
            return;
          }
          list.push(item);

          // Real-time WhatsApp tick detection for receiver
          const isReceiver = item.receiverId === user.uid || (item.senderId !== user.uid);
          if (isReceiver) {
            // 3. TWO GREY TICKS (DELIVERED):
            // When onSnapshot receives a new message where receiverId == myId and status == "sent",
            // immediately update that message doc: updateDoc(doc, {status: "delivered"})
            if (item.status === 'sent') {
              toMarkDelivered.push(d.id);
            }
            // 4. TWO GREEN TICKS (READ):
            // When receiver OPENS the chat and messages are visible on screen:
            // For all messages where receiverId == myId and status != "read", update to status: "read"
            if (item.status !== 'read') {
              toMarkRead.push(d.id);
            }
          }
        });

        setMessages(list);
        messagesCacheRef.current[activeChat.threadId] = list;
        setStoredChatCache(activeChat.threadId, list);

        // Immediate delivery update for incoming "sent" messages
        if (toMarkDelivered.length > 0) {
          try {
            const delivBatch = writeBatch(db);
            toMarkDelivered.forEach((msgId) => {
              const mRef = doc(db, 'directMessages', activeChat.threadId, 'messages', msgId);
              delivBatch.update(mRef, { status: 'delivered' });
            });
            delivBatch.commit().catch(() => {
              toMarkDelivered.forEach((msgId) => {
                updateDoc(doc(db, 'directMessages', activeChat.threadId, 'messages', msgId), {
                  status: 'delivered',
                }).catch(() => {});
              });
            });
          } catch {
            toMarkDelivered.forEach((msgId) => {
              updateDoc(doc(db, 'directMessages', activeChat.threadId, 'messages', msgId), {
                status: 'delivered',
              }).catch(() => {});
            });
          }
        }

        // When receiver has the chat open and messages are visible on screen:
        // Update all unread messages to status: "read" in batch
        if (toMarkRead.length > 0) {
          try {
            const readBatch = writeBatch(db);
            toMarkRead.forEach((msgId) => {
              const mRef = doc(db, 'directMessages', activeChat.threadId, 'messages', msgId);
              readBatch.update(mRef, {
                status: 'read',
                readBy: arrayUnion(user.uid),
              });
            });
            readBatch.commit().catch(() => {
              toMarkRead.forEach((msgId) => {
                updateDoc(doc(db, 'directMessages', activeChat.threadId, 'messages', msgId), {
                  status: 'read',
                  readBy: arrayUnion(user.uid),
                }).catch(() => {});
              });
            });
          } catch {
            toMarkRead.forEach((msgId) => {
              updateDoc(doc(db, 'directMessages', activeChat.threadId, 'messages', msgId), {
                status: 'read',
                readBy: arrayUnion(user.uid),
              }).catch(() => {});
            });
          }

          updateDoc(doc(db, 'directMessages', activeChat.threadId), {
            readBy: arrayUnion(user.uid),
            [`unreadCounts.${user.uid}`]: 0,
          }).catch(() => {});
        }
      },
      (err) => {
        console.warn('Messages listener notice:', err);
      }
    );

    return () => unsubscribe();
  }, [activeChat?.threadId, activeChat?.otherUid, user?.uid]);

  // Subscribe to thread document to track active viewers & readBy status
  useEffect(() => {
    if (!activeChat?.threadId || !user?.uid) {
      setThreadReadBy([]);
      setThreadActiveViewers([]);
      return;
    }
    const threadRef = doc(db, 'directMessages', activeChat.threadId);
    // Mark as active viewer and read by current user upon viewing
    updateDoc(threadRef, {
      readBy: arrayUnion(user.uid),
      activeViewers: arrayUnion(user.uid),
      [`unreadCounts.${user.uid}`]: 0,
    }).catch(() => {});

    const unsub = onSnapshot(
      threadRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setThreadReadBy(data.readBy || []);
          setThreadActiveViewers(data.activeViewers || []);
        }
      },
      (err) => {
        console.warn('Thread sync notice:', err.message);
      }
    );

    const removeActiveViewer = () => {
      updateDoc(threadRef, {
        activeViewers: arrayRemove(user.uid),
      }).catch(() => {});
    };

    window.addEventListener('beforeunload', removeActiveViewer);
    window.addEventListener('pagehide', removeActiveViewer);

    return () => {
      removeActiveViewer();
      window.removeEventListener('beforeunload', removeActiveViewer);
      window.removeEventListener('pagehide', removeActiveViewer);
      unsub();
    };
  }, [activeChat?.threadId, user?.uid]);

  // WhatsApp-style presence & typing subscription in active chat
  useEffect(() => {
    if (!activeChat?.otherUid || !activeChat?.threadId) {
      setActiveChatUserOnline(false);
      setActiveChatUserStatus({ online: false });
      setIsOtherTyping(false);
      return;
    }
    const unsubPresence = subscribeToUserStatus(activeChat.otherUid, (status) => {
      setActiveChatUserOnline(status.online);
      setActiveChatUserStatus(status);
    });
    const unsubTyping = subscribeToTyping(activeChat.threadId, activeChat.otherUid, (isTyping) => {
      setIsOtherTyping(isTyping);
    });
    return () => {
      unsubPresence();
      unsubTyping();
    };
  }, [activeChat?.otherUid, activeChat?.threadId]);

  // Track all contacts online & lastSeen status via RTDB status/{otherUserId}
  useEffect(() => {
    if (contacts.length === 0) return;
    const unsubs = contacts.map((c) => {
      return subscribeToUserStatus(c.otherUid, (status) => {
        const wasOnline = prevOnlineRef.current[c.otherUid];
        setOnlineContactsMap((prev) => ({ ...prev, [c.otherUid]: status.online }));
        setUserStatusMap((prev) => ({ ...prev, [c.otherUid]: status }));
        if (wasOnline === false && status.online && onOnlineNotification) {
          onOnlineNotification(c.otherName);
        }
        prevOnlineRef.current[c.otherUid] = status.online;
      });
    });
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [contacts, onOnlineNotification]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Visible messages: Hide any message marked deletedFor current user
  const visibleMessages = messages.filter(
    (m) => !(m.deletedFor && m.deletedFor.includes(user?.uid || ''))
  );

  // Active unmuted contacts (hides muted accounts where until > Date.now())
  const now = Date.now();
  const activeMutedUids = mutedUsers
    .filter((m) => m.until > now)
    .map((m) => m.uid);

  const unmutedContacts = contacts.filter((c) => !activeMutedUids.includes(c.otherUid));

  // Filtered contacts based on search query (first letter automatically lower case)
  const filteredContacts = unmutedContacts.filter((c) => {
    if (!searchContactQuery.trim()) return true;
    const q = searchContactQuery.toLowerCase().trim();
    return (
      c.otherName.toLowerCase().includes(q) ||
      c.otherHandle.toLowerCase().includes(q)
    );
  });

  // Display contacts: The conversation with the latest message is always at the top before opening
  const displayContacts = [...filteredContacts].sort((a, b) => {
    const timeA = new Date(a.updatedAt || 0).getTime();
    const timeB = new Date(b.updatedAt || 0).getTime();
    if (timeB !== timeA) return timeB - timeA;
    const isAFav = favouriteUserIds.includes(a.otherUid);
    const isBFav = favouriteUserIds.includes(b.otherUid);
    if (isAFav && !isBFav) return -1;
    if (!isAFav && isBFav) return 1;
    return 0;
  });

  // Global search for Nochaf AI users by username if not found in existing contacts
  useEffect(() => {
    const raw = searchContactQuery.toLowerCase().trim();
    const q = raw.replace(/^@+/, '');
    if (!q || q.length < 1) {
      setGlobalSearchResults([]);
      setIsSearchingGlobal(false);
      setGlobalSearchDone(false);
      return;
    }

    // If matches exist in local contacts, external search is not needed
    if (filteredContacts.length > 0) {
      setGlobalSearchResults([]);
      setIsSearchingGlobal(false);
      setGlobalSearchDone(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingGlobal(true);
      setGlobalSearchDone(true);
      try {
        let targetUid = '';
        let targetName = q;
        let targetHandle = q;
        let targetAvatar = '';

        const nameDoc = await getDoc(doc(db, 'usernames', q));
        if (nameDoc.exists()) {
          const uData = nameDoc.data();
          targetUid = uData.uid;
          targetName = uData.displayName || q;
          targetHandle = uData.username || q;
        } else {
          const qUsers = query(collection(db, 'users'), where('username', '==', q));
          const usersSnap = await getDocs(qUsers);
          if (!usersSnap.empty) {
            const uDoc = usersSnap.docs[0];
            const uData = uDoc.data();
            targetUid = uDoc.id;
            targetName = uData.displayName || q;
            targetHandle = uData.username || uData.handle || q;
            targetAvatar = uData.avatar || '';
          } else {
            const qHandle = query(collection(db, 'users'), where('handle', '==', q));
            const handleSnap = await getDocs(qHandle);
            if (!handleSnap.empty) {
              const hDoc = handleSnap.docs[0];
              const hData = hDoc.data();
              targetUid = hDoc.id;
              targetName = hData.displayName || q;
              targetHandle = hData.handle || q;
              targetAvatar = hData.avatar || '';
            }
          }
        }

        if (targetUid && user?.uid && targetUid !== user.uid) {
          if (!targetAvatar) {
            try {
              const uSnap = await getDoc(doc(db, 'users', targetUid));
              if (uSnap.exists()) {
                targetAvatar = uSnap.data().avatar || '';
              }
            } catch {}
          }
          const threadId = [user.uid, targetUid].sort().join('_');
          setGlobalSearchResults([
            {
              threadId,
              otherUid: targetUid,
              otherHandle: targetHandle,
              otherName: targetName,
              otherAvatar: targetAvatar,
              lastMessage: '',
              updatedAt: '',
              unreadCount: 0,
            },
          ]);
        } else {
          setGlobalSearchResults([]);
        }
      } catch (err) {
        setGlobalSearchResults([]);
      } finally {
        setIsSearchingGlobal(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchContactQuery, filteredContacts.length, user?.uid]);

  // -------------------------------------------------------------
  // 3. Send message in active chat (with reply support)
  // -------------------------------------------------------------
  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = messageInput.trim();
    if (!text || !activeChat) return;

    // Ensure user session exists
    let senderUid = user?.uid;
    const cleanHandle = (myHandle || profile?.username || '').replace(/^@+/, '');
    let senderHandle = cleanHandle || (user?.email ? user.email.split('@')[0] : 'me');
    let senderName = myName && myName.toLowerCase() !== 'user' && myName.trim() !== ''
      ? myName
      : `@${senderHandle}`;
    let senderAvatar = myAvatar || '';

    if (!senderUid) {
      onOpenAuth('login');
      return;
    }

    if (activeChat && user?.uid) {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      setTypingPresence(activeChat.threadId, user.uid, false);
    }

    // 1. Check if user is currently muted
    if (profile?.isMuted) {
      if (profile.mutedUntil && Date.now() > profile.mutedUntil) {
        // Natural mute expiration
        updateUserProfile({ isMuted: false, muteReason: undefined, mutedUntil: undefined }).catch(() => {});
      } else {
        setSpamNotice(
          profile.muteReason
            ? `Your account is temporarily muted: ${profile.muteReason}. Tap "I'm not spam (Appeal)" to appeal.`
            : 'Your account is temporarily muted. Tap "I\'m not spam (Appeal)" to appeal.'
        );
        return;
      }
    }

    // 2. SMART SPAM CHECK (Check 3 things TOGETHER: identical + to strangers + spam keywords)
    const isFriendOrExisted = contacts.some(
      (c) => c.otherUid === activeChat.otherUid && (c.lastMessage || messages.length > 1)
    );

    const spamCheck = await evaluateSmartSpam({
      senderUid,
      senderHandle,
      recipientUid: activeChat.otherUid,
      messageText: text,
      isRecipientFriendOrExisted: isFriendOrExisted,
      currentSpamViolations: profile?.spamWarningCount || 0,
    });

    if (spamCheck.isSpam) {
      if (spamCheck.action === 'warning') {
        setSpamNotice(spamCheck.message || 'Slow down: Please avoid sending repeated promotional links to new contacts.');
        setTimeout(() => setSpamNotice(null), 5000);
      } else if (spamCheck.action === 'mute' || spamCheck.action === 'flag_queue') {
        setSpamNotice(spamCheck.message || 'Your account has been temporarily muted.');
        return;
      }
    }

    const isShadowBanned = !!profile?.isShadowBanned;

    const currentReply = replyingTo
      ? {
          id: replyingTo.id,
          senderName: replyingTo.senderName,
          senderHandle: replyingTo.senderHandle,
          content: replyingTo.content.slice(0, 180),
        }
      : null;

    const nowIso = new Date().toISOString();
    const formattedTime = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const isRecipientInsideChat = threadActiveViewers.includes(activeChat.otherUid);
    const initialReadBy = isRecipientInsideChat ? [senderUid, activeChat.otherUid] : [senderUid];

    const isCurrentlyOffline = !isOnline || (typeof navigator !== 'undefined' && !navigator.onLine);

    if (isCurrentlyOffline) {
      // Offline sending: Allow writing and sending immediately without internet connection
      // Message displays a "no internet" icon instead of a tick, and will tick when internet is back
      const offlineMsgId = 'offline_' + Date.now();
      const offlineMsg: DirectMessageItem = {
        id: offlineMsgId,
        text,
        senderId: senderUid,
        receiverId: activeChat.otherUid,
        chatId: activeChat.threadId,
        status: 'offline',
        isOfflinePending: true,
        senderHandle,
        senderName,
        senderAvatar,
        content: text,
        createdAt: nowIso,
        timestamp: formattedTime,
        deletedFor: [],
        readBy: initialReadBy,
        ...(currentReply ? { replyTo: currentReply } : {}),
      };

      setMessages((prev) => {
        const next = [...prev, offlineMsg];
        if (activeChat) {
          messagesCacheRef.current[activeChat.threadId] = next;
          setStoredChatCache(activeChat.threadId, next);
        }
        return next;
      });

      saveToOfflineQueue({
        tempId: offlineMsgId,
        threadId: activeChat.threadId,
        senderUid,
        senderHandle,
        senderName,
        senderAvatar,
        receiverUid: activeChat.otherUid,
        receiverHandle: activeChat.otherHandle,
        receiverName: activeChat.otherName,
        receiverAvatar: activeChat.otherAvatar || '',
        text,
        createdAt: nowIso,
        formattedTime,
        replyTo: currentReply,
      });

      setMessageInput('');
      setReplyingTo(null);
      return;
    }

    // Optimistic message displayed right away with status: "sent"
    const tempMsgId = 'temp_' + Date.now();
    const optimisticMsg: DirectMessageItem = {
      id: tempMsgId,
      text,
      senderId: senderUid,
      receiverId: activeChat.otherUid,
      chatId: activeChat.threadId,
      status: 'sent',
      senderHandle,
      senderName,
      senderAvatar,
      content: text,
      createdAt: nowIso,
      timestamp: formattedTime,
      deletedFor: [],
      readBy: initialReadBy,
      ...(currentReply ? { replyTo: currentReply } : {}),
    };

    setMessages((prev) => {
      const next = [...prev, optimisticMsg];
      if (activeChat) {
        messagesCacheRef.current[activeChat.threadId] = next;
        setStoredChatCache(activeChat.threadId, next);
      }
      return next;
    });
    setMessageInput('');
    if (activeChat && user?.uid) {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      setTypingPresence(activeChat.threadId, user.uid, false);
    }
    setReplyingTo(null);
    setSendingMessage(true);

    try {
      const messagesRef = collection(
        db,
        'directMessages',
        activeChat.threadId,
        'messages'
      );

      const docRef = await addDoc(messagesRef, {
        text,
        senderId: senderUid,
        receiverId: activeChat.otherUid,
        chatId: activeChat.threadId,
        timestamp: serverTimestamp(),
        status: 'sent',
        senderHandle,
        senderName,
        senderAvatar,
        content: text,
        createdAt: nowIso,
        deletedFor: [],
        readBy: initialReadBy,
        ...(isShadowBanned ? { isShadowBanned: true } : {}),
        ...(currentReply ? { replyTo: currentReply } : {}),
      });

      // Update parent thread document with snippet, participants, avatars & sender details
      await setDoc(
        doc(db, 'directMessages', activeChat.threadId),
        {
          id: activeChat.threadId,
          participants: [senderUid, activeChat.otherUid],
          participantHandles: [senderHandle, activeChat.otherHandle],
          participantNames: [senderName, activeChat.otherName],
          lastMessage: text,
          lastMessageTimestamp: nowIso,
          lastSenderId: senderUid,
          lastSenderName: senderName,
          readBy: initialReadBy,
          unreadCounts: {
            [senderUid]: 0,
            [activeChat.otherUid]: isRecipientInsideChat ? 0 : increment(1),
          },
          updatedAt: nowIso,
          deletedFor: [],
          participantAvatars: {
            ...(activeChat.otherAvatar ? { [activeChat.otherUid]: activeChat.otherAvatar } : {}),
            [senderUid]: senderAvatar,
          },
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Network sending failed, message queued for when internet is back:', err);
      // Mark optimistic message as offline pending
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempMsgId
            ? { ...m, isOfflinePending: true, status: 'offline' }
            : m
        )
      );
      saveToOfflineQueue({
        tempId: tempMsgId,
        threadId: activeChat.threadId,
        senderUid,
        senderHandle,
        senderName,
        senderAvatar,
        receiverUid: activeChat.otherUid,
        receiverHandle: activeChat.otherHandle,
        receiverName: activeChat.otherName,
        receiverAvatar: activeChat.otherAvatar || '',
        text,
        createdAt: nowIso,
        formattedTime,
        replyTo: currentReply,
      });
    } finally {
      setSendingMessage(false);
    }
  };

  const handleAppealSpam = async () => {
    if (!user || appealSubmitting) return;
    setAppealSubmitting(true);
    const res = await submitSpamAppeal(user.uid, myHandle || 'user');
    setAppealSubmitting(false);
    if (res.success) {
      setAppealSuccessMsg('Appeal submitted! An administrator will review your account shortly.');
      setTimeout(() => setAppealSuccessMsg(null), 5000);
      updateUserProfile({ hasPendingAppeal: true }).catch(() => {});
    } else {
      setSpamNotice(res.message);
    }
  };

  const handleReportUser = async (targetUid: string, targetHandle: string) => {
    if (!user || reportingUser) return;
    setReportingUser(true);
    try {
      const uRef = doc(db, 'users', targetUid);
      const snap = await getDoc(uRef);
      const currentReports = (snap.data()?.reportCount || 0) + 1;
      const updates: any = {
        reportCount: increment(1),
        lastReportedAt: new Date().toISOString(),
      };
      // LAYER 6: If reported 3 times -> auto shadow-ban
      if (currentReports >= 3) {
        updates.isShadowBanned = true;
        updates.shadowBannedAt = new Date().toISOString();
      }
      await updateDoc(uRef, updates);
      setReportSuccessMsg(`@${targetHandle} has been reported for review.`);
      setTimeout(() => setReportSuccessMsg(null), 3000);
    } catch (err: any) {
      console.warn('Report error:', err);
    } finally {
      setReportingUser(false);
    }
  };

  // -------------------------------------------------------------
  // 4. Message Selection & Long-Press (1/2 second) Handler
  // -------------------------------------------------------------
  const toggleSelectMessage = (msgId: string) => {
    setActiveOptionsMsg(null);
    setShowMsgDeletePrompt(false);
    setSelectedMessageIds((prev) =>
      prev.includes(msgId)
        ? prev.filter((id) => id !== msgId)
        : [...prev, msgId]
    );
  };

  const handleMsgPressStart = (
    msg: DirectMessageItem,
    e: React.TouchEvent | React.MouseEvent
  ) => {
    if (selectedMessageIds.length > 0) return;

    const currentTarget = (e.currentTarget || e.target) as HTMLElement;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    pointerStartPosRef.current = { x: clientX, y: clientY };
    isMsgLongPressRef.current = false;

    if (msgLongPressTimerRef.current) clearTimeout(msgLongPressTimerRef.current);
    // Hold for 1/2 a second (500ms)
    msgLongPressTimerRef.current = setTimeout(() => {
      isMsgLongPressRef.current = true;
      if (window.navigator?.vibrate) {
        window.navigator.vibrate(50);
      }
      const rect = currentTarget.getBoundingClientRect();
      const isMe = msg.senderId === user?.uid;
      // Position reaction bar floating above everything and right next to selected text (top or below)
      let top = rect.top - 62;
      if (top < 65) {
        top = rect.bottom + 8;
      }
      top = Math.max(65, Math.min(window.innerHeight - 130, top));

      let left: number | undefined = undefined;
      let right: number | undefined = undefined;
      if (isMe) {
        right = Math.max(12, window.innerWidth - rect.right);
      } else {
        left = Math.max(12, rect.left);
      }

      setMsgOptionsCoords({ top, left, right, isMe });
      setSelectedMessageIds([msg.id]);
      setActiveOptionsMsg(msg);
      setShowMsgDeletePrompt(false);
    }, 500);
  };

  const handleMsgPressMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!pointerStartPosRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const dx = Math.abs(clientX - pointerStartPosRef.current.x);
    const dy = Math.abs(clientY - pointerStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      if (msgLongPressTimerRef.current) {
        clearTimeout(msgLongPressTimerRef.current);
        msgLongPressTimerRef.current = null;
      }
    }
  };

  const handleMsgPressEnd = () => {
    if (msgLongPressTimerRef.current) {
      clearTimeout(msgLongPressTimerRef.current);
      msgLongPressTimerRef.current = null;
    }
  };

  // React with emoji (♥️, 😂, 🥹, 🤪, 👍, 🔥, 🙏) to held message
  const handleReactToMessage = async (msg: DirectMessageItem, emoji: string) => {
    if (!activeChat || !user?.uid) return;
    const currentUid = user.uid;
    const existing = msg.reactions || {};
    const newEmoji = existing[currentUid] === emoji ? '' : emoji;
    const updatedReactions = { ...existing };
    if (newEmoji) {
      updatedReactions[currentUid] = newEmoji;
    } else {
      delete updatedReactions[currentUid];
    }

    // Instant local UI update on the tapped message
    setMessages((prev) =>
      prev.map((item) =>
        item.id === msg.id ? { ...item, reactions: updatedReactions } : item
      )
    );

    try {
      const msgRef = doc(db, 'directMessages', activeChat.threadId, 'messages', msg.id);
      await updateDoc(msgRef, {
        reactions: updatedReactions,
      });
    } catch (err) {
      console.error('Failed to react:', err);
    }
    setActiveOptionsMsg(null);
    setShowMsgDeletePrompt(false);
    setShowAllEmojis(false);
    setSelectedMessageIds([]);
  };

  // Tapping reaction below a text twice removes it
  const handleReactionPillClick = async (msg: DirectMessageItem, emoji?: string) => {
    if (!activeChat || !user?.uid) return;
    const now = Date.now();
    const tapKey = `${msg.id}_${emoji || 'any'}`;
    const lastTap = lastReactionTapRef.current[tapKey] || 0;
    const isDoubleTap = now - lastTap < 500;
    lastReactionTapRef.current[tapKey] = now;

    const existing = msg.reactions || {};
    const userCurrentEmoji = existing[user.uid];

    // If double tapped, or tapped an emoji user reacted with:
    if (isDoubleTap || (emoji && userCurrentEmoji === emoji) || (userCurrentEmoji && !emoji)) {
      if (userCurrentEmoji) {
        const updatedReactions = { ...existing };
        delete updatedReactions[user.uid];

        setMessages((prev) =>
          prev.map((item) =>
            item.id === msg.id ? { ...item, reactions: updatedReactions } : item
          )
        );

        try {
          const msgRef = doc(db, 'directMessages', activeChat.threadId, 'messages', msg.id);
          await updateDoc(msgRef, {
            reactions: updatedReactions,
          });
        } catch (err) {
          console.error('Failed to remove reaction:', err);
        }
      }
    }
  };

  // Copy single message (text remains visible during the copy process)
  const handleCopySingleMessage = async (msg: DirectMessageItem) => {
    const textToCopy = msg.content || (msg.mediaUrl ? 'Attachment' : '');
    if (textToCopy) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        setCopiedTextNotice(textToCopy);
        // Keep the message highlighted with green border so text is visible during copy
        setSelectedMessageIds([msg.id]);
        setTimeout(() => {
          setCopiedTextNotice(null);
          setSelectedMessageIds([]);
        }, 2200);
      } catch (err) {
        console.error('Failed to copy message:', err);
      }
    }
    setActiveOptionsMsg(null);
    setShowMsgDeletePrompt(false);
    setShowAllEmojis(false);
  };

  // Delete message for me
  const handleDeleteMessageForMe = async (msg: DirectMessageItem) => {
    if (!user || !activeChat) return;
    try {
      const msgRef = doc(db, 'directMessages', activeChat.threadId, 'messages', msg.id);
      await updateDoc(msgRef, {
        deletedFor: arrayUnion(user.uid),
      });
    } catch (err) {
      console.error('Failed to delete for me:', err);
    }
    setActiveOptionsMsg(null);
    setShowMsgDeletePrompt(false);
    setShowAllEmojis(false);
    setSelectedMessageIds([]);
  };

  // Delete message for everyone (ONLY for user's own sent message)
  const handleDeleteMessageForEveryone = async (msg: DirectMessageItem) => {
    if (!user || !activeChat || msg.senderId !== user.uid) return;
    try {
      const msgRef = doc(db, 'directMessages', activeChat.threadId, 'messages', msg.id);
      try {
        await deleteDoc(msgRef);
      } catch {
        await updateDoc(msgRef, {
          content: 'This message was deleted',
          deletedForEveryone: true,
          mediaUrl: null,
        });
      }
    } catch (err) {
      console.error('Failed to delete for everyone:', err);
    }
    setActiveOptionsMsg(null);
    setShowMsgDeletePrompt(false);
    setShowAllEmojis(false);
    setSelectedMessageIds([]);
  };

  // -------------------------------------------------------------
  // 5. Delete Selected Messages (ON USER'S SIDE ONLY)
  // -------------------------------------------------------------
  const handleDeleteSelectedMessages = async () => {
    if (!user || !activeChat || selectedMessageIds.length === 0) return;
    const ids = [...selectedMessageIds];
    setSelectedMessageIds([]);
    setActiveOptionsMsg(null);
    setShowMsgDeletePrompt(false);
    setIsBatchDeleteModalOpen(false);

    try {
      for (const msgId of ids) {
        const msgRef = doc(db, 'directMessages', activeChat.threadId, 'messages', msgId);
        await updateDoc(msgRef, {
          deletedFor: arrayUnion(user.uid),
        });
      }
    } catch (err) {
      console.error('Failed to delete messages on user side:', err);
    }
  };

  // Delete Selected Messages for Everyone
  const handleDeleteSelectedMessagesForEveryone = async () => {
    if (!user || !activeChat || selectedMessageIds.length === 0) return;
    const ids = [...selectedMessageIds];
    setSelectedMessageIds([]);
    setActiveOptionsMsg(null);
    setShowMsgDeletePrompt(false);
    setIsBatchDeleteModalOpen(false);

    try {
      for (const msgId of ids) {
        const msgRef = doc(db, 'directMessages', activeChat.threadId, 'messages', msgId);
        const targetMsg = messages.find((m) => m.id === msgId);
        if (targetMsg && targetMsg.senderId === user.uid) {
          try {
            await deleteDoc(msgRef);
          } catch {
            await updateDoc(msgRef, {
              content: 'This message was deleted',
              deletedForEveryone: true,
              mediaUrl: null,
            });
          }
        } else {
          await updateDoc(msgRef, {
            deletedFor: arrayUnion(user.uid),
          });
        }
      }
    } catch (err) {
      console.error('Failed to delete messages for everyone:', err);
    }
  };

  // -------------------------------------------------------------
  // 6. Copy Selected Messages Text (text visible during process)
  // -------------------------------------------------------------
  const handleCopySelectedMessages = async () => {
    if (selectedMessageIds.length === 0) return;
    const texts = visibleMessages
      .filter((m) => selectedMessageIds.includes(m.id))
      .map((m) => m.content)
      .filter(Boolean)
      .join('\n');

    if (texts) {
      try {
        await navigator.clipboard.writeText(texts);
        setCopiedTextNotice(texts);
        // Keep the selection with green border visible for 2.2s during the copy process
        setTimeout(() => {
          setCopiedTextNotice(null);
          setSelectedMessageIds([]);
        }, 2200);
      } catch (err) {
        console.error('Failed to copy to clipboard:', err);
      }
    }
    setActiveOptionsMsg(null);
    setShowMsgDeletePrompt(false);
  };

  // -------------------------------------------------------------
  // 7. Drag Message to the Right to Reply
  // -------------------------------------------------------------
  const handleTouchDragStart = (
    msg: DirectMessageItem,
    e: React.TouchEvent
  ) => {
    if (isSelectionMode) return;
    touchDragStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchDragMove = (
    msg: DirectMessageItem,
    e: React.TouchEvent
  ) => {
    if (!touchDragStartRef.current || isSelectionMode) return;
    const dx = e.touches[0].clientX - touchDragStartRef.current.x;
    const dy = e.touches[0].clientY - touchDragStartRef.current.y;

    if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {
      setDragMsgId(msg.id);
      setDragOffset(Math.min(dx, 80));
    }
  };

  const handleTouchDragEnd = (msg: DirectMessageItem) => {
    if (dragMsgId === msg.id && dragOffset >= 45) {
      setReplyingTo(msg);
      if (window.navigator?.vibrate) {
        window.navigator.vibrate(30);
      }
      setTimeout(() => messageInputRef.current?.focus(), 60);
    }
    setDragMsgId(null);
    setDragOffset(0);
    touchDragStartRef.current = null;
  };

  const handleMouseDragStart = (msg: DirectMessageItem, e: React.MouseEvent) => {
    if (e.button !== 0 || isSelectionMode) return;
    mouseDragStartRef.current = { x: e.clientX, id: msg.id };
  };

  const handleMouseDragMove = (msg: DirectMessageItem, e: React.MouseEvent) => {
    if (!mouseDragStartRef.current || mouseDragStartRef.current.id !== msg.id || isSelectionMode) return;
    const dx = e.clientX - mouseDragStartRef.current.x;
    if (dx > 0) {
      setDragMsgId(msg.id);
      setDragOffset(Math.min(dx, 80));
    }
  };

  const handleMouseDragEnd = (msg: DirectMessageItem) => {
    if (mouseDragStartRef.current && mouseDragStartRef.current.id === msg.id) {
      if (dragOffset >= 45) {
        setReplyingTo(msg);
        if (window.navigator?.vibrate) {
          window.navigator.vibrate(30);
        }
        setTimeout(() => messageInputRef.current?.focus(), 60);
      }
    }
    mouseDragStartRef.current = null;
    setDragMsgId(null);
    setDragOffset(0);
  };

  // -------------------------------------------------------------
  // 8. Long-Press (1 second) on Conversation to Select & Tap to Select Others
  // -------------------------------------------------------------
  const handleThreadPressStart = (
    c: ChatContact,
    e: React.TouchEvent | React.MouseEvent
  ) => {
    if (selectedThreadIds.length > 0) {
      // In multi-selection mode: tapping will handle selection immediately
      return;
    }
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    pointerStartPosRef.current = { x, y };
    isThreadLongPressRef.current = false;

    if (threadLongPressTimerRef.current) clearTimeout(threadLongPressTimerRef.current);
    // Hold conversation for 1 second (1000ms) to select
    threadLongPressTimerRef.current = setTimeout(() => {
      isThreadLongPressRef.current = true;
      if (window.navigator?.vibrate) {
        window.navigator.vibrate(50);
      }
      setSelectedThreadIds([c.threadId]);
    }, 1000);
  };

  const handleThreadPressMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!pointerStartPosRef.current) return;
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const dx = Math.abs(x - pointerStartPosRef.current.x);
    const dy = Math.abs(y - pointerStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      if (threadLongPressTimerRef.current) {
        clearTimeout(threadLongPressTimerRef.current);
        threadLongPressTimerRef.current = null;
      }
    }
  };

  const handleThreadPressEnd = () => {
    if (threadLongPressTimerRef.current) {
      clearTimeout(threadLongPressTimerRef.current);
      threadLongPressTimerRef.current = null;
    }
  };

  const handleThreadClick = (c: ChatContact) => {
    if (isThreadLongPressRef.current) {
      isThreadLongPressRef.current = false;
      return;
    }
    if (selectedThreadIds.length > 0) {
      // In multi-selection mode: just tap others to select/deselect any you want
      setSelectedThreadIds((prev) =>
        prev.includes(c.threadId)
          ? prev.filter((id) => id !== c.threadId)
          : [...prev, c.threadId]
      );
      return;
    }
    // Instant clear of unread count on contact so 3D circle disappears immediately upon viewing
    setContacts((prev) =>
      prev.map((item) =>
        item.threadId === c.threadId ? { ...item, unreadCount: 0 } : item
      )
    );
    if (user?.uid) {
      updateDoc(doc(db, 'directMessages', c.threadId), {
        readBy: arrayUnion(user.uid),
        [`unreadCounts.${user.uid}`]: 0,
      }).catch(() => {});
    }
    if (typeof window !== 'undefined') {
      window.history.pushState({ threadId: c.threadId }, '');
    }

    // Immediately restore cached conversation messages so it displays instantly with no empty chat
    const cached = messagesCacheRef.current[c.threadId] || getStoredChatCache(c.threadId);
    if (cached && cached.length > 0) {
      setMessages(cached);
    } else if (c.lastMessage) {
      const initialSeed: DirectMessageItem = {
        id: 'seed_' + c.threadId,
        content: c.lastMessage,
        text: c.lastMessage,
        senderId: c.otherUid,
        senderHandle: c.otherHandle,
        senderName: c.otherName,
        senderAvatar: c.otherAvatar,
        createdAt: c.updatedAt || new Date().toISOString(),
        status: 'read',
      };
      setMessages([initialSeed]);
    }

    setActiveChat({ ...c, unreadCount: 0 });
  };

  // Batch delete selected conversations at once on user side
  const handleBatchDeleteThreads = async () => {
    if (!user || selectedThreadIds.length === 0) return;
    const ids = [...selectedThreadIds];
    setSelectedThreadIds([]);
    try {
      for (const tId of ids) {
        await updateDoc(doc(db, 'directMessages', tId), {
          deletedFor: arrayUnion(user.uid),
        });
        const messagesRef = collection(db, 'directMessages', tId, 'messages');
        const snap = await getDocs(messagesRef);
        for (const d of snap.docs) {
          await updateDoc(d.ref, {
            deletedFor: arrayUnion(user.uid),
          });
        }
      }
    } catch (err) {
      console.error('Failed to batch delete conversations:', err);
    }
  };

  // Delete Conversation Whole (ON CURRENT USER'S SIDE ONLY)
  const handleConfirmDeleteThread = async () => {
    if (!threadToDelete || !user) return;
    try {
      await updateDoc(doc(db, 'directMessages', threadToDelete.threadId), {
        deletedFor: arrayUnion(user.uid),
      });

      const messagesRef = collection(
        db,
        'directMessages',
        threadToDelete.threadId,
        'messages'
      );
      const snap = await getDocs(messagesRef);
      for (const d of snap.docs) {
        await updateDoc(d.ref, {
          deletedFor: arrayUnion(user.uid),
        });
      }

      if (activeChat?.threadId === threadToDelete.threadId) {
        setActiveChat(null);
      }
      setThreadToDelete(null);
    } catch (err) {
      console.error('Failed to delete thread on user side:', err);
    }
  };

  // -------------------------------------------------------------
  // 9. "Add someone to chat" by username
  // -------------------------------------------------------------
  const handleAddPersonByUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    const cleanInput = normalizeUsername(addUsernameInput);
    if (!cleanInput) {
      setAddError('Please enter a username.');
      return;
    }

    let currentSenderUid = user?.uid;
    if (!currentSenderUid) {
      setAddSearching(false);
      setIsAddModalOpen(false);
      onOpenAuth('login');
      return;
    }

    if (cleanInput === myHandle.toLowerCase()) {
      setAddError('You cannot text your own username.');
      return;
    }

    setAddSearching(true);
    try {
      // LAYER 6: Monitor chat creation rate (5 in 1 minute -> flag account)
      await trackChatCreation(currentSenderUid);

      let targetUid = '';
      let targetName = cleanInput;
      let targetAvatar = '';
      let targetHandle = cleanInput;

      const nameDoc = await getDoc(doc(db, 'usernames', cleanInput));
      if (nameDoc.exists()) {
        const uData = nameDoc.data();
        targetUid = uData.uid;
        targetName = uData.displayName || cleanInput;
        targetHandle = uData.username || cleanInput;
      } else {
        const qUsers = query(
          collection(db, 'users'),
          where('username', '==', cleanInput)
        );
        const usersSnap = await getDocs(qUsers);

        if (!usersSnap.empty) {
          const uDoc = usersSnap.docs[0];
          const uData = uDoc.data();
          targetUid = uDoc.id;
          targetName = uData.displayName || cleanInput;
          targetHandle = uData.username || uData.handle || cleanInput;
          targetAvatar = uData.avatar || '';
        } else {
          const qHandle = query(
            collection(db, 'users'),
            where('handle', '==', cleanInput)
          );
          const handleSnap = await getDocs(qHandle);
          if (!handleSnap.empty) {
            const hDoc = handleSnap.docs[0];
            const hData = hDoc.data();
            targetUid = hDoc.id;
            targetName = hData.displayName || cleanInput;
            targetHandle = hData.handle || cleanInput;
            targetAvatar = hData.avatar || '';
          }
        }
      }

      // If user is not found on Nochaf AI, inform the user directly
      if (!targetUid) {
        setAddError(`user "${cleanInput}" not found`);
        return;
      }

      if (!targetAvatar && targetUid) {
        try {
          const userSnap = await getDoc(doc(db, 'users', targetUid));
          if (userSnap.exists()) {
            targetAvatar = userSnap.data().avatar || '';
          }
        } catch {}
      }

      const threadId = [currentSenderUid, targetUid].sort().join('_');
      // CRITICAL: Do NOT write to Firestore directMessages here!
      // Searching someone without texting must not create a thread or notify either party!
      const threadRef = doc(db, 'directMessages', threadId);
      const threadSnap = await getDoc(threadRef);
      const nowIso = new Date().toISOString();

      const newContact: ChatContact = {
        threadId,
        otherUid: targetUid,
        otherHandle: targetHandle,
        otherName: targetName,
        otherAvatar: targetAvatar,
        lastMessage: threadSnap.exists() ? threadSnap.data()?.lastMessage || '' : '',
        updatedAt: threadSnap.exists() ? threadSnap.data()?.updatedAt || '' : '',
        unreadCount: 0,
      };

      setIsAddModalOpen(false);
      setAddUsernameInput('');
      setActiveChat(newContact);
    } catch (err: any) {
      console.error('Error finding user:', err);
      setAddError(`user "${cleanInput}" not found`);
    } finally {
      setAddSearching(false);
    }
  };

  // Helper: Detect single emoji to display larger
  const isSingleEmoji = (str: string): boolean => {
    if (!str) return false;
    const trimmed = str.trim();
    // Allow single emojis with variation selectors (\uFE0F, \uFE0E), skin-tone modifiers, ZWJ sequences
    const regex = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}]?(\u200D(\p{Extended_Pictographic}|\p{Emoji_Presentation})[\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}]?)*$/u;
    if (regex.test(trimmed)) return true;
    try {
      if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
        const segmenter = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
        const segments = Array.from(segmenter.segment(trimmed));
        if (segments.length === 1) {
          return /\p{Extended_Pictographic}/u.test(trimmed);
        }
      }
    } catch {}
    return false;
  };

  // Helper: Clean media file name so raw file_00000 numbers are not exposed
  const cleanFileName = (name?: string): string => {
    if (!name) return 'Audio Track';
    if (/^file_[0-9a-f]+/i.test(name) || /^[0-9a-f]{16,}/i.test(name)) {
      return 'Audio Track';
    }
    return name.replace(/^file_[0-9a-f]+_/i, '');
  };

  // 1. Camera: Select pictures or videos (preview before sending: crop for pictures, trim & mute for video)
  const handleChatMediaSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(e.target.files || []);
    if (rawFiles.length === 0 || !user || !activeChat) return;

    const loadedItems: Array<{
      type: 'image' | 'video';
      dataUrl: string;
      originalDataUrl: string;
      name: string;
      isMuted?: boolean;
      trimStartSec?: number;
      trimEndSec?: number;
      videoDurationSec?: number;
    }> = [];

    let pending = rawFiles.length;

    const finishLoading = () => {
      if (loadedItems.length === 0) return;
      const hasVideos = loadedItems.some((it) => it.type === 'video');
      const hasImages = loadedItems.some((it) => it.type === 'image');
      const overallType: 'image' | 'video' | 'mixed' =
        hasVideos && hasImages ? 'mixed' : hasVideos ? 'video' : 'image';

      setMediaSendPreview({
        type: overallType,
        items: loadedItems,
        activeIndex: 0,
        caption: '',
        isCropping: false,
        cropAspect: 'free',
        isMuted: false,
        trimStartSec: 0,
        trimEndSec: loadedItems[0]?.videoDurationSec || 15,
        videoDurationSec: loadedItems[0]?.videoDurationSec || 15,
      });
      setFreeCropRect({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
    };

    for (const file of rawFiles) {
      const isVideo = file.type.startsWith('video/');
      const reader = new FileReader();

      reader.onload = () => {
        const dataUrl = reader.result as string;
        if (isVideo) {
          const tempVideo = document.createElement('video');
          tempVideo.src = dataUrl;
          tempVideo.onloadedmetadata = () => {
            const dur = Math.ceil(tempVideo.duration || 15);
            loadedItems.push({
              type: 'video',
              dataUrl,
              originalDataUrl: dataUrl,
              name: file.name,
              isMuted: false,
              trimStartSec: 0,
              trimEndSec: dur,
              videoDurationSec: dur,
            });
            pending--;
            if (pending === 0) finishLoading();
          };
          tempVideo.onerror = () => {
            loadedItems.push({
              type: 'video',
              dataUrl,
              originalDataUrl: dataUrl,
              name: file.name,
              isMuted: false,
              trimStartSec: 0,
              trimEndSec: 15,
              videoDurationSec: 15,
            });
            pending--;
            if (pending === 0) finishLoading();
          };
        } else {
          loadedItems.push({
            type: 'image',
            dataUrl,
            originalDataUrl: dataUrl,
            name: file.name,
          });
          pending--;
          if (pending === 0) finishLoading();
        }
      };

      reader.readAsDataURL(file);
    }

    setShowAttachMenu(false);
    e.target.value = '';
  };

  // Freehand Crop active image using canvas based on user's manual hand-dragged rectangle
  const handleApplyFreehandCrop = () => {
    if (!mediaSendPreview) return;
    const activeItem = mediaSendPreview.items[mediaSendPreview.activeIndex];
    if (!activeItem || activeItem.type !== 'image') return;

    const img = new Image();
    img.src = activeItem.originalDataUrl;
    img.onload = () => {
      const rx = Math.max(0, Math.min(0.95, freeCropRect.x));
      const ry = Math.max(0, Math.min(0.95, freeCropRect.y));
      const rw = Math.max(0.05, Math.min(1 - rx, freeCropRect.width));
      const rh = Math.max(0.05, Math.min(1 - ry, freeCropRect.height));

      const cropX = Math.round(rx * img.width);
      const cropY = Math.round(ry * img.height);
      const cropW = Math.max(1, Math.round(rw * img.width));
      const cropH = Math.max(1, Math.round(rh * img.height));

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        const croppedUrl = canvas.toDataURL('image/jpeg', 0.92);
        const updatedItems = [...mediaSendPreview.items];
        updatedItems[mediaSendPreview.activeIndex] = {
          ...activeItem,
          dataUrl: croppedUrl,
        };
        setMediaSendPreview({
          ...mediaSendPreview,
          items: updatedItems,
          isCropping: false,
          cropAspect: 'free',
        });
        triggerToast('Cropped with free hand!');
      }
    };
  };

  const handleResetCrop = () => {
    if (!mediaSendPreview) return;
    const activeItem = mediaSendPreview.items[mediaSendPreview.activeIndex];
    if (!activeItem) return;
    const updatedItems = [...mediaSendPreview.items];
    updatedItems[mediaSendPreview.activeIndex] = {
      ...activeItem,
      dataUrl: activeItem.originalDataUrl,
    };
    setMediaSendPreview({
      ...mediaSendPreview,
      items: updatedItems,
      isCropping: false,
      cropAspect: 'free',
    });
    setFreeCropRect({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
    triggerToast('Reset to original photo');
  };

  // Crop active image with presets or adjust freehand frame
  const handleApplyCrop = (aspect: 'free' | '1:1' | '4:3' | '16:9') => {
    if (aspect === 'free') {
      setFreeCropRect({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
      return;
    }

    let targetRatio = 1;
    if (aspect === '1:1') targetRatio = 1;
    if (aspect === '4:3') targetRatio = 4 / 3;
    if (aspect === '16:9') targetRatio = 16 / 9;

    if (targetRatio >= 1) {
      const w = 0.85;
      const h = Math.min(0.85, 0.85 / targetRatio);
      setFreeCropRect({ x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h });
    } else {
      const h = 0.85;
      const w = Math.min(0.85, 0.85 * targetRatio);
      setFreeCropRect({ x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h });
    }
  };

  // Freehand crop pointer down handler
  const handleFreeCropPointerDown = (
    handle: string,
    e: React.MouseEvent | React.TouchEvent
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    freeCropActiveHandleRef.current = handle;
    freeCropStartRef.current = {
      clientX,
      clientY,
      rect: { ...freeCropRect },
    };
  };

  // Window listeners for freehand crop box dragging
  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!freeCropActiveHandleRef.current || !previewImageContainerRef.current) return;
      const handle = freeCropActiveHandleRef.current;
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

      const containerRect = previewImageContainerRef.current.getBoundingClientRect();
      if (containerRect.width <= 0 || containerRect.height <= 0) return;

      const dx = (clientX - freeCropStartRef.current.clientX) / containerRect.width;
      const dy = (clientY - freeCropStartRef.current.clientY) / containerRect.height;

      const start = freeCropStartRef.current.rect;
      let newX = start.x;
      let newY = start.y;
      let newW = start.width;
      let newH = start.height;

      if (handle === 'move') {
        newX = Math.max(0, Math.min(1 - newW, start.x + dx));
        newY = Math.max(0, Math.min(1 - newH, start.y + dy));
      } else {
        if (handle.includes('w')) {
          const right = start.x + start.width;
          newX = Math.max(0, Math.min(right - 0.05, start.x + dx));
          newW = right - newX;
        }
        if (handle.includes('e')) {
          newW = Math.max(0.05, Math.min(1 - start.x, start.width + dx));
        }
        if (handle.includes('n')) {
          const bottom = start.y + start.height;
          newY = Math.max(0, Math.min(bottom - 0.05, start.y + dy));
          newH = bottom - newY;
        }
        if (handle.includes('s')) {
          newH = Math.max(0.05, Math.min(1 - start.y, start.height + dy));
        }
      }

      setFreeCropRect({
        x: Math.max(0, Math.min(0.95, newX)),
        y: Math.max(0, Math.min(0.95, newY)),
        width: Math.max(0.05, Math.min(1 - newX, newW)),
        height: Math.max(0.05, Math.min(1 - newY, newH)),
      });
    };

    const handleUp = () => {
      freeCropActiveHandleRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    window.addEventListener('touchcancel', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
      window.removeEventListener('touchcancel', handleUp);
    };
  }, [freeCropRect]);

  // Rotate active image 90 degrees
  const handleRotateImage = () => {
    if (!mediaSendPreview) return;
    const activeItem = mediaSendPreview.items[mediaSendPreview.activeIndex];
    if (!activeItem || activeItem.type !== 'image') return;

    const img = new Image();
    img.src = activeItem.dataUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        const rotatedUrl = canvas.toDataURL('image/jpeg', 0.92);
        const updatedItems = [...mediaSendPreview.items];
        updatedItems[mediaSendPreview.activeIndex] = {
          ...activeItem,
          dataUrl: rotatedUrl,
        };
        setMediaSendPreview({
          ...mediaSendPreview,
          items: updatedItems,
        });
        triggerToast('Rotated photo 90°');
      }
    };
  };

  // Send confirmed media (multiple pictures and videos support)
  const handleSendConfirmedMedia = async () => {
    if (!mediaSendPreview || !user || !activeChat) return;
    const caption = mediaSendPreview.caption.trim();

    const isRecipientInsideChat = threadActiveViewers.includes(activeChat.otherUid);
    const initialReadBy = isRecipientInsideChat ? [user.uid, activeChat.otherUid] : [user.uid];
    const nowIso = new Date().toISOString();
    const formattedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const imageItems = mediaSendPreview.items.filter((it) => it.type === 'image');
    const videoItems = mediaSendPreview.items.filter((it) => it.type === 'video');

    const optimisticMessages: DirectMessageItem[] = [];

    // 1. If images exist: group into photo message
    if (imageItems.length > 0) {
      const tempImgId = 'media_img_' + Date.now();
      const photoUrls = imageItems.map((it) => it.dataUrl);
      optimisticMessages.push({
        id: tempImgId,
        text: caption,
        senderId: user.uid,
        receiverId: activeChat.otherUid,
        chatId: activeChat.threadId,
        status: 'sent',
        senderHandle: myHandle,
        senderName: myName,
        senderAvatar: myAvatar,
        content: caption,
        mediaUrl: photoUrls[0],
        mediaUrls: photoUrls,
        mediaType: 'image',
        createdAt: nowIso,
        timestamp: formattedTime,
        deletedFor: [],
        readBy: initialReadBy,
      });
    }

    // 2. If videos exist: each video is an optimistic message
    videoItems.forEach((vItem, vIdx) => {
      const tempVidId = 'media_vid_' + Date.now() + '_' + vIdx;
      optimisticMessages.push({
        id: tempVidId,
        text: imageItems.length === 0 && vIdx === 0 ? caption : '',
        senderId: user.uid,
        receiverId: activeChat.otherUid,
        chatId: activeChat.threadId,
        status: 'sent',
        senderHandle: myHandle,
        senderName: myName,
        senderAvatar: myAvatar,
        content: imageItems.length === 0 && vIdx === 0 ? caption : '',
        mediaUrl: vItem.dataUrl,
        mediaType: 'video',
        isMuted: vItem.isMuted,
        duration: (vItem.trimEndSec || 15) - (vItem.trimStartSec || 0),
        createdAt: nowIso,
        timestamp: formattedTime,
        deletedFor: [],
        readBy: initialReadBy,
      });
    });

    setMessages((prev) => [...prev, ...optimisticMessages]);
    setMediaSendPreview(null);

    try {
      const messagesRef = collection(db, 'directMessages', activeChat.threadId, 'messages');

      // Send images to Firestore
      if (imageItems.length > 0) {
        const photoUrls = imageItems.map((it) => it.dataUrl);
        const docRef = await addDoc(messagesRef, {
          text: caption,
          senderId: user.uid,
          receiverId: activeChat.otherUid,
          chatId: activeChat.threadId,
          timestamp: serverTimestamp(),
          status: 'sent',
          senderHandle: myHandle,
          senderName: myName,
          senderAvatar: myAvatar,
          content: caption,
          mediaUrl: photoUrls[0],
          mediaUrls: photoUrls,
          mediaType: 'image',
          createdAt: nowIso,
          deletedFor: [],
          readBy: initialReadBy,
        });
      }

      // Send videos to Firestore
      for (let i = 0; i < videoItems.length; i++) {
        const v = videoItems[i];
        const docRef = await addDoc(messagesRef, {
          text: imageItems.length === 0 && i === 0 ? caption : '',
          senderId: user.uid,
          receiverId: activeChat.otherUid,
          chatId: activeChat.threadId,
          timestamp: serverTimestamp(),
          status: 'sent',
          senderHandle: myHandle,
          senderName: myName,
          senderAvatar: myAvatar,
          content: imageItems.length === 0 && i === 0 ? caption : '',
          mediaUrl: v.dataUrl,
          mediaType: 'video',
          isMuted: v.isMuted,
          duration: (v.trimEndSec || 15) - (v.trimStartSec || 0),
          createdAt: nowIso,
          deletedFor: [],
          readBy: initialReadBy,
        });
      }

      let summaryText = '📷 Media';
      if (imageItems.length > 0 && videoItems.length > 0) {
        summaryText = `📷 ${imageItems.length} photos, 📹 ${videoItems.length} videos`;
      } else if (imageItems.length > 1) {
        summaryText = caption ? `📷 ${imageItems.length} photos: ${caption}` : `📷 ${imageItems.length} photos`;
      } else if (imageItems.length === 1) {
        summaryText = caption ? `📷 Photo: ${caption}` : '📷 Photo';
      } else if (videoItems.length > 1) {
        summaryText = `📹 ${videoItems.length} videos`;
      } else if (videoItems.length === 1) {
        summaryText = caption ? `📹 Video: ${caption}` : '📹 Video';
      }

      await setDoc(doc(db, 'directMessages', activeChat.threadId), {
        lastMessage: summaryText,
        lastMessageTimestamp: nowIso,
        lastSenderId: user.uid,
        lastSenderName: myName,
        readBy: initialReadBy,
        unreadCounts: {
          [user.uid]: 0,
          [activeChat.otherUid]: isRecipientInsideChat ? 0 : increment(1),
        },
        updatedAt: nowIso,
        deletedFor: [],
      }, { merge: true });
    } catch (err) {
      console.error('Error sending media:', err);
    }
  };

  // Voice Note Handlers: Start -> Stop (Listen before sending) -> Continue recording from where it left off -> Send
  const handleStartVoiceRecording = async (isContinuing = false) => {
    try {
      // Pause preview audio if currently playing
      if (previewVoiceAudioRef.current) {
        previewVoiceAudioRef.current.pause();
        previewVoiceAudioRef.current = null;
      }
      setIsPreviewVoicePlaying(false);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      if (!isContinuing) {
        voiceChunksRef.current = [];
        setRecordingSeconds(0);
        setRecordedVoiceUrl(null);
        setRecordedDurationSec(0);
      }

      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) voiceChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setRecordedVoiceUrl(dataUrl);
          setVoiceRecordStage('recorded');
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setVoiceRecordStage('recording');

      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone permission not granted:', err);
      alert('Microphone permission is required to record voice notes.');
    }
  };

  const handleStopVoiceRecording = () => {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    setRecordedDurationSec(recordingSeconds > 0 ? recordingSeconds : 1);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
  };

  // Listen to recorded voice note before sending ("listen it before, regulate it's speed")
  const togglePlayPreviewVoice = () => {
    if (!recordedVoiceUrl) return;

    if (previewVoiceAudioRef.current) {
      if (isPreviewVoicePlaying) {
        previewVoiceAudioRef.current.pause();
        if (previewProgressIntervalRef.current) {
          clearInterval(previewProgressIntervalRef.current);
          previewProgressIntervalRef.current = null;
        }
        setIsPreviewVoicePlaying(false);
      } else {
        const dur = previewVoiceAudioRef.current.duration && !isNaN(previewVoiceAudioRef.current.duration)
          ? previewVoiceAudioRef.current.duration
          : (recordedDurationSec || 1);
        if (previewVoiceProgress.current >= dur - 0.05) {
          previewVoiceAudioRef.current.currentTime = 0;
        }
        previewVoiceAudioRef.current.playbackRate = previewPlaybackSpeed;
        previewVoiceAudioRef.current.play().then(() => {
          setIsPreviewVoicePlaying(true);
          startPreviewProgressTracking();
        }).catch(() => setIsPreviewVoicePlaying(false));
      }
      return;
    }

    const audio = new Audio(recordedVoiceUrl);
    audio.playbackRate = previewPlaybackSpeed;
    previewVoiceAudioRef.current = audio;
    setIsPreviewVoicePlaying(true);

    const startPreviewProgressTracking = () => {
      if (previewProgressIntervalRef.current) clearInterval(previewProgressIntervalRef.current);
      previewProgressIntervalRef.current = setInterval(() => {
        if (previewVoiceAudioRef.current) {
          const dur = previewVoiceAudioRef.current.duration && !isNaN(previewVoiceAudioRef.current.duration)
            ? previewVoiceAudioRef.current.duration
            : (recordedDurationSec || 1);
          const curr = previewVoiceAudioRef.current.currentTime;
          setPreviewVoiceProgress({
            current: Math.min(curr, dur),
            duration: dur,
          });
        }
      }, 25);
    };

    audio.ontimeupdate = () => {
      const dur = audio.duration && !isNaN(audio.duration) ? audio.duration : (recordedDurationSec || 1);
      setPreviewVoiceProgress({
        current: Math.min(audio.currentTime, dur),
        duration: dur,
      });
    };

    audio.onended = () => {
      if (previewProgressIntervalRef.current) {
        clearInterval(previewProgressIntervalRef.current);
        previewProgressIntervalRef.current = null;
      }
      const dur = audio.duration && !isNaN(audio.duration) ? audio.duration : (recordedDurationSec || 1);
      // Ensure the animated bar reaches the very end (100%) when the voice is over
      setPreviewVoiceProgress({ current: dur, duration: dur });
      setIsPreviewVoicePlaying(false);
      previewVoiceAudioRef.current = null;
    };

    audio.onerror = () => {
      if (previewProgressIntervalRef.current) {
        clearInterval(previewProgressIntervalRef.current);
        previewProgressIntervalRef.current = null;
      }
      setIsPreviewVoicePlaying(false);
      previewVoiceAudioRef.current = null;
    };

    audio.play().then(() => {
      startPreviewProgressTracking();
    }).catch(() => {
      setIsPreviewVoicePlaying(false);
      previewVoiceAudioRef.current = null;
    });
  };

  const handleSeekPreviewVoice = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!recordedVoiceUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const dur = previewVoiceProgress.duration || recordedDurationSec || 1;
    const targetTime = ratio * dur;

    if (previewVoiceAudioRef.current) {
      previewVoiceAudioRef.current.currentTime = targetTime;
      setPreviewVoiceProgress((prev) => ({ ...prev, current: targetTime, duration: dur }));
    } else {
      setPreviewVoiceProgress({ current: targetTime, duration: dur });
    }
  };

  const handleCancelVoiceRecording = () => {
    if (previewProgressIntervalRef.current) {
      clearInterval(previewProgressIntervalRef.current);
      previewProgressIntervalRef.current = null;
    }
    if (previewVoiceAudioRef.current) {
      previewVoiceAudioRef.current.pause();
      previewVoiceAudioRef.current = null;
    }
    setIsPreviewVoicePlaying(false);
    setPreviewVoiceProgress({ current: 0, duration: 0 });

    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    voiceChunksRef.current = [];
    setRecordedVoiceUrl(null);
    setRecordedDurationSec(0);
    setRecordingSeconds(0);
    setVoiceRecordStage('idle');
    setShowVoiceRecorder(false);
    isSendingVoiceRef.current = false;
    setIsSendingVoiceNote(false);
  };

  const handleSendVoiceRecording = async () => {
    // Guard against resending or duplicate sending of the same voice note
    if (isSendingVoiceRef.current || !recordedVoiceUrl || !user || !activeChat) return;
    if (sentVoiceNoteUrlsRef.current.has(recordedVoiceUrl)) {
      setRecordedVoiceUrl(null);
      setVoiceRecordStage('idle');
      setShowVoiceRecorder(false);
      return;
    }

    isSendingVoiceRef.current = true;
    setIsSendingVoiceNote(true);

    const voiceUrlToSend = recordedVoiceUrl;
    sentVoiceNoteUrlsRef.current.add(voiceUrlToSend);

    const durSec = recordedDurationSec || recordingSeconds || 1;
    const durFormatted = `${Math.floor(durSec / 60)}:${(durSec % 60).toString().padStart(2, '0')}`;

    if (previewProgressIntervalRef.current) {
      clearInterval(previewProgressIntervalRef.current);
      previewProgressIntervalRef.current = null;
    }
    if (previewVoiceAudioRef.current) {
      previewVoiceAudioRef.current.pause();
      previewVoiceAudioRef.current = null;
    }
    setIsPreviewVoicePlaying(false);
    setPreviewVoiceProgress({ current: 0, duration: 0 });

    // Instantly wipe voice note URL, raw chunks & close recorder stage so user cannot resend the same note
    voiceChunksRef.current = [];
    setRecordedVoiceUrl(null);
    setRecordedDurationSec(0);
    setRecordingSeconds(0);
    setVoiceRecordStage('idle');
    setShowVoiceRecorder(false);

    try {
      const isRecipientInsideChat = threadActiveViewers.includes(activeChat.otherUid);
      const initialReadBy = isRecipientInsideChat ? [user.uid, activeChat.otherUid] : [user.uid];

      const messagesRef = collection(db, 'directMessages', activeChat.threadId, 'messages');
      const nowIso = new Date().toISOString();

      const docRef = await addDoc(messagesRef, {
        text: '',
        senderId: user.uid,
        receiverId: activeChat.otherUid,
        chatId: activeChat.threadId,
        timestamp: serverTimestamp(),
        status: 'sent',
        senderHandle: myHandle,
        senderName: myName,
        senderAvatar: myAvatar,
        content: '',
        mediaUrl: voiceUrlToSend,
        mediaType: 'audio',
        isVoiceNote: true,
        duration: durSec,
        durationText: durFormatted,
        createdAt: nowIso,
        deletedFor: [],
        readBy: initialReadBy,
      });

      await setDoc(
        doc(db, 'directMessages', activeChat.threadId),
        {
          lastMessage: `🎙️ Voice note (${durFormatted})`,
          lastMessageTimestamp: nowIso,
          lastSenderId: user.uid,
          lastSenderName: myName,
          readBy: initialReadBy,
          unreadCounts: {
            [user.uid]: 0,
            [activeChat.otherUid]: isRecipientInsideChat ? 0 : increment(1),
          },
          updatedAt: nowIso,
          deletedFor: [],
        },
        { merge: true }
      );
    } catch (err) {
      console.error('Error sending voice note:', err);
    } finally {
      isSendingVoiceRef.current = false;
      setIsSendingVoiceNote(false);
    }
  };

  // Play audio or voice note with real-time smooth animation reaching the end and speed regulation ("listen it after, regulate it's speed")
  const playAudioMessage = (msgId: string, url: string) => {
    if (playingAudioId === msgId) {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
      if (chatAudioProgressIntervalRef.current) {
        clearInterval(chatAudioProgressIntervalRef.current);
        chatAudioProgressIntervalRef.current = null;
      }
      setPlayingAudioId(null);
      return;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    if (chatAudioProgressIntervalRef.current) {
      clearInterval(chatAudioProgressIntervalRef.current);
      chatAudioProgressIntervalRef.current = null;
    }

    const audio = new Audio(url);
    audio.playbackRate = audioPlaybackSpeed;
    currentAudioRef.current = audio;
    setPlayingAudioId(msgId);

    // If starting from ended state, start from 0
    audio.currentTime = 0;

    const startChatAudioProgressTracking = () => {
      if (chatAudioProgressIntervalRef.current) clearInterval(chatAudioProgressIntervalRef.current);
      chatAudioProgressIntervalRef.current = setInterval(() => {
        if (currentAudioRef.current && currentAudioRef.current === audio) {
          const dur = audio.duration && !isNaN(audio.duration) ? audio.duration : 1;
          const curr = audio.currentTime;
          setAudioProgress((prev) => ({
            ...prev,
            [msgId]: {
              current: Math.min(curr, dur),
              duration: dur,
            },
          }));
        }
      }, 25);
    };

    audio.ontimeupdate = () => {
      const dur = audio.duration && !isNaN(audio.duration) ? audio.duration : 1;
      setAudioProgress((prev) => ({
        ...prev,
        [msgId]: {
          current: Math.min(audio.currentTime, dur),
          duration: dur,
        },
      }));
    };

    audio.onended = () => {
      if (chatAudioProgressIntervalRef.current) {
        clearInterval(chatAudioProgressIntervalRef.current);
        chatAudioProgressIntervalRef.current = null;
      }
      const dur = audio.duration && !isNaN(audio.duration) ? audio.duration : 1;
      // Animate the voice note bar to reach the end (100%) when the voice is over
      setAudioProgress((prev) => ({
        ...prev,
        [msgId]: {
          current: dur,
          duration: dur,
        },
      }));
      setPlayingAudioId(null);
      currentAudioRef.current = null;
    };

    audio.onerror = () => {
      if (chatAudioProgressIntervalRef.current) {
        clearInterval(chatAudioProgressIntervalRef.current);
        chatAudioProgressIntervalRef.current = null;
      }
      setPlayingAudioId(null);
      currentAudioRef.current = null;
    };

    audio.play().then(() => {
      startChatAudioProgressTracking();
    }).catch(() => {
      setPlayingAudioId(null);
      currentAudioRef.current = null;
    });
  };

  const handleSeekAudioMessage = (msgId: string, e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const prog = audioProgress[msgId];
    if (!prog) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = ratio * (prog.duration || 1);

    if (currentAudioRef.current && playingAudioId === msgId) {
      currentAudioRef.current.currentTime = targetTime;
      setAudioProgress((prev) => ({
        ...prev,
        [msgId]: { ...prev[msgId], current: targetTime },
      }));
    }
  };

  // -------------------------------------------------------------
  // 10. Photo Crop & Fit Handler
  // -------------------------------------------------------------
  const handleAvatarFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, WEBP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setRawImageFor1x1(dataUrl);
        setZoom1x1(1);
        setPanOffset({ x: 0, y: 0 });
        setIs1x1ModalOpen(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      isDraggingCropRef.current = true;
      dragStartRef.current = {
        x: e.touches[0].clientX - panOffset.x,
        y: e.touches[0].clientY - panOffset.y,
      };
      touchPinchDistRef.current = null;
    } else if (e.touches.length === 2) {
      isDraggingCropRef.current = false;
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchPinchDistRef.current = d;
      initialZoomRef.current = zoom1x1;
    }
  };

  const handleCropTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && touchPinchDistRef.current) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = d / touchPinchDistRef.current;
      const newZoom = Math.max(1, Math.min(3.5, initialZoomRef.current * ratio));
      setZoom1x1(newZoom);
    } else if (e.touches.length === 1 && isDraggingCropRef.current) {
      setPanOffset({
        x: e.touches[0].clientX - dragStartRef.current.x,
        y: e.touches[0].clientY - dragStartRef.current.y,
      });
    }
  };

  const handleCropTouchEnd = () => {
    isDraggingCropRef.current = false;
    touchPinchDistRef.current = null;
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingCropRef.current = true;
    dragStartRef.current = {
      x: e.clientX - panOffset.x,
      y: e.clientY - panOffset.y,
    };
  };

  const handleCropMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingCropRef.current) {
      setPanOffset({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    }
  };

  const handleCropMouseUp = () => {
    isDraggingCropRef.current = false;
  };

  const handleCropWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setZoom1x1((prev) => {
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      return Math.max(1, Math.min(3.5, prev + delta));
    });
  };

  const handleDeleteProfilePhoto = async () => {
    if (!user) return;
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { avatar: '' },
        { merge: true }
      );
      const cleanUsername = normalizeUsername(myHandle);
      if (cleanUsername) {
        try {
          await setDoc(
            doc(db, 'usernames', cleanUsername),
            { avatar: '' },
            { merge: true }
          );
        } catch {}
      }
      await updateUserProfile({ avatar: '' });
      try {
        const raw = localStorage.getItem('nochaf_persistent_saved_profile');
        const prev = raw ? JSON.parse(raw) : {};
        localStorage.setItem('nochaf_persistent_saved_profile', JSON.stringify({ ...prev, avatar: '' }));
      } catch {}
      setIsMyProfileModalOpen(false);
    } catch (err) {
      console.error('Failed to delete profile photo:', err);
    }
  };

  const handleSave1x1CroppedPhoto = async () => {
    if (!rawImageFor1x1 || !user) return;
    setUploadingAvatar(true);

    try {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const targetDim = 400; // Perfect 1x1 square
        canvas.width = targetDim;
        canvas.height = targetDim;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setUploadingAvatar(false);
          return;
        }

        const imgWidth = img.width;
        const imgHeight = img.height;
        // Calculate centered 1x1 aspect fill
        const baseScale = Math.max(targetDim / imgWidth, targetDim / imgHeight);
        const finalScale = baseScale * zoom1x1;
        const drawW = imgWidth * finalScale;
        const drawH = imgHeight * finalScale;
        const scaleRatio = targetDim / 240;
        const dx = (targetDim - drawW) / 2 + (panOffset.x * scaleRatio);
        const dy = (targetDim - drawH) / 2 + (panOffset.y * scaleRatio);

        ctx.fillStyle = '#0a0a0d';
        ctx.fillRect(0, 0, targetDim, targetDim);
        ctx.drawImage(img, dx, dy, drawW, drawH);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.88);

        // Update user profile in Firestore
        await setDoc(
          doc(db, 'users', user.uid),
          { avatar: compressedDataUrl },
          { merge: true }
        );

        // Update username registry if present
        const cleanUsername = normalizeUsername(myHandle);
        if (cleanUsername) {
          try {
            await setDoc(
              doc(db, 'usernames', cleanUsername),
              { avatar: compressedDataUrl },
              { merge: true }
            );
          } catch {}
        }

        // Update local profile state
        await updateUserProfile({ avatar: compressedDataUrl });
        try {
          const raw = localStorage.getItem('nochaf_persistent_saved_profile');
          const prev = raw ? JSON.parse(raw) : {};
          localStorage.setItem(
            'nochaf_persistent_saved_profile',
            JSON.stringify({ ...prev, avatar: compressedDataUrl, displayName: myName, handle: myHandle })
          );
        } catch {}

        setAvatarSuccessToast(true);
        setTimeout(() => setAvatarSuccessToast(false), 2500);
        setIs1x1ModalOpen(false);
        setRawImageFor1x1(null);
        setUploadingAvatar(false);
      };
      img.src = rawImageFor1x1;
    } catch (err) {
      console.error('Failed to process 1x1 photo:', err);
      setUploadingAvatar(false);
    }
  };

  // -------------------------------------------------------------
  // 11. Save Updated Display Name (visible to everyone)
  // -------------------------------------------------------------
  const handleSaveDisplayName = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanName = nameEditValue.replace(/^@+/, '').trim();
    if (!cleanName || !user || cleanName.length < 1) return;

    setSavingName(true);
    try {
      // 1. Update user document
      await setDoc(
        doc(db, 'users', user.uid),
        { displayName: cleanName },
        { merge: true }
      );

      // 2. Update usernames document
      const cleanUsername = normalizeUsername(myHandle);
      if (cleanUsername) {
        try {
          await setDoc(
            doc(db, 'usernames', cleanUsername),
            { displayName: cleanName },
            { merge: true }
          );
        } catch {}
      }

      // 3. Update AuthContext & persistent local storage
      await updateUserProfile({ displayName: cleanName });
      try {
        const raw = localStorage.getItem('nochaf_persistent_saved_profile');
        const prev = raw ? JSON.parse(raw) : {};
        localStorage.setItem('nochaf_persistent_saved_profile', JSON.stringify({ ...prev, displayName: cleanName }));
      } catch {}

      setNameSaveSuccess(true);
      setIsEditingName(false);
      setTimeout(() => setNameSaveSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to update name:', err);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col bg-[#0a0a0d] text-neutral-100 overflow-hidden select-text relative">
      {/* Hidden file input for changing profile picture */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarFileSelected}
        className="hidden"
      />

      {/* Hidden file inputs for chat media and songs */}
      <input
        ref={chatMediaInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={handleChatMediaSelected}
        className="hidden"
      />
      {/* Copy Toast Notification with visible text preview during process */}
      {copiedTextNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%] rounded-2xl bg-neutral-900/95 border border-white/20 p-3 shadow-2xl text-xs text-white backdrop-blur-md animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold mb-1">
            <Check className="h-3.5 w-3.5 stroke-[3]" />
            <span>Copied to clipboard</span>
          </div>
          <p className="text-[11px] text-neutral-200 line-clamp-3 italic bg-black/60 p-2 rounded-xl border border-white/10 font-mono select-text">
            "{copiedTextNotice}"
          </p>
        </div>
      )}

      {/* Avatar Success Toast */}
      {avatarSuccessToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-emerald-500/90 text-white px-4 py-2 text-xs font-semibold shadow-2xl animate-in fade-in slide-in-from-top-2 flex items-center gap-2">
          <Check className="h-4 w-4 text-white stroke-[3]" />
          <span>Profile photo updated successfully!</span>
        </div>
      )}

      {/* Spam or Mute Notice Pop-up with (×) to cancel */}
      {spamNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[92%] rounded-2xl bg-[#1c1414] border border-red-500/40 p-3 shadow-2xl text-xs text-red-200 backdrop-blur-md animate-in fade-in slide-in-from-top-2 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-white">Notice</p>
              <p className="text-[11px] leading-relaxed text-red-200">{spamNotice}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSpamNotice(null)}
            className="p-1 rounded-lg text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Dismiss (×)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Persistent Muted User Banner with Appeal Button */}
      {profile?.isMuted && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between text-xs text-amber-200 z-20">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-[11px]">
              {profile.muteReason || 'Account temporarily muted due to promotional link frequency.'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleAppealSpam}
            disabled={appealSubmitting || profile.hasPendingAppeal}
            className="px-3 py-1 rounded-lg bg-amber-400 text-black font-semibold text-xs hover:bg-amber-300 disabled:opacity-50 transition-colors cursor-pointer shrink-0 ml-3"
          >
            {profile.hasPendingAppeal ? 'Appeal Pending Review' : "I'm not spam (Appeal)"}
          </button>
        </div>
      )}

      {/* Appeal Success Toast */}
      {appealSuccessMsg && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-emerald-600/90 text-white px-4 py-2 text-xs font-semibold shadow-2xl animate-in fade-in slide-in-from-top-2 flex items-center gap-2">
          <Check className="h-4 w-4 text-white stroke-[3]" />
          <span>{appealSuccessMsg}</span>
        </div>
      )}

      {/* Report Success Toast */}
      {reportSuccessMsg && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-neutral-900 border border-white/20 text-white px-4 py-2 text-xs font-semibold shadow-2xl animate-in fade-in slide-in-from-top-2 flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-400 stroke-[3]" />
          <span>{reportSuccessMsg}</span>
        </div>
      )}

      {/* ========================================================= */}
      {/* VIEW A: PERSONAL CHAT PAGE (When talking to a specific user) */}
      {/* ========================================================= */}
      {activeChat ? (
        <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden bg-[#0c0c10]">
          {/* SELECTION ACTION BAR (Appears when messages are held/selected) */}
          {selectedMessageIds.length > 0 ? (
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-[#16161e] border-b border-white/20 text-white shrink-0 z-30 animate-in fade-in duration-150">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMessageIds([]);
                    setActiveOptionsMsg(null);
                    setShowMsgDeletePrompt(false);
                    setIsBatchDeleteModalOpen(false);
                  }}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer transition-colors"
                  title="Cancel selection"
                >
                  <X className="h-5 w-5" />
                </button>
                <span className="font-semibold text-xs sm:text-sm">
                  {selectedMessageIds.length} selected
                </span>
                {/* SELECT ALL BUTTON (Appears after selecting two messages) */}
                {selectedMessageIds.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedMessageIds.length === visibleMessages.length) {
                        setSelectedMessageIds([]);
                      } else {
                        setSelectedMessageIds(visibleMessages.map((m) => m.id));
                      }
                    }}
                    className="px-2.5 py-1 text-xs font-semibold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-400/40 rounded-lg cursor-pointer transition-all active:scale-95 flex items-center gap-1.5 ml-2"
                    title="Select all messages"
                  >
                    <span>{selectedMessageIds.length === visibleMessages.length ? 'Deselect all' : 'Select all'}</span>
                  </button>
                )}
              </div>

              {/* Show Copy & Delete ONLY when user selects more (tap another text, > 1) */}
              {selectedMessageIds.length > 1 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCopySelectedMessages}
                    className="p-1 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                    title="Copy"
                  >
                    <Copy className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsBatchDeleteModalOpen(true)}
                    className="p-1 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-neutral-400" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Standard Personal Chat Header */
            <div className="relative z-40 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 bg-[#0e0e14]/95 backdrop-blur-md shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveChat(null);
                    setReplyingTo(null);
                    setSelectedMessageIds([]);
                  }}
                  className="flex items-center gap-1.5 p-1.5 -ml-1 text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800 transition-colors cursor-pointer"
                  title="Back to all conversations"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>

                {/* Recipient Profile Picture: Tap to view full profile (Clean, no green or grey border) */}
                <div
                  onClick={() =>
                    setViewingUserProfile({
                      name: activeChat.otherName,
                      handle: activeChat.otherHandle,
                      avatar: activeChat.otherAvatar,
                      uid: activeChat.otherUid,
                    })
                  }
                  className="relative shrink-0 cursor-pointer group"
                  title="Tap to view full profile"
                >
                  {activeChat.otherAvatar ? (
                    <img
                      src={activeChat.otherAvatar}
                      alt={activeChat.otherName}
                      className="h-10 w-10 rounded-full object-cover shadow-sm group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-300 shadow-sm group-hover:scale-105 transition-transform">
                      <UserIcon className="h-5 w-5 text-neutral-300" />
                    </div>
                  )}
                  {/* Status dot on profile picture: green when online, greyish when offline */}
                  <span
                    className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-[#0e0e14] transition-all ${
                      activeChatUserOnline || onlineContactsMap[activeChat.otherUid]
                        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.95)]'
                        : 'bg-neutral-500'
                    }`}
                  />
                </div>

                {/* Recipient Name and @username: Tap to view full profile */}
                <div
                  onClick={() =>
                    setViewingUserProfile({
                      name: activeChat.otherName,
                      handle: activeChat.otherHandle,
                      avatar: activeChat.otherAvatar,
                      uid: activeChat.otherUid,
                    })
                  }
                  className="min-w-0 flex flex-col cursor-pointer group"
                  title="Tap to view full profile"
                >
                  <span className="font-bold text-sm text-white truncate leading-tight group-hover:text-emerald-300 transition-colors">
                    {activeChat.otherName}
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono truncate">
                    {isOtherTyping ? (
                      <span className="text-emerald-400 font-semibold animate-pulse">typing...</span>
                    ) : (activeChatUserOnline || activeChatUserStatus.online) ? (
                      <span className="text-emerald-400 font-medium">online</span>
                    ) : activeChatUserStatus.lastSeen ? (
                      <span className="text-neutral-400">last seen {formatLastSeen(activeChatUserStatus.lastSeen)}</span>
                    ) : (
                      <span className="text-neutral-400">@{activeChat.otherHandle}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Conversation Top Right Corner: Three Dots (•••) */}
              <div className="relative z-50 shrink-0 flex items-center gap-1.5">
                {/* Heart icon if account is added to favourites */}
                {favouriteUserIds.includes(activeChat.otherUid) && (
                  <span title="Favourite account" className="flex items-center">
                    <Heart className="h-4 w-4 text-rose-500 fill-rose-500 shrink-0" />
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setShowConvMenu(!showConvMenu)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-neutral-300 hover:text-white rounded-xl hover:bg-neutral-800/80 active:scale-95 transition-all cursor-pointer shadow-sm relative z-50"
                  title="Options"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>

                {showConvMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-[95] bg-transparent"
                      onClick={() => setShowConvMenu(false)}
                    />
                    <div
                      ref={convMenuRef}
                      className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl bg-[#161622] border border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.85)] p-1.5 z-[100] animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl flex flex-col"
                    >
                    {/* 1. block this account - normal white font no border */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowConvMenu(false);
                        handleBlockAccount(activeChat);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-white font-normal text-xs hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      {blockedUsers.some((b) => b.uid === activeChat.otherUid)
                        ? 'unblock this account'
                        : 'block this account'}
                    </button>

                    {/* 2. report */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowConvMenu(false);
                        handleReportUser(activeChat.otherUid, activeChat.otherHandle);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-white font-normal text-xs hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      report
                    </button>

                    {/* 3. add to favourite */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowConvMenu(false);
                        handleToggleFavourite(activeChat.otherUid, activeChat.otherHandle);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-white font-normal text-xs hover:bg-white/10 transition-colors cursor-pointer flex items-center justify-between"
                    >
                      <span>
                        {favouriteUserIds.includes(activeChat.otherUid)
                          ? 'remove from favourite'
                          : 'add to favourite'}
                      </span>
                      {favouriteUserIds.includes(activeChat.otherUid) && (
                        <Heart className="h-3 w-3 text-rose-500 fill-rose-500" />
                      )}
                    </button>

                    {/* 4. share account */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowConvMenu(false);
                        setShowShareAccountModal(true);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-white font-normal text-xs hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      share account
                    </button>

                    {/* 5. mute account */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowConvMenu(false);
                        setShowMuteModal(true);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-white font-normal text-xs hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      mute account
                    </button>

                    {/* 6. Sign Out option */}
                    {user && (
                      <button
                        type="button"
                        onClick={async () => {
                          setShowConvMenu(false);
                          setActiveChat(null);
                          await signOut();
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl text-red-400 font-normal text-xs hover:bg-red-500/10 transition-colors cursor-pointer border-t border-white/10 mt-1 flex items-center gap-2"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        <span>Sign Out</span>
                      </button>
                    )}
                  </div>
                </>
              )}
              </div>
            </div>
          )}

          {/* Blocked Account Top Notification Bar */}
          {activeChat && blockedUsers.some((b) => b.uid === activeChat.otherUid) && (
            <div className="bg-neutral-900 border-b border-white/10 px-4 py-2 flex items-center justify-between text-xs text-neutral-300 shrink-0">
              <span>You have blocked this account.</span>
              <button
                type="button"
                onClick={() => handleUnblockAccount(activeChat.otherUid)}
                className="text-white underline font-semibold hover:text-neutral-200 cursor-pointer"
              >
                Unblock
              </button>
            </div>
          )}

          {/* Messages Stream — WhatsApp compact spacing */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-2">
            {visibleMessages.length === 0 && !activeChat.lastMessage ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-400">
                <div
                  onClick={() =>
                    setViewingUserProfile({
                      name: activeChat.otherName,
                      handle: activeChat.otherHandle,
                      avatar: activeChat.otherAvatar,
                      uid: activeChat.otherUid,
                    })
                  }
                  className="h-16 w-16 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-white text-2xl mb-3 shadow-inner cursor-pointer hover:scale-105 transition-transform"
                  title="Tap to view full profile"
                >
                  {activeChat.otherAvatar ? (
                    <img
                      src={activeChat.otherAvatar}
                      alt={activeChat.otherName}
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    <UserIcon className="h-8 w-8 text-neutral-300" />
                  )}
                </div>
                <h4 className="text-base font-bold text-white mb-1">
                  Start talking to {activeChat.otherName}
                </h4>
                <p className="text-xs text-neutral-400 max-w-sm mb-3">
                  You are directly connected with <span className="text-white font-mono">@{activeChat.otherHandle}</span>. Send your first message below!
                </p>
                <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-neutral-900 border border-white/10 text-neutral-500">
                  Encrypted & private peer-to-peer thread
                </span>
              </div>
            ) : (
              visibleMessages.map((m, idx) => {
                const isMe = m.senderId === user?.uid;
                const isSelected = selectedMessageIds.includes(m.id);
                const isDragged = dragMsgId === m.id;

                return (
                  <div
                    key={m.id}
                    className={`relative flex items-end gap-2.5 select-none ${
                      isMe ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {!isMe && (
                      <div
                        onClick={() =>
                          setViewingUserProfile({
                            name: activeChat.otherName,
                            handle: activeChat.otherHandle,
                            avatar: activeChat.otherAvatar,
                            uid: activeChat.otherUid,
                          })
                        }
                        className="shrink-0 mb-1 cursor-pointer hover:scale-105 transition-transform"
                        title="View profile"
                      >
                        {activeChat.otherAvatar ? (
                          <img
                            src={activeChat.otherAvatar}
                            alt=""
                            className="h-7 w-7 rounded-full object-cover border border-white/15"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-neutral-800 border border-white/15 flex items-center justify-center text-neutral-300">
                            <UserIcon className="h-4 w-4 text-neutral-300" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Drag-to-Reply Container */}
                    <div
                      className="relative max-w-[78%] sm:max-w-[65%]"
                      style={{
                        transform: isDragged ? `translateX(${dragOffset}px)` : 'translateX(0)',
                        transition: isDragged ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)',
                      }}
                      onClick={(e) => {
                        if (isMsgLongPressRef.current) {
                          isMsgLongPressRef.current = false;
                          return;
                        }
                        if (selectedMessageIds.length > 0) {
                          e.stopPropagation();
                          toggleSelectMessage(m.id);
                        }
                      }}
                      onTouchStart={(e) => {
                        handleMsgPressStart(m, e);
                        handleTouchDragStart(m, e);
                      }}
                      onTouchMove={(e) => {
                        handleMsgPressMove(e);
                        handleTouchDragMove(m, e);
                      }}
                      onTouchEnd={() => {
                        handleMsgPressEnd();
                        handleTouchDragEnd(m);
                      }}
                      onMouseDown={(e) => {
                        handleMsgPressStart(m, e);
                        handleMouseDragStart(m, e);
                      }}
                      onMouseMove={(e) => {
                        handleMsgPressMove(e);
                        handleMouseDragMove(m, e);
                      }}
                      onMouseUp={() => {
                        handleMsgPressEnd();
                        handleMouseDragEnd(m);
                      }}
                    >
                      {/* Drag Reply Icon behind on left */}
                      <div
                        className="absolute left-0 -translate-x-full top-1/2 -translate-y-1/2 pr-3 flex items-center justify-center pointer-events-none transition-opacity"
                        style={{
                          opacity: isDragged ? Math.min(dragOffset / 45, 1) : 0,
                          transform: `scale(${isDragged ? Math.min(dragOffset / 45, 1) : 0.6})`,
                        }}
                      >
                        <div className="h-7 w-7 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-400 shadow-lg">
                          <Reply className="h-3.5 w-3.5" />
                        </div>
                      </div>

                      {/* Floating Message Options Menu — floats over everything via createPortal next to selected text */}
                      {activeOptionsMsg?.id === m.id && msgOptionsCoords && createPortal(
                        <>
                          {/* Dismiss overlay outside popover */}
                          <div
                            className="fixed inset-0 z-[99998] bg-black/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveOptionsMsg(null);
                              setMsgOptionsCoords(null);
                              setShowMsgDeletePrompt(false);
                              setShowAllEmojis(false);
                              setSelectedMessageIds([]);
                            }}
                          />
                          <div
                            style={{
                              top: `${msgOptionsCoords.top}px`,
                              ...(msgOptionsCoords.left !== undefined ? { left: `${msgOptionsCoords.left}px` } : {}),
                              ...(msgOptionsCoords.right !== undefined ? { right: `${msgOptionsCoords.right}px` } : {}),
                            }}
                            className="fixed z-[99999] max-w-[calc(100vw-24px)] animate-in zoom-in-95 duration-150 drop-shadow-[0_20px_50px_rgba(0,0,0,0.9)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!showMsgDeletePrompt ? (
                              <div className="flex flex-col gap-1.5 p-1.5 bg-[#181822] border border-white/20 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.85)] backdrop-blur-xl">
                                {/* Emojis reaction bar: show 3 emojis first, tap plus to reveal rest 4 */}
                                <div className="flex items-center gap-1.5 px-2 py-1 bg-black/60 rounded-xl border border-white/10">
                                  {(showAllEmojis
                                    ? ['♥️', '😂', '👍', '🥹', '🤪', '🔥', '🙏']
                                    : ['♥️', '😂', '👍']
                                  ).map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReactToMessage(m, emoji);
                                        setMsgOptionsCoords(null);
                                      }}
                                      className="p-1 text-2xl hover:scale-130 active:scale-95 transition-transform cursor-pointer select-none"
                                      title={`React with ${emoji}`}
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                  {!showAllEmojis && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowAllEmojis(true);
                                      }}
                                      className="p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer select-none shrink-0"
                                      title="More reactions"
                                    >
                                      <Plus className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>

                                {/* Action buttons: Copy & small grey Delete icon with no border, no red color, no text */}
                                <div className="flex items-center justify-between gap-1.5 pt-0.5 px-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleCopySingleMessage(m);
                                      setMsgOptionsCoords(null);
                                    }}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs text-neutral-200 hover:text-white transition-colors cursor-pointer"
                                    title="Copy"
                                  >
                                    <Copy className="h-3 w-3" />
                                    <span>Copy</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setShowMsgDeletePrompt(true)}
                                    className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-white/5 transition-colors cursor-pointer"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-neutral-400" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              /* Delete Choice Menu: Delete for me / (Delete for everyone if sender is me) / Cancel */
                              <div className="flex flex-col gap-1 p-2 bg-[#181822] border border-white/20 rounded-2xl shadow-2xl min-w-[190px]">
                                {isMe && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleDeleteMessageForEveryone(m);
                                      setMsgOptionsCoords(null);
                                    }}
                                    className="w-full text-left px-3 py-2 rounded-xl text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors font-medium cursor-pointer"
                                  >
                                    Delete for everyone
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleDeleteMessageForMe(m);
                                    setMsgOptionsCoords(null);
                                  }}
                                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors font-medium cursor-pointer"
                                >
                                  Delete for me
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowMsgDeletePrompt(false)}
                                  className="w-full text-left px-3 py-1.5 rounded-xl text-xs text-neutral-400 hover:bg-white/5 hover:text-white transition-colors cursor-pointer border-t border-white/10 mt-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>
                        </>,
                        document.body
                      )}

                      {/* Message Bubble - WhatsApp-compact styling with reduced border space */}
                      <div
                        className={`rounded-xl px-2.5 py-1 text-xs sm:text-[13px] leading-relaxed break-words shadow-sm transition-all cursor-pointer ${
                          isSelected
                            ? 'border-2 border-emerald-500 ring-2 ring-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                            : isMe
                            ? 'border border-transparent'
                            : 'border border-white/10'
                        } ${
                          isMe
                            ? 'bg-white text-black font-normal rounded-br-sm'
                            : 'bg-neutral-900 text-neutral-100 rounded-bl-sm'
                        }`}
                      >
                        {/* Quote reply block */}
                        {m.replyTo && (
                          <div
                            className={`mb-1.5 rounded-lg border-l-2 border-emerald-400 px-2 py-0.5 text-[11px] leading-tight ${
                              isMe
                                ? 'bg-neutral-200/90 text-neutral-800'
                                : 'bg-neutral-950/80 text-neutral-300'
                            }`}
                          >
                            <span className="font-bold text-emerald-500 block text-[10px] truncate">
                              {m.replyTo.senderName}
                            </span>
                            <p className="truncate opacity-80 mt-0.5 text-[10.5px]">
                              {m.replyTo.content}
                            </p>
                          </div>
                        )}

                        {/* Media: Image, Video, or Audio */}
                        {m.mediaType === 'image' && (m.mediaUrl || (m.mediaUrls && m.mediaUrls.length > 0)) && (() => {
                          const photoList = m.mediaUrls && m.mediaUrls.length > 0 ? m.mediaUrls : [m.mediaUrl!];
                          const count = photoList.length;

                          return (
                            <div className="mb-1 select-none">
                              {count === 1 ? (
                                <div className="relative rounded-xl overflow-hidden border-0 p-0 max-w-[280px] sm:max-w-[320px] group">
                                  <img
                                    src={photoList[0]}
                                    alt=""
                                    loading="lazy"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFullscreenMediaUrl(photoList[0]);
                                      setFullscreenMediaType('image');
                                    }}
                                    className="w-full max-h-64 object-cover rounded-xl cursor-pointer hover:opacity-95 transition-all"
                                  />
                                  {/* WhatsApp-style subtle blur and (∆) view badge: appears ONLY for recipient (!isMe) */}
                                  {!isMe && (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFullscreenMediaUrl(photoList[0]);
                                        setFullscreenMediaType('image');
                                      }}
                                      className="absolute inset-0 flex items-center justify-center bg-black/15 backdrop-blur-[1.5px] cursor-pointer hover:bg-black/10 transition-colors"
                                    >
                                      <div className="h-10 w-10 rounded-full bg-black/60 border border-white/20 backdrop-blur-md flex items-center justify-center text-white shadow-xl hover:scale-105 transition-transform">
                                        <span className="text-sm font-black ml-0.5 select-none font-mono">∆</span>
                                      </div>
                                    </div>
                                  )}
                                  {/* Direct Save to Gallery download button: appears ONLY for recipient (!isMe) */}
                                  {!isMe && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        saveMediaToGallery(photoList[0], 'photo');
                                      }}
                                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white/90 hover:text-white transition-all cursor-pointer backdrop-blur-md z-10 shadow"
                                      title="Save to Gallery"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              ) : count === 2 ? (
                                <div className="space-y-1">
                                  <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden border-0 p-0 max-w-[280px] sm:max-w-[320px]">
                                    {photoList.map((pUrl, idx) => (
                                      <div key={idx} className="relative h-32 overflow-hidden rounded-lg group">
                                        <img
                                          src={pUrl}
                                          alt=""
                                          loading="lazy"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setFullscreenMediaUrl(pUrl);
                                            setFullscreenMediaType('image');
                                          }}
                                          className="w-full h-full object-cover cursor-pointer"
                                        />
                                        {!isMe && (
                                          <div
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setFullscreenMediaUrl(pUrl);
                                              setFullscreenMediaType('image');
                                            }}
                                            className="absolute inset-0 flex items-center justify-center bg-black/15 backdrop-blur-[1.5px] cursor-pointer"
                                          >
                                            <div className="h-8 w-8 rounded-full bg-black/60 border border-white/20 backdrop-blur-md flex items-center justify-center text-white shadow">
                                              <span className="text-xs font-black ml-0.5 font-mono">∆</span>
                                            </div>
                                          </div>
                                        )}
                                        {!isMe && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              saveMediaToGallery(pUrl, `photo_${idx + 1}`);
                                            }}
                                            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 hover:bg-black/80 text-white z-10"
                                            title="Save to Gallery"
                                          >
                                            <Download className="h-3 w-3" />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="text-[10px] text-neutral-400 font-medium px-1 flex items-center gap-1 select-none">
                                    <span>📷</span>
                                    <span>2 photos</span>
                                  </div>
                                </div>
                              ) : count === 3 ? (
                                <div className="space-y-1">
                                  <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden border-0 p-0 max-w-[280px] sm:max-w-[320px]">
                                    <div className="col-span-2 relative h-36 overflow-hidden rounded-lg">
                                      <img
                                        src={photoList[0]}
                                        alt=""
                                        loading="lazy"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setFullscreenMediaUrl(photoList[0]);
                                          setFullscreenMediaType('image');
                                        }}
                                        className="w-full h-full object-cover cursor-pointer"
                                      />
                                      {!isMe && (
                                        <div
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setFullscreenMediaUrl(photoList[0]);
                                            setFullscreenMediaType('image');
                                          }}
                                          className="absolute inset-0 flex items-center justify-center bg-black/15 backdrop-blur-[1.5px] cursor-pointer"
                                        >
                                          <div className="h-9 w-9 rounded-full bg-black/60 border border-white/20 backdrop-blur-md flex items-center justify-center text-white shadow">
                                            <span className="text-xs font-black ml-0.5 font-mono">∆</span>
                                          </div>
                                        </div>
                                      )}
                                      {!isMe && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            saveMediaToGallery(photoList[0], 'photo_1');
                                          }}
                                          className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 hover:bg-black/80 text-white z-10"
                                          title="Save to Gallery"
                                        >
                                          <Download className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                    {photoList.slice(1, 3).map((pUrl, idx) => (
                                      <div key={idx} className="relative h-24 overflow-hidden rounded-lg">
                                        <img
                                          src={pUrl}
                                          alt=""
                                          loading="lazy"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setFullscreenMediaUrl(pUrl);
                                            setFullscreenMediaType('image');
                                          }}
                                          className="w-full h-full object-cover cursor-pointer"
                                        />
                                        {!isMe && (
                                          <div
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setFullscreenMediaUrl(pUrl);
                                              setFullscreenMediaType('image');
                                            }}
                                            className="absolute inset-0 flex items-center justify-center bg-black/15 backdrop-blur-[1.5px] cursor-pointer"
                                          >
                                            <div className="h-8 w-8 rounded-full bg-black/60 border border-white/20 backdrop-blur-md flex items-center justify-center text-white shadow">
                                              <span className="text-xs font-black ml-0.5 font-mono">∆</span>
                                            </div>
                                          </div>
                                        )}
                                        {!isMe && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              saveMediaToGallery(pUrl, `photo_${idx + 2}`);
                                            }}
                                            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 hover:bg-black/80 text-white z-10"
                                            title="Save to Gallery"
                                          >
                                            <Download className="h-3 w-3" />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="text-[10px] text-neutral-400 font-medium px-1 flex items-center gap-1 select-none">
                                    <span>📷</span>
                                    <span>3 photos</span>
                                  </div>
                                </div>
                              ) : (
                                /* If more than 3 photos: WhatsApp-style 2x2 grid with count below */
                                <div className="space-y-1">
                                  <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden border-0 p-0 max-w-[280px] sm:max-w-[320px]">
                                    {photoList.slice(0, 4).map((pUrl, idx) => {
                                      const isFourth = idx === 3;
                                      const remaining = count - 3;
                                      return (
                                        <div key={idx} className="relative h-28 overflow-hidden rounded-lg">
                                          <img
                                            src={pUrl}
                                            alt=""
                                            loading="lazy"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setFullscreenMediaUrl(pUrl);
                                              setFullscreenMediaType('image');
                                            }}
                                            className="w-full h-full object-cover cursor-pointer"
                                          />
                                          {!isMe && (
                                            <div
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setFullscreenMediaUrl(pUrl);
                                                setFullscreenMediaType('image');
                                              }}
                                              className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1.5px] cursor-pointer"
                                            >
                                              {isFourth && remaining > 1 ? (
                                                <div className="h-10 w-10 rounded-full bg-black/75 border border-white/30 flex items-center justify-center text-white font-bold text-sm shadow-xl">
                                                  +{remaining}
                                                </div>
                                              ) : (
                                                <div className="h-8 w-8 rounded-full bg-black/60 border border-white/20 backdrop-blur-md flex items-center justify-center text-white shadow">
                                                  <span className="text-xs font-black ml-0.5 font-mono">∆</span>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                          {!isMe && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                saveMediaToGallery(pUrl, `photo_${idx + 1}`);
                                              }}
                                              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 hover:bg-black/80 text-white z-10"
                                              title="Save to Gallery"
                                            >
                                              <Download className="h-3 w-3" />
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {/* Below them: show the number of photos */}
                                  <div className="text-[10px] text-neutral-300 font-semibold px-1 flex items-center justify-between select-none">
                                    <span className="flex items-center gap-1">
                                      <span>📷</span>
                                      <span>{count} photos</span>
                                    </span>
                                    {!isMe && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          photoList.forEach((p, i) => setTimeout(() => saveMediaToGallery(p, `photo_${i + 1}`), i * 300));
                                        }}
                                        className="text-[9.5px] text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                                      >
                                        Save all to gallery
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Video: borderless, fast load, blurred preview with (∆) play glyph, and Save to Gallery */}
                        {m.mediaType === 'video' && m.mediaUrl && (
                          <div className="mb-1 rounded-xl overflow-hidden border-0 p-0 bg-black max-w-[280px] sm:max-w-[320px] relative group select-none">
                            <video
                              controls
                              playsInline
                              preload="metadata"
                              muted={m.isMuted}
                              src={m.mediaUrl}
                              className="max-h-64 w-full rounded-xl bg-black object-cover"
                            />
                            {/* Direct Save to Gallery button appears ONLY for recipient (!isMe) */}
                            {!isMe && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveMediaToGallery(m.mediaUrl!, 'video');
                                }}
                                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all cursor-pointer backdrop-blur-md z-10 shadow"
                                title="Save to Gallery"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {m.isMuted && (
                              <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[10px] text-neutral-300 flex items-center gap-1 pointer-events-none">
                                <VolumeX className="h-3 w-3 text-neutral-400" />
                                <span>Muted</span>
                              </div>
                            )}
                          </div>
                        )}

                        {m.mediaType === 'audio' && m.mediaUrl && (
                          <div className="mb-1 p-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center gap-2.5 min-w-[220px] sm:min-w-[260px]">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                playAudioMessage(m.id, m.mediaUrl!);
                              }}
                              className={`h-9 w-9 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-105 shrink-0 shadow-md ${
                                isMe ? 'bg-black text-white hover:bg-neutral-900' : 'bg-white text-black hover:bg-neutral-200'
                              }`}
                              title={playingAudioId === m.id ? 'Pause' : 'Listen'}
                            >
                              {playingAudioId === m.id ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4 ml-0.5" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold truncate block text-white">
                                  {m.isVoiceNote ? 'Voice note' : (m.mediaName || 'Audio')}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {/* Speed regulation button (1x, 1.5x, 2x) */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cycleAudioPlaybackSpeed();
                                    }}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-white/10 hover:bg-white/20 text-white/90 border border-white/15 transition-colors cursor-pointer"
                                    title="Regulate playback speed (1x, 1.5x, 2x)"
                                  >
                                    {audioPlaybackSpeed}x
                                  </button>
                                  <span className="text-[10px] opacity-80 font-mono text-neutral-300">
                                    {playingAudioId === m.id && audioProgress[m.id]
                                      ? `${Math.floor(audioProgress[m.id].current / 60)}:${Math.floor(audioProgress[m.id].current % 60).toString().padStart(2, '0')}`
                                      : (m.durationText || (m.duration ? `${Math.floor(m.duration / 60)}:${(m.duration % 60).toString().padStart(2, '0')}` : '0:00'))}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {m.content && (
                          <p
                            className={`whitespace-pre-wrap select-text ${
                              isSingleEmoji(m.content)
                                ? 'text-2xl sm:text-[28px] py-0.5 px-0.5 leading-none'
                                : ''
                            }`}
                          >
                            {m.content}
                          </p>
                        )}

                        {/* Timestamp & Delivery Ticks */}
                        <div
                          className={`mt-1 flex items-center justify-end gap-1.5 text-[9.5px] font-mono select-none ${
                            isMe ? 'text-neutral-500' : 'text-neutral-400'
                          }`}
                        >
                          <span>
                            {(() => {
                              if (typeof m.timestamp === 'string') return m.timestamp;
                              if (m.timestamp?.toDate) {
                                try {
                                  return m.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                } catch {}
                              }
                              if (m.createdAt) {
                                try {
                                  return new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                } catch {}
                              }
                              return '';
                            })()}
                          </span>
                          {isMe && (
                            <div className="flex items-center ml-0.5">
                              {(() => {
                                if (m.isOfflinePending || m.status === 'offline') {
                                  return (
                                    <span
                                      title="No internet connection - will send when back online"
                                      className="text-neutral-400 flex items-center"
                                    >
                                      <WifiOff size={13} className="text-neutral-400" />
                                    </span>
                                  );
                                }

                                const currentStatus =
                                  m.status ||
                                  (blueTickedMsgIdsRef.current.has(m.id) ||
                                  (Array.isArray(m.readBy) && activeChat && m.readBy.includes(activeChat.otherUid))
                                    ? 'read'
                                    : 'sent');

                                if (currentStatus === 'read') {
                                  return (
                                    <span title="Read">
                                      <CheckCheck size={14} className="text-[#25D366]" />
                                    </span>
                                  );
                                }

                                if (currentStatus === 'delivered') {
                                  return (
                                    <span title="Delivered">
                                      <CheckCheck size={14} className="text-gray-400" />
                                    </span>
                                  );
                                }

                                return (
                                  <span title="Sent">
                                    <Check size={14} className="text-gray-400" />
                                  </span>
                                );
                              })()}
                            </div>
                          )}
                          {isSelected && (
                            <div className="ml-1 h-3.5 w-3.5 rounded-full bg-emerald-500 text-black flex items-center justify-center">
                              <Check className="h-2.5 w-2.5 stroke-[3]" />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Emoji Reactions displayed below message: tap twice to remove reaction */}
                      {m.reactions && Object.keys(m.reactions).length > 0 && (
                        <div className={`flex items-center mt-1 select-none ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReactionPillClick(m);
                            }}
                            className="inline-flex items-center gap-1.5 bg-[#181822] border border-white/20 rounded-full px-2.5 py-0.5 shadow-md cursor-pointer hover:bg-neutral-800 active:scale-95 transition-all"
                            title="Tap twice to remove your reaction"
                          >
                            {Object.entries(
                              Object.values(m.reactions).reduce((acc: Record<string, number>, em) => {
                                if (em) acc[em] = (acc[em] || 0) + 1;
                                return acc;
                              }, {})
                            ).map(([em, count]) => {
                              const isMyReaction = !!user?.uid && m.reactions?.[user.uid] === em;
                              return (
                                <button
                                  key={em}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReactionPillClick(m, em);
                                  }}
                                  className={`inline-flex items-center gap-0.5 text-xs rounded-full px-1 transition-all cursor-pointer ${
                                    isMyReaction ? 'bg-white/10 ring-1 ring-white/20' : ''
                                  }`}
                                  title={isMyReaction ? 'Tap twice to remove your reaction' : undefined}
                                >
                                  <span>{em}</span>
                                  {count > 1 && (
                                    <span className="text-[10px] text-neutral-400 font-mono font-medium">
                                      {count}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply Preview Bar above input */}
          {replyingTo && (
            <div className="flex items-center justify-between px-4 py-2 bg-[#121217] border-t border-white/10 text-xs shrink-0 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-6 w-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Reply className="h-3.5 w-3.5" />
                </div>
                <div className="border-l-2 border-emerald-400 pl-2 min-w-0">
                  <span className="font-semibold text-white block truncate text-[11px]">
                    Replying to {replyingTo.senderId === user?.uid ? 'yourself' : replyingTo.senderName}
                  </span>
                  <span className="text-neutral-400 block truncate text-[11px]">
                    {replyingTo.content}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer transition-colors"
                title="Cancel reply"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Chat Input Bar */}
          <form
            onSubmit={handleSendMessage}
            className="p-2 sm:p-3 border-t border-white/10 bg-[#0e0e14] shrink-0 relative"
          >
            {/* Attachment Drawer Menu when "^" is tapped */}
            {showAttachMenu && (
              <div className="absolute bottom-full left-3 mb-2 z-40 bg-[#161620] border border-white/20 rounded-2xl p-2 shadow-2xl flex flex-col gap-1 min-w-[200px] animate-in slide-in-from-bottom-2 duration-150 backdrop-blur-xl">
                {/* 1. Camera icon: pictures and videos */}
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachMenu(false);
                    chatMediaInputRef.current?.click();
                  }}
                  className="flex items-center gap-3 p-2 rounded-xl text-neutral-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-xs font-medium"
                >
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Camera className="h-4 w-4" />
                  </div>
                  <span>Photos & Videos</span>
                </button>

                {/* 2. Voice Note option: opens recorder with Start icon */}
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachMenu(false);
                    setShowVoiceRecorder(true);
                    setVoiceRecordStage('idle');
                    setRecordingSeconds(0);
                    setRecordedVoiceUrl(null);
                  }}
                  className="flex items-center gap-3 p-2 rounded-xl text-neutral-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-xs font-medium"
                >
                  <div className="h-8 w-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                    <Mic className="h-4 w-4" />
                  </div>
                  <span>Voice Note</span>
                </button>
              </div>
            )}

            {/* Input Row: Normal text input OR Voice Note Recorder Bar */}
            {showVoiceRecorder ? (
              <div className="flex items-center justify-between rounded-2xl border border-white/20 bg-neutral-950 px-3 py-2 shadow-lg animate-in fade-in gap-2">
                {/* Left side: Dynamic Start / Stop Record / Continue / Listen Controls */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {voiceRecordStage === 'recording' ? (
                    /* Stop button while recording */
                    <button
                      type="button"
                      onClick={handleStopVoiceRecording}
                      className="h-9 w-9 rounded-full flex items-center justify-center cursor-pointer transition-all shrink-0 shadow-md bg-red-500 text-white animate-pulse hover:bg-red-600 scale-105"
                      title="Tap to stop recording"
                    >
                      <StopCircle className="h-5 w-5 fill-current" />
                    </button>
                  ) : voiceRecordStage === 'recorded' ? (
                    /* Mic button to CONTINUE recording from where it left off */
                    <button
                      type="button"
                      onClick={() => handleStartVoiceRecording(true)}
                      className="h-9 w-9 rounded-full flex items-center justify-center cursor-pointer transition-all shrink-0 shadow-md bg-neutral-100 text-black hover:bg-white hover:scale-105"
                      title="Tap again to continue recording from where you left off"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                  ) : (
                    /* Initial mic button to start recording */
                    <button
                      type="button"
                      onClick={() => handleStartVoiceRecording(false)}
                      className="h-9 w-9 rounded-full flex items-center justify-center cursor-pointer transition-all shrink-0 shadow-md bg-white text-black hover:bg-neutral-200 hover:scale-105"
                      title="Tap to start recording"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                  )}

                  {/* Recorded Audio State: Listen preview button & Speed regulation & Animated Progress Bar */}
                  {voiceRecordStage === 'recorded' ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={togglePlayPreviewVoice}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold cursor-pointer border border-white/10 transition-colors shrink-0 shadow-sm"
                        title={isPreviewVoicePlaying ? 'Pause listening' : 'Listen before sending'}
                      >
                        {isPreviewVoicePlaying ? (
                          <Pause className="h-3.5 w-3.5 text-white" />
                        ) : (
                          <Play className="h-3.5 w-3.5 text-white fill-white" />
                        )}
                        <span className="hidden xs:inline">{isPreviewVoicePlaying ? 'Pause' : 'Listen'}</span>
                      </button>

                      {/* Speed regulator button (1x, 1.5x, 2x) */}
                      <button
                        type="button"
                        onClick={cyclePreviewSpeed}
                        className="px-1.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[10px] font-mono font-bold text-white border border-white/10 transition-colors shrink-0 cursor-pointer"
                        title="Regulate playback speed (1x, 1.5x, 2x)"
                      >
                        {previewPlaybackSpeed}x
                      </button>

                      <span className="text-[10px] font-mono text-white/80 shrink-0">
                        {Math.floor(previewVoiceProgress.current / 60)}:{(Math.floor(previewVoiceProgress.current % 60)).toString().padStart(2, '0')} / {Math.floor((recordedDurationSec || recordingSeconds || 1) / 60)}:{((recordedDurationSec || recordingSeconds || 1) % 60).toString().padStart(2, '0')}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        {voiceRecordStage === 'recording' ? (
                          <div className="flex items-center gap-1.5 text-xs text-red-400 font-semibold">
                            <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                            <span>Recording...</span>
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-300 font-medium">
                            Tap mic to record
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-white/80">
                        {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Right side: Cancel (discards recorded note) & Send button */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCancelVoiceRecording}
                    className="px-3 py-1.5 rounded-xl border border-white/15 text-xs text-neutral-400 hover:text-white hover:bg-neutral-900 transition-colors cursor-pointer"
                    title="Discard voice note"
                  >
                    Cancel
                  </button>

                  {voiceRecordStage === 'recorded' && (
                    <button
                      type="button"
                      disabled={isSendingVoiceNote || isSendingVoiceRef.current || !recordedVoiceUrl}
                      onClick={handleSendVoiceRecording}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-black text-xs font-bold transition-all shadow-md ${
                        isSendingVoiceNote || isSendingVoiceRef.current || !recordedVoiceUrl
                          ? 'bg-neutral-600 opacity-60 cursor-not-allowed text-white'
                          : 'bg-emerald-500 hover:bg-emerald-400 cursor-pointer hover:scale-102 active:scale-95'
                      }`}
                      title="Send voice note"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>{isSendingVoiceNote ? 'Sending...' : 'Send'}</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="relative flex items-center rounded-2xl border border-white/20 bg-neutral-950 px-2 py-1 focus-within:border-white transition-all shadow-lg">
                {/* Left side "^" button */}
                <button
                  type="button"
                  onClick={() => setShowAttachMenu((prev) => !prev)}
                  className={`p-1.5 rounded-xl transition-all cursor-pointer mr-1 shrink-0 ${
                    showAttachMenu
                      ? 'bg-white/20 text-white rotate-180'
                      : 'text-neutral-400 hover:text-white hover:bg-white/10'
                  }`}
                  title="Attach photos, songs, or voice note"
                >
                  <ChevronUp className="h-4 w-4 stroke-[2.5]" />
                </button>

                <input
                  ref={messageInputRef}
                  type="text"
                  placeholder={
                    replyingTo
                      ? `Reply to ${replyingTo.senderName}...`
                      : `Message @${activeChat.otherHandle}...`
                  }
                  value={messageInput}
                  onChange={(e) => {
                    setMessageInput(e.target.value);
                    if (activeChat && user?.uid) {
                      setTypingPresence(activeChat.threadId, user.uid, true);
                      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                      typingTimerRef.current = setTimeout(() => {
                        setTypingPresence(activeChat.threadId, user.uid, false);
                      }, 2000);
                    }
                  }}
                  className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-neutral-500 focus:outline-none pr-10 py-1.5"
                />

                <button
                  type="submit"
                  disabled={!messageInput.trim() || sendingMessage}
                  className="absolute right-1.5 p-2 rounded-xl bg-white text-black hover:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-white transition-all cursor-pointer"
                  title="Send message"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </form>
        </div>
      ) : (
        /* ========================================================= */
        /* VIEW B: CONVERSATIONS LIST & CONTACTS PAGE */
        /* ========================================================= */
        <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
          {/* Top Header of Text Someone Page */}
          <div className="px-4 sm:px-8 py-3.5 border-b border-white/10 bg-[#0e0e14]/90 backdrop-blur-md flex items-center justify-between shrink-0 min-h-[58px]">
            {selectedThreadIds.length > 0 ? (
              /* Batch Conversation Selection Bar */
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-emerald-400">
                    {selectedThreadIds.length} selected
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedThreadIds.length === filteredContacts.length) {
                        setSelectedThreadIds([]);
                      } else {
                        setSelectedThreadIds(filteredContacts.map((c) => c.threadId));
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl border border-white/20 text-xs text-neutral-200 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    {selectedThreadIds.length === filteredContacts.length ? 'Deselect All' : 'Select All'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedThreadIds([])}
                    className="px-3 py-1.5 rounded-xl border border-white/20 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchDeleteThreads}
                    className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-neutral-400" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Left: Profile picture and @name below it (Only appears when logged in; disappears immediately on logout) */}
                {user ? (
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => setIsMyProfileModalOpen(true)}
                      className="relative group h-10 w-10 sm:h-11 sm:w-11 rounded-full p-0.5 border border-white/20 bg-neutral-900 hover:border-white/50 transition-all cursor-pointer focus:outline-none shadow-sm flex items-center justify-center shrink-0 hover:scale-105 active:scale-95"
                      title="Tap to view profile"
                    >
                      {myAvatar ? (
                        <img
                          src={myAvatar}
                          alt={myName}
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full rounded-full bg-neutral-800 flex items-center justify-center text-neutral-300">
                          <UserIcon className="h-4 w-4 text-neutral-300" />
                        </div>
                      )}
                      {/* Camera badge */}
                      <div
                        className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="View and edit photo"
                      >
                        <Camera className="h-3.5 w-3.5 text-white" />
                      </div>
                    </button>
                    {myHandle && (
                      <span className="text-[11px] font-mono text-neutral-300 font-medium mt-1 truncate max-w-[120px]">
                        @{myHandle}
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="flex flex-col items-center gap-1 p-1 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                    title="Log In"
                  >
                    <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-full border border-white/20 bg-neutral-900 flex items-center justify-center text-neutral-300 hover:border-white/40">
                      <UserIcon className="h-4 w-4 text-neutral-300" />
                    </div>
                    <span className="text-[10px] text-neutral-400 font-medium">Log In</span>
                  </button>
                )}

                {/* Top Right Corner */}
                <div className="flex items-center gap-2">
                  {/* Add someone to chat button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!user) {
                        setShowGuestAddModal(true);
                      } else {
                        setAddError(null);
                        setAddUsernameInput('');
                        setIsAddModalOpen(true);
                      }
                    }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-all shadow-md cursor-pointer"
                    title="Add someone to chat with"
                  >
                    <Plus className="h-4 w-4 stroke-[2.5]" />
                    <span className="hidden sm:inline">Add someone to chat</span>
                  </button>

                  {/* Three Dots (•••) Menu on Chats View */}
                  <div className="relative shrink-0">
                    <button
                      ref={chatsTopMenuBtnRef}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowChatsTopMenu((prev) => !prev);
                      }}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-neutral-300 hover:text-white rounded-xl hover:bg-neutral-800/80 active:scale-95 transition-all cursor-pointer shadow-sm relative z-50"
                      title="Chats options"
                      aria-label="Chats options"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>

                    {showChatsTopMenu && typeof document !== 'undefined' && createPortal(
                      <div className="fixed inset-0 z-[9999999] pointer-events-auto">
                        {/* Full screen backdrop for easy tap-to-dismiss */}
                        <div
                          className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
                          onClick={() => setShowChatsTopMenu(false)}
                        />
                        {/* Floating Menu above everything */}
                        <div
                          ref={chatsTopMenuRef}
                          className="fixed top-16 right-3 sm:right-8 w-64 max-w-[calc(100vw-24px)] rounded-2xl bg-[#14141f] border border-white/20 shadow-[0_24px_70px_rgba(0,0,0,0.95)] p-2 z-[10000000] animate-in fade-in zoom-in-95 duration-150 backdrop-blur-2xl flex flex-col ring-1 ring-white/10"
                        >
                          {/* 1. Blocked accounts */}
                          <button
                            type="button"
                            onClick={() => {
                              setShowChatsTopMenu(false);
                              setShowBlockedAccountsModal(true);
                            }}
                            className="w-full text-left px-3.5 py-3 rounded-xl text-white font-medium text-xs hover:bg-white/10 active:bg-white/15 transition-colors cursor-pointer flex items-center justify-between min-h-[46px]"
                          >
                            <div className="flex items-center gap-2.5">
                              <Ban className="h-4 w-4 text-neutral-300 shrink-0" />
                              <span>Blocked accounts</span>
                            </div>
                            {blockedUsers.length > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-mono">
                                {blockedUsers.length}
                              </span>
                            )}
                          </button>

                          {/* 2. Muted accounts */}
                          <button
                            type="button"
                            onClick={() => {
                              setShowChatsTopMenu(false);
                              setShowMutedAccountsModal(true);
                            }}
                            className="w-full text-left px-3.5 py-3 rounded-xl text-white font-medium text-xs hover:bg-white/10 active:bg-white/15 transition-colors cursor-pointer flex items-center justify-between min-h-[46px]"
                          >
                            <div className="flex items-center gap-2.5">
                              <VolumeX className="h-4 w-4 text-neutral-300 shrink-0" />
                              <span>Muted accounts</span>
                            </div>
                            {mutedUsers.filter((m) => m.until > Date.now()).length > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-mono">
                                {mutedUsers.filter((m) => m.until > Date.now()).length}
                              </span>
                            )}
                          </button>

                          {/* 3. Invite friends */}
                          <button
                            type="button"
                            onClick={() => {
                              setShowChatsTopMenu(false);
                              setShowInviteFriendsModal(true);
                            }}
                            className="w-full text-left px-3.5 py-3 rounded-xl text-white font-medium text-xs hover:bg-white/10 active:bg-white/15 transition-colors cursor-pointer min-h-[46px] flex items-center gap-2.5"
                          >
                            <UserPlus className="h-4 w-4 text-neutral-300 shrink-0" />
                            <span>Invite friends</span>
                          </button>

                          {/* 4. Sign Out / Log In */}
                          {user ? (
                            <button
                              type="button"
                              onClick={async () => {
                                setShowChatsTopMenu(false);
                                await signOut();
                              }}
                              className="w-full text-left px-3.5 py-3 rounded-xl text-red-400 font-medium text-xs hover:bg-red-500/10 active:bg-red-500/20 transition-colors cursor-pointer border-t border-white/10 mt-1 flex items-center gap-2.5 min-h-[46px]"
                            >
                              <LogOut className="h-4 w-4 text-red-400 shrink-0" />
                              <span>Sign Out</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setShowChatsTopMenu(false);
                                onOpenAuth('login');
                              }}
                              className="w-full text-left px-3.5 py-3 rounded-xl text-white font-medium text-xs hover:bg-white/10 active:bg-white/15 transition-colors cursor-pointer border-t border-white/10 mt-1 flex items-center gap-2.5 min-h-[46px]"
                            >
                              <UserIcon className="h-4 w-4 text-neutral-300 shrink-0" />
                              <span>Log In / Create Account</span>
                            </button>
                          )}
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
          </>
        )}
      </div>

          {/* Conversations Body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-5">
            {!user ? (
              /* Signed-out placeholder */
              <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
                <div className="h-16 w-16 rounded-2xl bg-neutral-900 border border-white/15 flex items-center justify-center text-white mb-4 shadow-xl">
                  <MessageSquare className="h-8 w-8 text-neutral-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  Create account or log in to text someone
                </h3>
                <p className="text-xs text-neutral-300 font-medium leading-relaxed mb-5">
                  Message people directly on Nochaf AI using your Google or username account.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="px-5 py-2.5 rounded-xl border border-white/20 text-xs font-semibold text-white hover:bg-neutral-800 transition-colors shadow cursor-pointer"
                  >
                    Log In
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAuth('create_account')}
                    className="px-5 py-2.5 rounded-xl bg-white text-xs font-semibold text-black hover:bg-neutral-200 transition-colors shadow-lg cursor-pointer"
                  >
                    Create Account
                  </button>
                </div>
              </div>
            ) : loadingContacts ? (
              /* Loading skeleton */
              <div className="space-y-2.5 max-w-3xl mx-auto">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-white/5 bg-neutral-950/60 animate-pulse"
                  >
                    <div className="h-11 w-11 rounded-full bg-neutral-800 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-32 bg-neutral-800 rounded" />
                      <div className="h-2.5 w-48 bg-neutral-900 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : contacts.length === 0 ? (
              /* EMPTY STATE: "if you have not started a conversation yet ,just show add someone to chat with a plus button" */
              <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
                <div className="h-16 w-16 rounded-2xl bg-neutral-900 border border-white/15 flex items-center justify-center text-white mb-4 shadow-xl">
                  <MessageSquare className="h-8 w-8 text-neutral-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1.5">
                  No conversations yet
                </h3>
                <p className="text-xs text-neutral-400 leading-relaxed mb-6">
                  You have not started a conversation yet. Tap the button below to add anyone using their username on Nochaf AI.
                </p>

                {/* Prominent "+ Add someone to chat" button */}
                <button
                  type="button"
                  onClick={() => {
                    setAddError(null);
                    setAddUsernameInput('');
                    setIsAddModalOpen(true);
                  }}
                  className="flex items-center gap-2.5 px-6 py-3 rounded-2xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-all shadow-xl hover:scale-105 cursor-pointer"
                >
                  <Plus className="h-4 w-4 stroke-[3]" />
                  <span>Add someone to chat</span>
                </button>
              </div>
            ) : (
              /* CONVERSATIONS LIST: All people chatted with, their @names & profile pictures */
              <div className="space-y-2.5 max-w-3xl mx-auto">
                {/* Search someone to text bar (first letter automatically lower case) */}
                <div className="relative mb-3">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
                  <input
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Search someone to text..."
                    value={searchContactQuery}
                    onChange={(e) => {
                      let val = e.target.value;
                      if (val.length > 0) {
                        // Automatically make the first letter lower case
                        val = val.charAt(0).toLowerCase() + val.slice(1);
                      }
                      setSearchContactQuery(val);
                    }}
                    className="w-full rounded-2xl border border-white/15 bg-neutral-950/80 py-2.5 pl-10 pr-9 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none transition-colors shadow-inner"
                  />
                  {searchContactQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchContactQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-white cursor-pointer"
                      title="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between pb-1 text-[11px] font-mono text-neutral-400 px-1">
                  <span>{searchContactQuery ? 'Search Results' : 'Recent'}</span>
                  {searchContactQuery && (
                    <span className="text-[10px] text-neutral-500">
                      {displayContacts.length + globalSearchResults.length} found
                    </span>
                  )}
                </div>

                {/* Global Search Results from Nochaf AI Users */}
                {globalSearchResults.length > 0 && (
                  <div className="space-y-1.5 my-2">
                    <div className="text-[10px] font-mono text-neutral-400 px-1 uppercase tracking-wider">
                      Nochaf AI Users
                    </div>
                    {globalSearchResults.map((userItem) => (
                      <div
                        key={userItem.threadId}
                        onClick={() => {
                          // Open active chat locally WITHOUT writing anything to Firestore
                          // Neither party sees an inbox thread until a message is actually texted!
                          setSearchContactQuery('');
                          setGlobalSearchResults([]);
                          setActiveChat(userItem);
                        }}
                        className="flex items-center justify-between p-3.5 rounded-2xl border border-white/10 bg-neutral-900/60 hover:bg-neutral-800 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-2">
                          <div className="relative shrink-0">
                            {userItem.otherAvatar ? (
                              <img
                                src={userItem.otherAvatar}
                                alt=""
                                className="h-11 w-11 rounded-full object-cover border border-white/10"
                              />
                            ) : (
                              <div className="h-11 w-11 rounded-full bg-neutral-800 border border-white/15 flex items-center justify-center text-neutral-300">
                                <UserIcon className="h-5 w-5 text-neutral-300" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold text-xs text-white block truncate">
                              {userItem.otherName}
                            </span>
                            <span className="text-[11px] font-mono text-neutral-400 block truncate">
                              @{userItem.otherHandle}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono px-3 py-1 rounded-full bg-white text-black font-semibold">
                          Chat
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* When a person is not using Nochaf AI, state user "name" not found */}
                {displayContacts.length === 0 && globalSearchResults.length === 0 && searchContactQuery.trim() ? (
                  <div className="p-6 text-center rounded-2xl border border-white/10 bg-neutral-950/60 my-2">
                    <p className="text-xs text-neutral-300">
                      {isSearchingGlobal
                        ? 'Searching Nochaf AI...'
                        : `user "${searchContactQuery.trim().replace(/^@+/, '')}" not found`}
                    </p>
                  </div>
                ) : null}

                {displayContacts.map((c) => {
                  const isSelectedThread = selectedThreadIds.includes(c.threadId);
                  const isOtherOnline = onlineContactsMap[c.otherUid] ?? false;
                  const isFavourite = favouriteUserIds.includes(c.otherUid);
                  return (
                    <div
                      key={c.threadId}
                      onClick={() => handleThreadClick(c)}
                      onTouchStart={(e) => handleThreadPressStart(c, e)}
                      onTouchMove={handleThreadPressMove}
                      onTouchEnd={handleThreadPressEnd}
                      onMouseDown={(e) => handleThreadPressStart(c, e)}
                      onMouseMove={handleThreadPressMove}
                      onMouseUp={handleThreadPressEnd}
                      className={`group relative flex items-center justify-between p-3.5 rounded-2xl transition-all cursor-pointer select-none ${
                        isSelectedThread
                          ? 'border-2 border-emerald-500 bg-emerald-950/40 ring-2 ring-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                          : 'border border-transparent bg-transparent hover:bg-neutral-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-2">
                        {/* Recipient Profile Picture: Tap to view full profile */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingUserProfile({
                              name: c.otherName,
                              handle: c.otherHandle,
                              avatar: c.otherAvatar,
                              uid: c.otherUid,
                            });
                          }}
                          className="relative shrink-0 cursor-pointer group/avatar"
                          title="Tap to view full profile"
                        >
                          {c.otherAvatar ? (
                            <img
                              src={c.otherAvatar}
                              alt={c.otherName}
                              className="h-12 w-12 rounded-full object-cover shadow-sm group-hover/avatar:scale-105 transition-transform"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-300 shadow-sm group-hover/avatar:scale-105 transition-transform">
                              <UserIcon className="h-6 w-6 text-neutral-300" />
                            </div>
                          )}
                          {/* The green dot appears at the profile picture:
                              Only green when person is online, greyish when offline */}
                          <span
                            className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full ring-2 ring-[#0a0a0c] transition-all ${
                              isOtherOnline
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.95)]'
                                : 'bg-neutral-500'
                            }`}
                            title={isOtherOnline ? 'Online' : 'Offline'}
                          />
                        </div>

                      {/* Name, @username & Last Message */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5 mb-0.5">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-semibold text-sm text-white truncate group-hover:text-white">
                              {c.otherName}
                            </span>
                            <span className="text-xs font-mono text-neutral-400 truncate">
                              @{c.otherHandle}
                            </span>
                          </div>
                          {/* Online or last seen status */}
                          <div className="shrink-0 text-[10.5px]">
                            {isOtherOnline ? (
                              <span className="text-emerald-400 font-medium">online</span>
                            ) : userStatusMap[c.otherUid]?.lastSeen ? (
                              <span className="text-neutral-500 font-mono text-[10px]">
                                last seen {formatLastSeen(userStatusMap[c.otherUid]?.lastSeen)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p className="text-xs text-neutral-400 truncate leading-relaxed">
                          {c.lastMessage || (
                            <span className="italic text-neutral-500">
                              No messages yet — tap to say hi
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Right corner end: 3D Shiny Love (with notification inside) or 3D Circle */}
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {isFavourite ? (
                        /* When placed in favourite: 3D and shiny love icon with notification number inside */
                        <div
                          className="relative flex items-center justify-center shrink-0 select-none animate-in zoom-in-75"
                          title={c.unreadCount && c.unreadCount > 0 ? `${c.unreadCount} unread • Favourite account` : 'Favourite account'}
                        >
                          <svg
                            viewBox="0 0 32 32"
                            className="w-7 h-7 drop-shadow-[0_4px_10px_rgba(244,63,94,0.75)]"
                          >
                            <defs>
                              <radialGradient id={`heart3d-${c.threadId}`} cx="35%" cy="30%" r="70%">
                                <stop offset="0%" stopColor="#fda4af" />
                                <stop offset="30%" stopColor="#f43f5e" />
                                <stop offset="70%" stopColor="#be123c" />
                                <stop offset="100%" stopColor="#4c0519" />
                              </radialGradient>
                              <linearGradient id={`shine-${c.threadId}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.1" />
                              </linearGradient>
                            </defs>
                            {/* 3D Heart Body */}
                            <path
                              d="M16 28.5 C15.4 28.5 14.8 28.2 14.3 27.7 L6.2 19.6 C2.8 16.2 2 11.2 4.4 7.2 C6.8 3.2 11.4 1.8 15.6 4.1 L16 4.3 L16.4 4.1 C20.6 1.8 25.2 3.2 27.6 7.2 C30 11.2 29.2 16.2 25.8 19.6 L17.7 27.7 C17.2 28.2 16.6 28.5 16 28.5 Z"
                              fill={`url(#heart3d-${c.threadId})`}
                              stroke="rgba(255, 255, 255, 0.45)"
                              strokeWidth="0.8"
                            />
                            {/* Shiny Reflection Glare */}
                            <path
                              d="M 8.5 8.5 C 7 11 8 13.5 10 13.5 C 10.5 11 12 9.5 13.5 8 C 11.5 7 9.5 7.5 8.5 8.5 Z"
                              fill={`url(#shine-${c.threadId})`}
                              pointerEvents="none"
                            />
                            <path
                              d="M 23.5 8.5 C 25 11 24 13.5 22 13.5 C 21.5 11 20 9.5 18.5 8 C 20.5 7 22.5 7.5 23.5 8.5 Z"
                              fill={`url(#shine-${c.threadId})`}
                              pointerEvents="none"
                            />
                          </svg>
                          {/* Notification number appearing inside the 3D love icon */}
                          {c.unreadCount && c.unreadCount > 0 ? (
                            <span className="absolute inset-0 flex items-center justify-center text-[10.5px] font-mono font-black text-white drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.95)] pt-0.5 leading-none">
                              {c.unreadCount}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        /* Standard account: 3D circle with notification number inside */
                        c.unreadCount && c.unreadCount > 0 ? (
                          <div
                            className="relative flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-extrabold text-white shadow-[0_3px_8px_rgba(16,185,129,0.6),inset_0_1.5px_2px_rgba(255,255,255,0.85),inset_0_-2px_4px_rgba(0,0,0,0.6)] bg-gradient-to-b from-emerald-400 via-emerald-600 to-emerald-900 border border-emerald-300/40 select-none animate-in zoom-in-75 shrink-0"
                            title={`${c.unreadCount} unread`}
                          >
                            <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-1 bg-white/80 rounded-full pointer-events-none" />
                            <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] leading-none font-mono">
                              {c.unreadCount}
                            </span>
                          </div>
                        ) : null
                      )}

                      {isSelectedThread && (
                        <div className="h-5 w-5 rounded-full bg-emerald-500 text-black flex items-center justify-center shadow shrink-0">
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 1: USER'S OWN ZOOMED PROFILE WITH 1x1 PHOTO & EDITABLE NAME */}
      {/* ========================================================= */}
      {isMyProfileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm rounded-3xl bg-[#121217] p-6 text-white shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col items-center text-center">
            {/* Back arrow on left top side corner */}
            <button
              type="button"
              onClick={() => {
                setIsMyProfileModalOpen(false);
                setIsEditingName(false);
              }}
              className="absolute left-4 top-4 p-2 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={() => {
                setIsMyProfileModalOpen(false);
                setIsEditingName(false);
              }}
              className="absolute right-4 top-4 p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Large Zoomed Circle with Profile Picture - Clean, no green or grey border */}
            <div className="relative mt-3 mb-5 group">
              <div
                onClick={() => {
                  if (myAvatar) {
                    setFullscreenMediaUrl(myAvatar);
                  }
                }}
                className={`h-44 w-44 sm:h-48 sm:w-48 rounded-full shadow-2xl overflow-hidden bg-neutral-900 flex items-center justify-center ${
                  myAvatar ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
                }`}
                title={myAvatar ? 'Tap to view full picture' : undefined}
              >
                {myAvatar ? (
                  <img
                    src={myAvatar}
                    alt={myName}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full rounded-full bg-neutral-800 flex items-center justify-center text-neutral-300 shadow-inner">
                    <UserIcon className="h-24 w-24 text-neutral-400" />
                  </div>
                )}
              </div>

              {/* Delete Profile Photo Option: small grey delete icon with no border, no red color, no text */}
              {myAvatar && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteProfilePhoto();
                  }}
                  className="absolute bottom-2 left-2 p-2 rounded-full bg-neutral-900/90 text-neutral-400 hover:text-white shadow-lg flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5 text-neutral-400" />
                </button>
              )}

              {/* Camera Button on the circle: Allows adding photo */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="absolute bottom-2 right-2 h-11 w-11 rounded-full bg-white text-black hover:bg-neutral-200 shadow-2xl flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95 border-2 border-[#121217]"
                title="Add / change photo"
              >
                <Camera className="h-5 w-5" />
              </button>
            </div>

            {/* Editable Name Below Circle */}
            <div className="w-full mb-3">
              {isEditingName ? (
                <form onSubmit={handleSaveDisplayName} className="space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      autoFocus
                      required
                      value={nameEditValue}
                      onChange={(e) => setNameEditValue(e.target.value)}
                      placeholder="Enter your name"
                      className="w-full text-center rounded-xl border border-emerald-500/50 bg-neutral-950 py-2 px-3 text-base font-bold text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                  <p className="text-[11px] text-neutral-400 text-center">
                    Your name is visible to everyone you text.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        setNameEditValue(myName);
                        setIsEditingName(false);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-white/15 text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingName || !nameEditValue.trim()}
                      className="px-4 py-1.5 rounded-lg bg-emerald-500 text-black font-semibold text-xs hover:bg-emerald-400 transition-colors shadow-md cursor-pointer disabled:opacity-40"
                    >
                      {savingName ? 'Saving...' : 'Save Name'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xl font-bold text-white tracking-tight">
                    {myName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsEditingName(true)}
                    className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                    title="Change name"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              {nameSaveSuccess && (
                <p className="text-[11px] text-emerald-400 mt-1 flex items-center justify-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  <span>Name updated & visible to everyone!</span>
                </p>
              )}
            </div>

            {/* @Name Below (Cannot be changed) */}
            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900 border border-white/10 text-neutral-300 text-xs font-mono mb-2" title="Username cannot be changed">
              <span>@{myHandle}</span>
              <span className="text-neutral-500">
                <Lock className="h-3 w-3" />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: PICTURE CROP & FIT MODAL */}
      {/* ========================================================= */}
      {is1x1ModalOpen && rawImageFor1x1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm rounded-3xl bg-[#121217] p-6 text-white shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col items-center text-center">
            {/* Back arrow on left top side corner */}
            <button
              type="button"
              onClick={() => {
                setIs1x1ModalOpen(false);
                setRawImageFor1x1(null);
              }}
              className="absolute left-4 top-4 p-2 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={() => {
                setIs1x1ModalOpen(false);
                setRawImageFor1x1(null);
              }}
              className="absolute right-4 top-4 p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-white mb-1">
              Fit Profile Photo
            </h3>
            <p className="text-xs text-neutral-400 mb-4">
              Pinch with fingers to zoom • Drag to fit
            </p>

            {/* Box showing how picture will fit - moving & zooming by hands only */}
            <div
              onTouchStart={handleCropTouchStart}
              onTouchMove={handleCropTouchMove}
              onTouchEnd={handleCropTouchEnd}
              onMouseDown={handleCropMouseDown}
              onMouseMove={handleCropMouseMove}
              onMouseUp={handleCropMouseUp}
              onMouseLeave={handleCropMouseUp}
              onWheel={handleCropWheel}
              className="relative h-60 w-60 rounded-2xl overflow-hidden bg-black flex items-center justify-center mb-5 select-none touch-none cursor-grab active:cursor-grabbing border border-white/20 shadow-inner"
            >
              <img
                src={rawImageFor1x1}
                alt="Preview"
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom1x1})`,
                  transition: isDraggingCropRef.current ? 'none' : 'transform 0.05s ease-out',
                }}
                className="max-w-none h-full w-full object-cover select-none pointer-events-none"
              />
              {/* Circular fit guide inside the box */}
              <div className="absolute inset-0 rounded-full border border-white/40 pointer-events-none" />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={() => {
                  setIs1x1ModalOpen(false);
                  setRawImageFor1x1(null);
                }}
                className="flex-1 py-2.5 rounded-xl border border-white/15 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={handleSave1x1CroppedPhoto}
                className="flex-1 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors shadow-lg cursor-pointer disabled:opacity-40"
              >
                {uploadingAvatar ? 'Saving...' : 'Save Photo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3: SOMEONE ELSE'S FULL PROFILE VIEW */}
      {/* ========================================================= */}
      {viewingUserProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm rounded-3xl bg-[#121217] p-6 text-white shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col items-center text-center">
            {/* Back arrow on left top side corner */}
            <button
              type="button"
              onClick={() => setViewingUserProfile(null)}
              className="absolute left-4 top-4 p-2 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setViewingUserProfile(null)}
              className="absolute right-4 top-4 p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Large Circle with Profile Picture — Clean, no green or grey border */}
            <div
              onClick={() => {
                if (viewingUserProfile.avatar) {
                  setFullscreenMediaUrl(viewingUserProfile.avatar);
                }
              }}
              className={`h-44 w-44 sm:h-48 sm:w-48 rounded-full shadow-2xl overflow-hidden bg-neutral-900 flex items-center justify-center mt-3 mb-5 ${
                viewingUserProfile.avatar ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
              }`}
              title={viewingUserProfile.avatar ? 'Tap to view full picture' : undefined}
            >
              {viewingUserProfile.avatar ? (
                <img
                  src={viewingUserProfile.avatar}
                  alt={viewingUserProfile.name}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <div className="h-full w-full rounded-full bg-neutral-800 flex items-center justify-center text-neutral-300">
                  <UserIcon className="h-24 w-24 text-neutral-400" />
                </div>
              )}
            </div>

            {/* Name Below */}
            <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-1">
              {viewingUserProfile.name}
            </h3>

            {/* @Name Below */}
            <p className="text-sm font-mono text-neutral-400 mb-6">
              @{viewingUserProfile.handle}
            </p>

            {/* Quick Action: Text someone */}
            <button
              type="button"
              onClick={() => {
                // If not in chat with them, find or start chat
                const found = contacts.find((c) => c.otherHandle === viewingUserProfile.handle);
                if (found) {
                  setActiveChat(found);
                }
                setViewingUserProfile(null);
              }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-all shadow-lg cursor-pointer"
            >
              <MessageSquare className="h-4 w-4" />
              <span>Message @{viewingUserProfile.handle}</span>
            </button>

            {/* Report Account Action (LAYER 6: 3 reports -> auto shadow-ban) */}
            {viewingUserProfile.uid && viewingUserProfile.uid !== user?.uid && (
              <button
                type="button"
                onClick={() => handleReportUser(viewingUserProfile.uid!, viewingUserProfile.handle)}
                disabled={reportingUser}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 font-semibold text-xs hover:bg-red-500/20 transition-all cursor-pointer"
              >
                <Flag className="h-3.5 w-3.5 text-red-400" />
                <span>{reportingUser ? 'Reporting...' : 'Report Account (Spam)'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 4: "ADD SOMEONE TO CHAT" WITH USERNAME LOOKUP */}
      {/* ========================================================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-sm rounded-2xl border border-white/20 bg-[#121217] p-5 text-white shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-neutral-900 border border-white/15 flex items-center justify-center text-white">
                  <UserIcon className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add Someone to Chat</h3>
                  <p className="text-[11px] text-neutral-400">Search by their Nochaf AI @username</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {addError && (
              <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] w-[92%] max-w-sm animate-in fade-in slide-in-from-top-3 duration-150">
                <div className="flex items-start justify-between gap-3 rounded-2xl border border-red-500/40 bg-[#161218]/95 p-3.5 text-xs text-red-100 shadow-2xl backdrop-blur-xl ring-1 ring-red-500/30">
                  <div className="space-y-0.5 flex-1 pr-1">
                    <p className="font-semibold text-red-300">Notice</p>
                    <p className="text-[11px] leading-relaxed text-red-200/95">{addError}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddError(null)}
                    className="rounded-lg p-1 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer shrink-0"
                    title="Dismiss warning (×)"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleAddPersonByUsername} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                  Enter Username
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-xs font-mono text-neutral-400">@</span>
                  <input
                    type="text"
                    required
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Enter username"
                    value={addUsernameInput}
                    onChange={(e) => {
                      let val = e.target.value;
                      if (val.length > 0) {
                        // First letter automatically lower case
                        val = val.charAt(0).toLowerCase() + val.slice(1);
                      }
                      setAddUsernameInput(val);
                      if (addError) setAddError(null);
                    }}
                    className="w-full rounded-xl border border-white/15 bg-neutral-950 py-2 pl-8 pr-3 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none font-mono"
                  />
                </div>
                <p className="mt-1 text-[10px] text-neutral-500 leading-normal">
                  If their username is available on Nochaf AI, you will be taken directly to their personal chat page.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-white/15 text-xs text-neutral-400 hover:text-white hover:bg-neutral-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addSearching || !addUsernameInput.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-xs font-semibold text-black hover:bg-neutral-200 disabled:opacity-40 transition-colors shadow-md cursor-pointer"
                >
                  {addSearching ? (
                    <span className="animate-pulse">Checking...</span>
                  ) : (
                    <>
                      <span>Start Chat</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: GUEST TAP PLUS BUTTON -> CREAT ACCOUNT TO ADD PEOPLE */}
      {/* ========================================================= */}
      {showGuestAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-sm rounded-2xl border border-white/20 bg-[#101015] p-6 text-center text-white shadow-2xl">
            <button
              onClick={() => setShowGuestAddModal(false)}
              className="absolute right-3.5 top-3.5 rounded-lg p-1 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="h-14 w-14 rounded-2xl bg-neutral-900 border border-white/15 flex items-center justify-center mx-auto mb-4 text-white shadow-xl">
              <UserPlus className="h-7 w-7 text-white" />
            </div>
            <h3 className="text-base font-bold text-white tracking-tight mb-1.5">
              Create account or log in to add people
            </h3>
            <p className="text-xs text-neutral-300 mb-5 leading-relaxed font-medium">
              Connect and chat with people directly on Nochaf AI.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowGuestAddModal(false);
                  onOpenAuth('login');
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/20 py-2.5 text-xs font-semibold text-white transition-all hover:bg-neutral-800 cursor-pointer shadow-md"
              >
                <span>Log In</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGuestAddModal(false);
                  onOpenAuth('create_account');
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-xs font-semibold text-black transition-all hover:bg-neutral-200 cursor-pointer shadow-lg"
              >
                <span>Create Account</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 5: DELETE CONVERSATION CONFIRMATION */}
      {/* ========================================================= */}
      {threadToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setThreadToDelete(null)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-white/20 bg-[#121217] p-5 text-white shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-10 w-10 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-400 mx-auto mb-3">
              <Trash2 className="h-4 w-4 text-neutral-400" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              Delete Conversation?
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed mb-4">
              All messages with <span className="text-white font-medium">@{threadToDelete.otherHandle}</span> will be deleted on your side only. The other person will still keep their conversation.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setThreadToDelete(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/15 text-xs text-neutral-300 hover:bg-neutral-900 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteThread}
                className="flex-1 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors shadow-md cursor-pointer"
              >
                Delete for me
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 6: DELETE SELECTED MESSAGES (Delete for everyone / for me / Cancel) */}
      {/* ========================================================= */}
      {isBatchDeleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setIsBatchDeleteModalOpen(false)}
        >
          <div
            className="relative w-full max-w-xs rounded-2xl border border-white/20 bg-[#121217] p-5 text-white shadow-2xl animate-in zoom-in-95 duration-150 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-10 w-10 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-400 mx-auto mb-3">
              <Trash2 className="h-4 w-4 text-neutral-400" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">
              Delete {selectedMessageIds.length} {selectedMessageIds.length === 1 ? 'Message' : 'Messages'}?
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed mb-4">
              Choose how to delete selected messages.
            </p>

            <div className="flex flex-col gap-2">
              {/* Only show delete for everyone if ALL selected messages were sent by me (never when someone else sent) */}
              {selectedMessageIds.length > 0 &&
                selectedMessageIds.every((id) => {
                  const item = messages.find((m) => m.id === id);
                  return item && item.senderId === user?.uid;
                }) && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedMessagesForEveryone}
                  className="w-full py-2.5 rounded-xl border border-white/15 text-xs font-semibold text-neutral-200 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  Delete for everyone
                </button>
              )}
              <button
                type="button"
                onClick={handleDeleteSelectedMessages}
                className="w-full py-2.5 rounded-xl border border-white/15 text-xs font-semibold text-neutral-200 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Delete for me
              </button>
              <button
                type="button"
                onClick={() => setIsBatchDeleteModalOpen(false)}
                className="w-full py-2 rounded-xl text-xs text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer border-t border-white/10 pt-2.5 mt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* FLOATING TOAST NOTIFICATION (Disappears in 3s) */}
      {/* ========================================================= */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-neutral-900/95 border border-white/20 text-white px-4 py-2 text-xs font-semibold shadow-2xl animate-in fade-in slide-in-from-top-2 flex items-center gap-2 select-none backdrop-blur-md">
          <Check className="h-4 w-4 text-white stroke-[2.5]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: SHARE ACCOUNT */}
      {/* ========================================================= */}
      {showShareAccountModal && activeChat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setShowShareAccountModal(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-white/20 bg-[#121218] p-5 text-white shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-white" />
                <h3 className="text-sm font-bold text-white">Share Account</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShareAccountModal(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Profile preview */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-neutral-900/80 border border-white/10">
              {activeChat.otherAvatar ? (
                <img
                  src={activeChat.otherAvatar}
                  alt={activeChat.otherName}
                  className="h-11 w-11 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="h-11 w-11 rounded-full bg-neutral-800 flex items-center justify-center text-white shrink-0">
                  <UserIcon className="h-5 w-5 text-neutral-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-white truncate">{activeChat.otherName}</p>
                <p className="text-xs font-mono text-neutral-400 truncate">@{activeChat.otherHandle}</p>
              </div>
            </div>

            {/* Section 1: Send username to another conversation */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-neutral-200">
                Send @{activeChat.otherHandle} to someone:
              </label>
              {contacts.filter((c) => c.otherUid !== activeChat.otherUid).length > 0 ? (
                <div className="space-y-2">
                  <select
                    value={shareDirectToThreadId}
                    onChange={(e) => setShareDirectToThreadId(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-neutral-950 p-2 text-xs text-white focus:outline-none"
                  >
                    <option value="">Select a person to send to...</option>
                    {contacts
                      .filter((c) => c.otherUid !== activeChat.otherUid)
                      .map((c) => (
                        <option key={c.threadId} value={c.threadId}>
                          {c.otherName} (@{c.otherHandle})
                        </option>
                      ))}
                  </select>

                  <textarea
                    rows={2}
                    value={shareDirectNote}
                    onChange={(e) => setShareDirectNote(e.target.value)}
                    placeholder={`Optional note: Check out @${activeChat.otherHandle} on Nochaf AI!`}
                    className="w-full rounded-xl border border-white/15 bg-neutral-950 p-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none"
                  />

                  <button
                    type="button"
                    disabled={!shareDirectToThreadId}
                    onClick={() => {
                      if (shareDirectToThreadId) {
                        handleShareAccountToConversation(
                          shareDirectToThreadId,
                          activeChat.otherHandle,
                          shareDirectNote
                        );
                      }
                    }}
                    className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 disabled:opacity-40 transition-colors cursor-pointer shadow-md"
                  >
                    Send to Selected Conversation
                  </button>
                </div>
              ) : (
                <p className="text-xs text-neutral-500 italic">No other conversations started yet.</p>
              )}
            </div>

            {/* Section 2: Message place where someone can text them directly */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <label className="block text-xs font-semibold text-neutral-200">
                Message place — Text @{activeChat.otherHandle}:
              </label>
              <textarea
                rows={2}
                value={shareDirectDirectMsgInput}
                onChange={(e) => setShareDirectDirectMsgInput(e.target.value)}
                placeholder={`Type a message to @${activeChat.otherHandle}...`}
                className="w-full rounded-xl border border-white/15 bg-neutral-950 p-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={!shareDirectDirectMsgInput.trim()}
                onClick={async () => {
                  const text = shareDirectDirectMsgInput.trim();
                  if (!text || !activeChat) return;
                  try {
                    const msgsRef = collection(db, 'directMessages', activeChat.threadId, 'messages');
                    await addDoc(msgsRef, {
                      threadId: activeChat.threadId,
                      senderId: user?.uid || 'user',
                      senderHandle: myHandle,
                      senderName: myName,
                      senderAvatar: myAvatar,
                      content: text,
                      createdAt: new Date().toISOString(),
                      timestamp: new Date().toISOString(),
                      readBy: [user?.uid || 'user'],
                    });
                    await updateDoc(doc(db, 'directMessages', activeChat.threadId), {
                      lastMessage: text,
                      lastSenderId: user?.uid || 'user',
                      updatedAt: new Date().toISOString(),
                      readBy: [user?.uid || 'user'],
                      [`unreadCounts.${user?.uid || 'user'}`]: 0,
                    });
                    setShareDirectDirectMsgInput('');
                    triggerToast(`Message sent to @${activeChat.otherHandle}`);
                    setShowShareAccountModal(false);
                  } catch (err) {
                    console.warn('Direct text error:', err);
                  }
                }}
                className="w-full py-2 rounded-xl border border-white/20 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40 transition-colors cursor-pointer"
              >
                Send Message
              </button>
            </div>

            {/* Section 3: Direct Link & External Sharing */}
            <div className="pt-2 border-t border-white/10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const link = `${window.location.origin}/?text=${activeChat.otherHandle}`;
                  navigator.clipboard.writeText(link).catch(() => {});
                  triggerToast('Link copied to clipboard!');
                }}
                className="flex-1 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs text-white font-medium transition-colors cursor-pointer"
              >
                Copy Link
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  type="button"
                  onClick={() => {
                    const link = `${window.location.origin}/?text=${activeChat.otherHandle}`;
                    navigator
                      .share({
                        title: `Text @${activeChat.otherHandle} on Nochaf AI`,
                        text: `Connect with @${activeChat.otherHandle} on Nochaf AI:`,
                        url: link,
                      })
                      .catch(() => {});
                  }}
                  className="py-2 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs text-white font-medium transition-colors cursor-pointer"
                >
                  Share via...
                </button>
              )}
            </div>

            {shareSuccessNotice && (
              <p className="text-center text-xs text-white font-medium animate-pulse">
                {shareSuccessNotice}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: MUTE ACCOUNT DURATION (24h, 1w, 1mo) */}
      {/* ========================================================= */}
      {showMuteModal && activeChat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setShowMuteModal(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-white/20 bg-[#121218] p-5 text-white shadow-2xl text-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-10 w-10 rounded-full bg-neutral-800 border border-white/15 flex items-center justify-center text-white mx-auto">
              <VolumeX className="h-5 w-5 text-neutral-300" />
            </div>

            <div>
              <h3 className="text-base font-bold text-white mb-1">Mute @{activeChat.otherHandle}?</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                This account will be hidden from your chats. Even when they text you, you will not see their messages or notifications until the mute duration ends or you unmute them.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleMuteAccount(activeChat, 24 * 60 * 60 * 1000, '24 hours')}
                className="w-full py-2.5 rounded-xl border border-white/15 text-xs font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                24 hours
              </button>
              <button
                type="button"
                onClick={() => handleMuteAccount(activeChat, 7 * 24 * 60 * 60 * 1000, '1 week')}
                className="w-full py-2.5 rounded-xl border border-white/15 text-xs font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                1 week
              </button>
              <button
                type="button"
                onClick={() => handleMuteAccount(activeChat, 30 * 24 * 60 * 60 * 1000, '1 month')}
                className="w-full py-2.5 rounded-xl border border-white/15 text-xs font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                1 month
              </button>
              <button
                type="button"
                onClick={() => setShowMuteModal(false)}
                className="w-full py-2 rounded-xl text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer mt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: BLOCKED ACCOUNTS (Unblock anyone) */}
      {/* ========================================================= */}
      {showBlockedAccountsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setShowBlockedAccountsModal(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-white/20 bg-[#121218] p-5 text-white shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Ban className="h-4 w-4 text-white" />
                <h3 className="text-sm font-bold text-white">Blocked Accounts</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBlockedAccountsModal(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {blockedUsers.length === 0 ? (
              <div className="py-8 text-center text-neutral-400 text-xs">
                No blocked accounts.
              </div>
            ) : (
              <div className="space-y-2">
                {blockedUsers.map((b) => (
                  <div
                    key={b.uid}
                    className="flex items-center justify-between p-3 rounded-xl bg-neutral-900 border border-white/10"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {b.avatar ? (
                        <img
                          src={b.avatar}
                          alt={b.name}
                          className="h-9 w-9 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-neutral-800 flex items-center justify-center text-white shrink-0">
                          <UserIcon className="h-4 w-4 text-neutral-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{b.name}</p>
                        <p className="text-[11px] font-mono text-neutral-400 truncate">@{b.handle}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleUnblockAccount(b.uid)}
                      className="px-3 py-1.5 rounded-lg border border-white/20 text-xs font-medium text-white hover:bg-white hover:text-black transition-colors cursor-pointer shrink-0 ml-2"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: MUTED ACCOUNTS (Unmute anyone) */}
      {/* ========================================================= */}
      {showMutedAccountsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setShowMutedAccountsModal(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-white/20 bg-[#121218] p-5 text-white shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <VolumeX className="h-4 w-4 text-white" />
                <h3 className="text-sm font-bold text-white">Muted Accounts</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMutedAccountsModal(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {mutedUsers.filter((m) => m.until > Date.now()).length === 0 ? (
              <div className="py-8 text-center text-neutral-400 text-xs">
                No muted accounts. All your conversations are visible.
              </div>
            ) : (
              <div className="space-y-2">
                {mutedUsers
                  .filter((m) => m.until > Date.now())
                  .map((m) => (
                    <div
                      key={m.uid}
                      className="flex items-center justify-between p-3 rounded-xl bg-neutral-900 border border-white/10"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {m.avatar ? (
                          <img
                            src={m.avatar}
                            alt={m.name}
                            className="h-9 w-9 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-neutral-800 flex items-center justify-center text-white shrink-0">
                            <UserIcon className="h-4 w-4 text-neutral-400" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{m.name}</p>
                          <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400 truncate">
                            <span>@{m.handle}</span>
                            <span>•</span>
                            <span className="text-neutral-300">{formatRemainingMute(m.until)}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleUnmuteAccount(m.uid)}
                        className="px-3 py-1.5 rounded-lg border border-white/20 text-xs font-medium text-white hover:bg-white hover:text-black transition-colors cursor-pointer shrink-0 ml-2"
                      >
                        Unmute
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: INVITE FRIENDS TO NOCHAF AI */}
      {/* ========================================================= */}
      {showInviteFriendsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setShowInviteFriendsModal(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-white/20 bg-[#121218] p-5 text-white shadow-2xl text-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-12 w-12 rounded-2xl bg-neutral-900 border border-white/15 flex items-center justify-center text-white mx-auto shadow-inner">
              <UserPlus className="h-6 w-6 text-white" />
            </div>

            <div>
              <h3 className="text-base font-bold text-white mb-1">Invite Friends to Nochaf AI</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Send a link to your friends to join Nochaf AI and start texting, voice chatting, and exploring together.
              </p>
            </div>

            {/* Invite link display */}
            <div className="p-2.5 rounded-xl bg-neutral-950 border border-white/10 text-xs font-mono text-neutral-300 select-all break-all">
              {typeof window !== 'undefined' ? window.location.origin : 'https://nochaf.ai'}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const url = typeof window !== 'undefined' ? window.location.origin : 'https://nochaf.ai';
                  navigator.clipboard.writeText(url).catch(() => {});
                  triggerToast('Invite link copied!');
                }}
                className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors cursor-pointer shadow-md"
              >
                Copy Invite Link
              </button>

              {/* Direct share channels */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const url = typeof window !== 'undefined' ? window.location.origin : 'https://nochaf.ai';
                    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent('Join me on Nochaf AI! ' + url)}`, '_blank');
                  }}
                  className="py-2 px-3 rounded-xl border border-white/15 text-xs text-neutral-200 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = typeof window !== 'undefined' ? window.location.origin : 'https://nochaf.ai';
                    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent('Join me on Nochaf AI!')}`, '_blank');
                  }}
                  className="py-2 px-3 rounded-xl border border-white/15 text-xs text-neutral-200 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  Telegram
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = typeof window !== 'undefined' ? window.location.origin : 'https://nochaf.ai';
                    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent('Join me on Nochaf AI! ' + url)}`, '_blank');
                  }}
                  className="py-2 px-3 rounded-xl border border-white/15 text-xs text-neutral-200 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  Twitter / X
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = typeof window !== 'undefined' ? window.location.origin : 'https://nochaf.ai';
                    window.open(`sms:?body=${encodeURIComponent('Join me on Nochaf AI: ' + url)}`, '_self');
                  }}
                  className="py-2 px-3 rounded-xl border border-white/15 text-xs text-neutral-200 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  SMS
                </button>
              </div>

              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  type="button"
                  onClick={() => {
                    const url = typeof window !== 'undefined' ? window.location.origin : 'https://nochaf.ai';
                    navigator
                      .share({
                        title: 'Join me on Nochaf AI',
                        text: 'Join me on Nochaf AI — voice-first assistant and messaging:',
                        url,
                      })
                      .catch(() => {});
                  }}
                  className="w-full py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-neutral-900 transition-colors cursor-pointer mt-1"
                >
                  More Share Options...
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowInviteFriendsModal(false)}
                className="w-full py-2 rounded-xl text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer border-t border-white/10 mt-1"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MEDIA SEND PREVIEW MODAL: Full picture with Crop tool, or video with Trim & Mute, and Send icon */}
      {/* ========================================================= */}
      {mediaSendPreview && (
        <div className="fixed inset-0 z-[120] flex flex-col justify-between bg-black/95 text-white animate-in fade-in duration-150 select-none backdrop-blur-md">
          {/* Top Bar: Close, Crop / Trim / Mute Controls */}
          <div className="flex items-center justify-between px-4 py-3 bg-neutral-900/90 border-b border-white/10 shrink-0 z-30">
            <button
              type="button"
              onClick={() => setMediaSendPreview(null)}
              className="p-2 rounded-full bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Cancel"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Tools depending on Media Type */}
            {mediaSendPreview.type === 'image' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setMediaSendPreview((prev) =>
                      prev ? { ...prev, isCropping: !prev.isCropping } : null
                    )
                  }
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                    mediaSendPreview.isCropping
                      ? 'bg-emerald-500 border-emerald-400 text-black'
                      : 'bg-neutral-800/90 border-white/15 text-white hover:bg-neutral-750'
                  }`}
                  title="Crop Photo"
                >
                  <Crop className="h-4 w-4" />
                  <span>Crop</span>
                </button>

                <button
                  type="button"
                  onClick={handleRotateImage}
                  className="p-2 rounded-full bg-neutral-800/90 text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors border border-white/10 cursor-pointer"
                  title="Rotate 90°"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Trim Tool Toggle */}
                <button
                  type="button"
                  onClick={() =>
                    setMediaSendPreview((prev) =>
                      prev ? { ...prev, isCropping: !prev.isCropping } : null
                    )
                  }
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                    mediaSendPreview.isCropping
                      ? 'bg-emerald-500 border-emerald-400 text-black'
                      : 'bg-neutral-800/90 border-white/15 text-white hover:bg-neutral-750'
                  }`}
                  title="Trim Video"
                >
                  <Scissors className="h-4 w-4" />
                  <span>Trim</span>
                </button>

                {/* Mute Tool Toggle */}
                <button
                  type="button"
                  onClick={() =>
                    setMediaSendPreview((prev) =>
                      prev ? { ...prev, isMuted: !prev.isMuted } : null
                    )
                  }
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                    mediaSendPreview.isMuted
                      ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                      : 'bg-neutral-800/90 border-white/15 text-white hover:bg-neutral-750'
                  }`}
                  title={mediaSendPreview.isMuted ? 'Unmute Audio' : 'Mute Audio'}
                >
                  {mediaSendPreview.isMuted ? (
                    <>
                      <VolumeX className="h-4 w-4" />
                      <span>Muted</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-4 w-4" />
                      <span>Sound on</span>
                    </>
                  )}
                </button>
              </div>
            )}

            <div className="w-9" />
          </div>

          {/* Secondary Bar: Active Crop Presets or Video Trim Slider */}
          {mediaSendPreview.isCropping && mediaSendPreview.type === 'image' && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-2 bg-neutral-900/95 border-b border-white/10 shrink-0 z-20 animate-in slide-in-from-top-2">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-[11px] text-neutral-400 mr-1 font-medium">Crop:</span>
                {(['free', '1:1', '4:3', '16:9'] as const).map((asp) => (
                  <button
                    key={asp}
                    type="button"
                    onClick={() => handleApplyCrop(asp)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                      mediaSendPreview.cropAspect === asp
                        ? 'bg-emerald-500 text-black font-bold shadow'
                        : 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
                    }`}
                  >
                    {asp === 'free' ? 'Free hand' : asp}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleResetCrop}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700 cursor-pointer transition-colors"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleApplyFreehandCrop}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 shadow-md cursor-pointer transition-transform active:scale-95"
                >
                  <Check className="h-3.5 w-3.5 stroke-[3]" />
                  <span>Apply Crop</span>
                </button>
              </div>
            </div>
          )}

          {mediaSendPreview.isCropping && mediaSendPreview.type === 'video' && (
            <div className="px-6 py-2.5 bg-neutral-900/95 border-b border-white/10 shrink-0 z-20 animate-in slide-in-from-top-2">
              <div className="flex items-center justify-between text-xs text-neutral-300 font-mono mb-1">
                <span>Trim Start: {mediaSendPreview.trimStartSec}s</span>
                <span>Trim End: {mediaSendPreview.trimEndSec}s</span>
                <span className="text-emerald-400 font-bold">
                  Duration: {Math.max(1, mediaSendPreview.trimEndSec - mediaSendPreview.trimStartSec)}s
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max={Math.max(1, mediaSendPreview.trimEndSec - 1)}
                  value={mediaSendPreview.trimStartSec}
                  onChange={(e) =>
                    setMediaSendPreview((prev) =>
                      prev
                        ? { ...prev, trimStartSec: Number(e.target.value) }
                        : null
                    )
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                  title="Trim start"
                />
                <input
                  type="range"
                  min={mediaSendPreview.trimStartSec + 1}
                  max={mediaSendPreview.videoDurationSec || 60}
                  value={mediaSendPreview.trimEndSec}
                  onChange={(e) =>
                    setMediaSendPreview((prev) =>
                      prev
                        ? { ...prev, trimEndSec: Number(e.target.value) }
                        : null
                    )
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                  title="Trim end"
                />
              </div>
            </div>
          )}

          {/* Center: Full Whole Picture / Video Preview */}
          <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-6 min-h-0 overflow-hidden relative">
            {mediaSendPreview.type === 'image' ? (
              <div
                ref={previewImageContainerRef}
                className="relative inline-block max-h-[62vh] max-w-full select-none"
              >
                <img
                  src={mediaSendPreview.items[mediaSendPreview.activeIndex]?.dataUrl}
                  alt="Preview"
                  className="max-h-[62vh] max-w-full object-contain rounded-xl shadow-2xl transition-all block pointer-events-none"
                />
                {mediaSendPreview.isCropping && (
                  /* Interactive Freehand Crop Box Overlay: drag with hand freely */
                  <div className="absolute inset-0 z-20 pointer-events-auto touch-none overflow-hidden rounded-xl">
                    {/* Dark dimmed overlay outside the crop rect */}
                    <div
                      className="absolute border-2 border-emerald-400 bg-emerald-500/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] cursor-move"
                      style={{
                        left: `${freeCropRect.x * 100}%`,
                        top: `${freeCropRect.y * 100}%`,
                        width: `${freeCropRect.width * 100}%`,
                        height: `${freeCropRect.height * 100}%`,
                      }}
                      onMouseDown={(e) => handleFreeCropPointerDown('move', e)}
                      onTouchStart={(e) => handleFreeCropPointerDown('move', e)}
                    >
                      {/* Grid lines inside crop box (Rule of thirds) */}
                      <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 opacity-40">
                        <div className="border-r border-b border-white/60" />
                        <div className="border-r border-b border-white/60" />
                        <div className="border-b border-white/60" />
                        <div className="border-r border-b border-white/60" />
                        <div className="border-r border-b border-white/60" />
                        <div className="border-b border-white/60" />
                        <div className="border-r border-b border-white/60" />
                        <div className="border-r border-b border-white/60" />
                        <div />
                      </div>

                      {/* 4 Corner handles - sized for easy touch dragging by hand */}
                      <div
                        onMouseDown={(e) => handleFreeCropPointerDown('nw', e)}
                        onTouchStart={(e) => handleFreeCropPointerDown('nw', e)}
                        className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-emerald-400 border-2 border-white shadow-xl cursor-nwse-resize touch-none flex items-center justify-center hover:scale-110 active:scale-95"
                        title="Drag corner freely"
                      />
                      <div
                        onMouseDown={(e) => handleFreeCropPointerDown('ne', e)}
                        onTouchStart={(e) => handleFreeCropPointerDown('ne', e)}
                        className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-emerald-400 border-2 border-white shadow-xl cursor-nesw-resize touch-none flex items-center justify-center hover:scale-110 active:scale-95"
                        title="Drag corner freely"
                      />
                      <div
                        onMouseDown={(e) => handleFreeCropPointerDown('sw', e)}
                        onTouchStart={(e) => handleFreeCropPointerDown('sw', e)}
                        className="absolute -bottom-3 -left-3 w-6 h-6 rounded-full bg-emerald-400 border-2 border-white shadow-xl cursor-nesw-resize touch-none flex items-center justify-center hover:scale-110 active:scale-95"
                        title="Drag corner freely"
                      />
                      <div
                        onMouseDown={(e) => handleFreeCropPointerDown('se', e)}
                        onTouchStart={(e) => handleFreeCropPointerDown('se', e)}
                        className="absolute -bottom-3 -right-3 w-6 h-6 rounded-full bg-emerald-400 border-2 border-white shadow-xl cursor-nwse-resize touch-none flex items-center justify-center hover:scale-110 active:scale-95"
                        title="Drag corner freely"
                      />

                      {/* 4 Edge handles */}
                      <div
                        onMouseDown={(e) => handleFreeCropPointerDown('n', e)}
                        onTouchStart={(e) => handleFreeCropPointerDown('n', e)}
                        className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-8 h-3 rounded-full bg-emerald-400 border border-white cursor-ns-resize touch-none"
                      />
                      <div
                        onMouseDown={(e) => handleFreeCropPointerDown('s', e)}
                        onTouchStart={(e) => handleFreeCropPointerDown('s', e)}
                        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-8 h-3 rounded-full bg-emerald-400 border border-white cursor-ns-resize touch-none"
                      />
                      <div
                        onMouseDown={(e) => handleFreeCropPointerDown('w', e)}
                        onTouchStart={(e) => handleFreeCropPointerDown('w', e)}
                        className="absolute top-1/2 -translate-y-1/2 -left-1.5 h-8 w-3 rounded-full bg-emerald-400 border border-white cursor-ew-resize touch-none"
                      />
                      <div
                        onMouseDown={(e) => handleFreeCropPointerDown('e', e)}
                        onTouchStart={(e) => handleFreeCropPointerDown('e', e)}
                        className="absolute top-1/2 -translate-y-1/2 -right-1.5 h-8 w-3 rounded-full bg-emerald-400 border border-white cursor-ew-resize touch-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <video
                src={mediaSendPreview.items[0]?.dataUrl}
                controls
                playsInline
                autoPlay
                loop
                muted={mediaSendPreview.isMuted}
                className="max-h-[62vh] max-w-full rounded-xl shadow-2xl bg-black"
              />
            )}

            {/* If multiple photos, thumbnail strip */}
            {mediaSendPreview.type === 'image' && mediaSendPreview.items.length > 1 && (
              <div className="flex items-center gap-2 mt-3 p-1.5 rounded-2xl bg-neutral-900/80 border border-white/10 max-w-full overflow-x-auto">
                {mediaSendPreview.items.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() =>
                      setMediaSendPreview((prev) =>
                        prev ? { ...prev, activeIndex: idx } : null
                      )
                    }
                    className={`h-12 w-12 rounded-xl overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                      mediaSendPreview.activeIndex === idx
                        ? 'border-emerald-400 scale-105 shadow-md'
                        : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={item.dataUrl} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bottom Bar: Caption Input & Circular Green Send Icon */}
          <div className="flex items-center gap-3 px-4 py-3 bg-neutral-900/90 border-t border-white/10 shrink-0 z-30">
            <input
              type="text"
              value={mediaSendPreview.caption}
              onChange={(e) =>
                setMediaSendPreview((prev) =>
                  prev ? { ...prev, caption: e.target.value } : null
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSendConfirmedMedia();
                }
              }}
              placeholder="Add a caption..."
              className="flex-1 bg-black/60 border border-white/15 rounded-full px-4 py-2.5 text-xs sm:text-sm text-white placeholder-neutral-400 focus:outline-none focus:border-emerald-400"
              autoFocus
            />

            <button
              type="button"
              onClick={handleSendConfirmedMedia}
              className="h-11 w-11 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white flex items-center justify-center shrink-0 shadow-lg active:scale-95 transition-all cursor-pointer"
              title="Send"
            >
              <Send className="h-5 w-5 ml-0.5" />
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* FULLSCREEN PICTURE & VIDEO VIEWER: Whole media on screen with direct Save to Gallery */}
      {/* ========================================================= */}
      {fullscreenMediaUrl && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black p-0 animate-in fade-in duration-150 select-none"
        >
          {/* Back arrow on top left side corner */}
          <button
            type="button"
            onClick={() => setFullscreenMediaUrl(null)}
            className="absolute top-4 left-4 z-[120] p-2.5 rounded-full bg-neutral-900/80 hover:bg-neutral-800 text-white cursor-pointer transition-colors backdrop-blur-md border border-white/10 flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95"
            title="Back"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>

          {/* Direct Save to Gallery button on top right corner */}
          <button
            type="button"
            onClick={() => saveMediaToGallery(fullscreenMediaUrl, fullscreenMediaType === 'video' ? 'video' : 'photo')}
            className="absolute top-4 right-4 z-[120] p-2.5 rounded-full bg-neutral-900/80 hover:bg-neutral-800 text-white cursor-pointer transition-colors backdrop-blur-md border border-white/10 flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95"
            title="Save directly to gallery"
          >
            <Download className="h-6 w-6" />
          </button>

          {fullscreenMediaType === 'video' || fullscreenMediaUrl.startsWith('data:video') || fullscreenMediaUrl.includes('.mp4') ? (
            <video
              src={fullscreenMediaUrl}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full bg-black"
            />
          ) : (
            <img
              src={fullscreenMediaUrl}
              alt="Full view"
              onClick={() => setFullscreenMediaUrl(null)}
              className="max-h-full max-w-full object-contain cursor-pointer"
            />
          )}
        </div>
      )}
    </div>
  );
};
