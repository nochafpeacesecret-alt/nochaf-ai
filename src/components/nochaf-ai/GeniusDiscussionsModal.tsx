import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  auth,
  db,
  collection,
  doc,
  setDoc,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  where,
  getDocs,
} from '../../lib/firebase';
import { DirectMessageThread, GroupDiscussionThread, DiscussionMessage } from '../../types';
import {
  Users,
  MessageSquare,
  UserPlus,
  Send,
  X,
  Search,
  ShieldCheck,
  Hash,
  AtSign,
  Plus,
  ChevronLeft,
  User,
} from 'lucide-react';

interface GeniusDiscussionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAuth: () => void;
  initialTab?: 'direct' | 'group';
}

export const GeniusDiscussionsModal: React.FC<GeniusDiscussionsModalProps> = ({
  isOpen,
  onClose,
  onOpenAuth,
  initialTab = 'direct',
}) => {
  const { user, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'direct' | 'group'>(initialTab);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Direct Message Threads
  const [dmThreads, setDmThreads] = useState<DirectMessageThread[]>([]);
  const [activeDm, setActiveDm] = useState<DirectMessageThread | null>(null);
  const [searchHandleInput, setSearchHandleInput] = useState('');
  const [directSearchError, setDirectSearchError] = useState<string | null>(null);

  // Group Discussion Threads (max 80 members)
  const [groups, setGroups] = useState<GroupDiscussionThread[]>([]);
  const [activeGroup, setActiveGroup] = useState<GroupDiscussionThread | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMemberInput, setNewGroupMemberInput] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Active Chat Messages
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Guest handle fallback if user is not signed in
  const [guestHandle, setGuestHandle] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('nochaf_guest_handle') || 'guest_' + Math.floor(1000 + Math.random() * 9000);
    }
    return 'guest_user';
  });

  const myHandle = profile?.handle
    ? (profile.handle.startsWith('@') ? profile.handle : '@' + profile.handle)
    : (guestHandle.startsWith('@') ? guestHandle : '@' + guestHandle);

  const myName = profile?.displayName || user?.displayName || 'Nochaf Member';
  const myUid = user?.uid || 'guest_' + guestHandle;

  // Auto scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load Direct Message Threads for current user
  useEffect(() => {
    if (!isOpen || !auth.currentUser || myUid.startsWith('guest_')) return;

    const q = query(collection(db, 'directMessages'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: DirectMessageThread[] = [];
        snap.forEach((d) => {
          const data = d.data() as DirectMessageThread;
          // Show threads where current user is a participant
          if (
            data.participants?.includes(myUid) ||
            data.participantHandles?.some((h) => h.toLowerCase() === myHandle.toLowerCase()) ||
            data.createdBy === myUid
          ) {
            list.push({ ...data, id: d.id });
          }
        });
        setDmThreads(list);
      },
      (err) => console.warn('Direct messages sync notice:', err.message)
    );

    return () => unsub();
  }, [isOpen, myUid, myHandle]);

  // Load Group Discussions for current user
  useEffect(() => {
    if (!isOpen || !auth.currentUser || myUid.startsWith('guest_')) return;

    const q = query(collection(db, 'groupDiscussions'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: GroupDiscussionThread[] = [];
        snap.forEach((d) => {
          const data = d.data() as GroupDiscussionThread;
          // Show groups where user is a member or creator
          if (
            data.members?.includes(myUid) ||
            data.memberHandles?.some((h) => h.toLowerCase() === myHandle.toLowerCase()) ||
            data.createdBy === myUid
          ) {
            list.push({ ...data, id: d.id });
          }
        });
        setGroups(list);
      },
      (err) => console.warn('Groups sync notice:', err.message)
    );

    return () => unsub();
  }, [isOpen, myUid, myHandle]);

  // Load messages for currently active Direct Message thread
  useEffect(() => {
    if (!activeDm || !auth.currentUser || myUid.startsWith('guest_')) return;

    const msgsRef = collection(db, 'directMessages', activeDm.id, 'messages');
    const q = query(msgsRef, orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: DiscussionMessage[] = [];
        snap.forEach((d) => {
          list.push({ ...(d.data() as DiscussionMessage), id: d.id });
        });
        setMessages(list);
      },
      (err) => console.warn('DM messages sync notice:', err.message)
    );

    return () => unsub();
  }, [activeDm?.id, myUid]);

  // Load messages for currently active Group Discussion
  useEffect(() => {
    if (!activeGroup || !auth.currentUser || myUid.startsWith('guest_')) return;

    const msgsRef = collection(db, 'groupDiscussions', activeGroup.id, 'messages');
    const q = query(msgsRef, orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: DiscussionMessage[] = [];
        snap.forEach((d) => {
          list.push({ ...(d.data() as DiscussionMessage), id: d.id });
        });
        setMessages(list);
      },
      (err) => console.warn('Group messages sync notice:', err.message)
    );

    return () => unsub();
  }, [activeGroup?.id, myUid]);

  // Start Direct Texting by @username
  const handleStartDirectChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setDirectSearchError(null);

    // Normalize: username = username.toLowerCase().replace(/[^a-z0-9_]/g,'').trim()
    const cleanInput = searchHandleInput.trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
    if (!cleanInput) return;

    const targetHandle = '@' + cleanInput;
    if (targetHandle.toLowerCase() === myHandle.toLowerCase()) {
      setDirectSearchError("You cannot start a direct message with your own username.");
      return;
    }

    try {
      // Find if an existing thread exists between both users
      const existing = dmThreads.find((t) =>
        t.participantHandles?.some((h) => h.toLowerCase() === targetHandle.toLowerCase())
      );

      if (existing) {
        setActiveDm(existing);
        setSearchHandleInput('');
        return;
      }

      // Check if target user exists in Firestore by username/handle
      let targetName = cleanInput;
      let targetUid = 'user_' + cleanInput;
      try {
        const usersRef = collection(db, 'users');
        const qUsers = query(usersRef, where('username', '==', cleanInput));
        let snap = await getDocs(qUsers);
        if (snap.empty) {
          const qFallback = query(usersRef, where('handle', '==', cleanInput));
          snap = await getDocs(qFallback);
        }
        if (!snap.empty) {
          const docData = snap.docs[0].data();
          targetName = docData.displayName || cleanInput;
          targetUid = snap.docs[0].id;
        }
      } catch (err) {
        console.warn('User lookup notice:', err);
      }

      // Create new DM thread document
      const newThreadRef = doc(collection(db, 'directMessages'));
      const newThreadData: any = {
        id: newThreadRef.id,
        participants: [myUid, targetUid],
        participantHandles: [myHandle, targetHandle],
        participantNames: [myName, targetName],
        lastMessage: `Started discussion with ${targetHandle}`,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        createdBy: myUid,
      };

      await setDoc(newThreadRef, newThreadData);
      setActiveDm({ id: newThreadRef.id, ...newThreadData });
      setSearchHandleInput('');
    } catch (err: any) {
      console.error('Failed to create direct message thread:', err);
      setDirectSearchError('Unable to start direct chat. Please check connection.');
    }
  };

  // Add a member to group discussion creation list (max 80)
  const handleAddMemberToNewGroup = () => {
    setGroupError(null);
    const clean = newGroupMemberInput.trim().replace(/^@+/, '');
    if (!clean) return;

    const formatted = '@' + clean.toLowerCase();

    // Check if max 80 members reached
    const currentTotal = newGroupMembers.length + 1; // +1 for creator
    if (currentTotal >= 80) {
      setGroupError('Maximum 80 people limit reached for group discussion.');
      return;
    }

    if (newGroupMembers.some((m) => m.toLowerCase() === formatted.toLowerCase())) {
      setGroupError(`${formatted} is already in the member list.`);
      return;
    }

    if (formatted.toLowerCase() === myHandle.toLowerCase()) {
      setGroupError('You are already included as the group creator.');
      return;
    }

    setNewGroupMembers([...newGroupMembers, formatted]);
    setNewGroupMemberInput('');
  };

  const handleRemoveMemberFromNewGroup = (handleToRemove: string) => {
    setNewGroupMembers(newGroupMembers.filter((m) => m !== handleToRemove));
  };

  // Create Group Discussion (max 80 people)
  const handleCreateGroupDiscussion = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupError(null);

    const name = newGroupName.trim();
    if (!name) {
      setGroupError('Please enter a group discussion title.');
      return;
    }

    const allMemberHandles = Array.from(new Set([myHandle, ...newGroupMembers]));
    if (allMemberHandles.length > 80) {
      setGroupError('Group discussion can have a maximum of 80 people.');
      return;
    }

    try {
      const newGroupRef = doc(collection(db, 'groupDiscussions'));
      const newGroupData: any = {
        id: newGroupRef.id,
        name,
        createdBy: myUid,
        creatorHandle: myHandle,
        members: [myUid],
        memberHandles: allMemberHandles,
        maxMembers: 80,
        lastMessage: `Group discussion created by ${myHandle}`,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      await setDoc(newGroupRef, newGroupData);
      setActiveGroup({ id: newGroupRef.id, ...newGroupData });
      setIsCreatingGroup(false);
      setNewGroupName('');
      setNewGroupMembers([]);
      setNewGroupMemberInput('');
    } catch (err: any) {
      console.error('Failed to create group:', err);
      setGroupError('Failed to create group. Please try again.');
    }
  };

  // Add more members to existing active group (up to 80)
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [addExistingMemberInput, setAddExistingMemberInput] = useState('');
  const [addExistingMemberError, setAddExistingMemberError] = useState<string | null>(null);

  const handleAddMemberToExistingGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup) return;
    setAddExistingMemberError(null);

    const clean = addExistingMemberInput.trim().replace(/^@+/, '');
    if (!clean) return;
    const formatted = '@' + clean.toLowerCase();

    if (activeGroup.memberHandles.length >= 80) {
      setAddExistingMemberError('Maximum 80 people limit reached for this group discussion.');
      return;
    }

    if (activeGroup.memberHandles.some((h) => h.toLowerCase() === formatted.toLowerCase())) {
      setAddExistingMemberError(`${formatted} is already a member of this group.`);
      return;
    }

    const updatedHandles = [...activeGroup.memberHandles, formatted];
    try {
      const groupRef = doc(db, 'groupDiscussions', activeGroup.id);
      await setDoc(
        groupRef,
        {
          memberHandles: updatedHandles,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      setActiveGroup({ ...activeGroup, memberHandles: updatedHandles });
      setAddExistingMemberInput('');
      setShowAddMemberModal(false);
    } catch (err: any) {
      setAddExistingMemberError('Failed to add member to group.');
    }
  };

  // Send message in active DM or Group
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = inputText.trim();
    if (!content) return;

    const newMsg: Omit<DiscussionMessage, 'id'> = {
      senderId: myUid,
      senderHandle: myHandle,
      senderName: myName,
      content,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setInputText('');

    try {
      if (activeDm) {
        const msgsRef = collection(db, 'directMessages', activeDm.id, 'messages');
        await addDoc(msgsRef, newMsg);

        // Update thread preview
        const threadRef = doc(db, 'directMessages', activeDm.id);
        await setDoc(
          threadRef,
          {
            lastMessage: `${myHandle}: ${content.slice(0, 45)}`,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } else if (activeGroup) {
        const msgsRef = collection(db, 'groupDiscussions', activeGroup.id, 'messages');
        await addDoc(msgsRef, newMsg);

        // Update group preview
        const groupRef = doc(db, 'groupDiscussions', activeGroup.id);
        await setDoc(
          groupRef,
          {
            lastMessage: `${myHandle}: ${content.slice(0, 45)}`,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn('Failed to send discussion message:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-5 animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-4xl h-[90vh] max-h-[820px] rounded-3xl border border-white/20 bg-black/95 shadow-2xl backdrop-blur-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-neutral-900/60">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-white text-black flex items-center justify-center shadow-lg font-black text-base">
              N
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-semibold text-white tracking-tight">
                  Discussions & Text Someone
                </h2>
                <span className="rounded-full bg-white text-black px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                  Community Network
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                Text peers by <span className="text-white font-mono">@username</span> or join discussions of up to 80 people
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/15 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 font-mono">
              <span className="text-neutral-500">Your handle:</span>
              <span className="text-white font-semibold">{myHandle}</span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Inner Content Area */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar / Left Navigation */}
          <div className="w-80 border-r border-white/10 flex flex-col bg-neutral-950/40 shrink-0">
            {/* Tabs: Direct vs Group Discussions */}
            <div className="flex items-center p-2.5 border-b border-white/10 gap-1 bg-neutral-900/30">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('direct');
                  setActiveGroup(null);
                  setIsCreatingGroup(false);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'direct'
                    ? 'bg-white text-black shadow-md'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
                }`}
              >
                <AtSign className="h-3.5 w-3.5" />
                <span>Direct (@)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('group');
                  setActiveDm(null);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'group'
                    ? 'bg-white text-black shadow-md'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Groups (Max 80)</span>
              </button>
            </div>

            {/* DIRECT MESSAGES TAB CONTENT */}
            {activeTab === 'direct' && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Search / Text Person by @username form */}
                <form onSubmit={handleStartDirectChat} className="p-3 border-b border-white/10 space-y-2">
                  <div className="relative flex items-center">
                    <AtSign className="absolute left-2.5 h-3.5 w-3.5 text-neutral-400" />
                    <input
                      type="text"
                      value={searchHandleInput}
                      onChange={(e) => setSearchHandleInput(e.target.value)}
                      placeholder="Text someone: enter @username"
                      className="w-full rounded-xl border border-white/15 bg-neutral-900 pl-8 pr-8 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white"
                    />
                    <button
                      type="submit"
                      disabled={!searchHandleInput.trim()}
                      className="absolute right-1.5 p-1 rounded-lg bg-white text-black disabled:opacity-30 hover:bg-neutral-200 transition-colors"
                      title="Start direct texting"
                    >
                      <Send className="h-3 w-3" />
                    </button>
                  </div>
                  {directSearchError && (
                    <p className="text-[10px] text-white font-medium px-1 bg-neutral-900 p-1 rounded">{directSearchError}</p>
                  )}
                </form>

                {/* Direct Messages Thread List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {dmThreads.length === 0 ? (
                    <div className="py-12 px-4 text-center text-xs text-neutral-500 space-y-2">
                      <MessageSquare className="h-8 w-8 mx-auto text-neutral-600" />
                      <p>No direct conversations yet.</p>
                      <p className="text-[11px] text-neutral-500">
                        Type any Nochaf AI user's <span className="text-white font-mono">@handle</span> above to start texting!
                      </p>
                    </div>
                  ) : (
                    dmThreads.map((thread) => {
                      const otherHandle =
                        thread.participantHandles?.find((h) => h.toLowerCase() !== myHandle.toLowerCase()) ||
                        thread.participantHandles?.[0] ||
                        '@peer';
                      const isSelected = activeDm?.id === thread.id;

                      return (
                        <div
                          key={thread.id}
                          onClick={() => setActiveDm(thread)}
                          className={`flex items-center gap-2.5 rounded-2xl p-2.5 text-xs transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-neutral-800 border border-white/20 text-white shadow-sm'
                              : 'text-neutral-300 hover:bg-neutral-900/80 hover:text-white border border-transparent'
                          }`}
                        >
                          <div className="h-8 w-8 rounded-full bg-neutral-800 border border-white/20 flex items-center justify-center text-neutral-300 shrink-0">
                            <User className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold truncate text-white">{otherHandle}</span>
                              <span className="text-[9px] text-neutral-500 font-mono">
                                {new Date(thread.updatedAt || thread.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-400 truncate">{thread.lastMessage || 'Open direct chat'}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* GROUPS TAB CONTENT */}
            {activeTab === 'group' && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Create Group Button */}
                <div className="p-3 border-b border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingGroup(true);
                      setActiveGroup(null);
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-neutral-200 text-black py-2 px-3 text-xs font-semibold shadow-md transition-all cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>New Group Discussion</span>
                  </button>
                </div>

                {/* Group Discussion List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {groups.length === 0 ? (
                    <div className="py-12 px-4 text-center text-xs text-neutral-500 space-y-2">
                      <Users className="h-8 w-8 mx-auto text-neutral-600" />
                      <p>No group discussions yet.</p>
                      <p className="text-[11px] text-neutral-500">
                        Create a group of up to <span className="text-white font-semibold">80 people</span> and add members by <span className="text-white font-mono">@username</span>!
                      </p>
                    </div>
                  ) : (
                    groups.map((grp) => {
                      const isSelected = activeGroup?.id === grp.id;
                      const memberCount = grp.memberHandles?.length || 1;

                      return (
                        <div
                          key={grp.id}
                          onClick={() => {
                            setActiveGroup(grp);
                            setIsCreatingGroup(false);
                          }}
                          className={`flex items-center gap-2.5 rounded-2xl p-2.5 text-xs transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-neutral-800 border border-white/20 text-white shadow-sm'
                              : 'text-neutral-300 hover:bg-neutral-900/80 hover:text-white border border-transparent'
                          }`}
                        >
                          <div className="h-8 w-8 rounded-full bg-neutral-800 border border-white/20 flex items-center justify-center font-bold text-white uppercase text-[11px] shrink-0">
                            <Hash className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold truncate text-white">{grp.name}</span>
                              <span className="rounded-full bg-neutral-800 border border-white/10 px-1.5 py-0.2 text-[9px] font-mono text-white font-bold">
                                {memberCount}/80
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-400 truncate">{grp.lastMessage || 'Group discussion active'}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Chat / Detail View on Right */}
          <div className="flex-1 flex flex-col min-h-0 bg-neutral-950 relative">
            {/* 1. CREATING NEW GROUP DISCUSSION VIEW */}
            {isCreatingGroup ? (
              <div className="flex-1 flex flex-col p-6 overflow-y-auto max-w-xl mx-auto w-full">
                <div className="flex items-center gap-2 pb-4 border-b border-white/10 mb-5">
                  <button
                    onClick={() => setIsCreatingGroup(false)}
                    className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <h3 className="text-base font-semibold text-white">Create Group Discussion</h3>
                    <p className="text-xs text-neutral-400">Add up to 80 people using their @username</p>
                  </div>
                </div>

                <form onSubmit={handleCreateGroupDiscussion} className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-neutral-300">Group Discussion Title</label>
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="e.g. AI Strategy & Quantum Research"
                      className="w-full rounded-xl border border-white/15 bg-neutral-900 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white"
                    />
                  </div>

                  {/* Add Members by @username */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-neutral-300">
                        Add People by Username (@)
                      </label>
                      <span className="text-[11px] font-mono text-white font-semibold">
                        {newGroupMembers.length + 1} / 80 members (max)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <AtSign className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                        <input
                          type="text"
                          value={newGroupMemberInput}
                          onChange={(e) => setNewGroupMemberInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddMemberToNewGroup();
                            }
                          }}
                          placeholder="Type @username to add (e.g. @peace)"
                          className="w-full rounded-xl border border-white/15 bg-neutral-900 pl-8 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleAddMemberToNewGroup}
                        className="rounded-xl bg-white hover:bg-neutral-200 text-black px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Add
                      </button>
                    </div>

                    {/* Member chips */}
                    <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-3 min-h-[90px] flex flex-wrap gap-1.5 items-start">
                      {/* Creator badge */}
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-800 border border-white/20 px-2.5 py-1 text-xs text-white">
                        <ShieldCheck className="h-3 w-3 text-white" />
                        <span>{myHandle} (Creator)</span>
                      </span>

                      {newGroupMembers.map((handle) => (
                        <span
                          key={handle}
                          className="inline-flex items-center gap-1.5 rounded-full bg-neutral-800 border border-white/15 px-2.5 py-1 text-xs text-white"
                        >
                          <span>{handle}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveMemberFromNewGroup(handle)}
                            className="text-neutral-400 hover:text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}

                      {newGroupMembers.length === 0 && (
                        <span className="text-xs text-neutral-500 italic py-2">
                          No members added yet. Type @username and click Add.
                        </span>
                      )}
                    </div>
                  </div>

                  {groupError && (
                    <div className="rounded-xl bg-neutral-900 border border-white/20 p-2.5 text-xs text-white font-medium">
                      {groupError}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setIsCreatingGroup(false)}
                      className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!newGroupName.trim()}
                      className="rounded-xl bg-white hover:bg-neutral-200 text-black px-5 py-2 text-xs font-semibold disabled:opacity-40 transition-all cursor-pointer"
                    >
                      Create Discussion ({newGroupMembers.length + 1}/80 People)
                    </button>
                  </div>
                </form>
              </div>
            ) : activeDm || activeGroup ? (
              /* 2. ACTIVE CHAT THREAD (Direct Message or Group Discussion) */
              <div className="flex-1 flex flex-col min-h-0">
                {/* Active Chat Top Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-neutral-900/50">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-neutral-800 border border-white/20 flex items-center justify-center text-neutral-300 text-xs">
                      {activeDm ? <User className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        {activeDm
                          ? activeDm.participantHandles?.find((h) => h.toLowerCase() !== myHandle.toLowerCase()) || '@peer'
                          : activeGroup?.name}
                      </h3>
                      <p className="text-[11px] text-neutral-400">
                        {activeDm
                          ? 'Direct text conversation'
                          : `${activeGroup?.memberHandles.length || 1}/80 Members • Group Discussion`}
                      </p>
                    </div>
                  </div>

                  {activeGroup && (
                    <button
                      type="button"
                      onClick={() => setShowAddMemberModal(true)}
                      className="flex items-center gap-1.5 rounded-full border border-white/20 bg-neutral-900 hover:bg-neutral-800 px-3 py-1 text-xs text-white transition-colors cursor-pointer"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>Add People ({activeGroup.memberHandles.length}/80)</span>
                    </button>
                  )}
                </div>

                {/* Messages Stream */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
                  {messages.length === 0 ? (
                    <div className="py-20 text-center text-xs text-neutral-500 space-y-2">
                      <p>No messages yet in this discussion.</p>
                      <p className="text-[11px] text-neutral-400">Send the first text below!</p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMe = msg.senderId === myUid || msg.senderHandle.toLowerCase() === myHandle.toLowerCase();

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
                        >
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-[10px] font-mono text-neutral-300 font-semibold">
                              {msg.senderHandle}
                            </span>
                            <span className="text-[9px] text-neutral-500 font-mono">{msg.timestamp}</span>
                          </div>

                          <div
                            className={`rounded-2xl px-4 py-2 text-xs max-w-[85%] sm:max-w-[75%] leading-relaxed ${
                              isMe
                                ? 'bg-white text-black font-normal rounded-tr-sm'
                                : 'bg-neutral-900 border border-white/10 text-neutral-200 rounded-tl-sm'
                            }`}
                          >
                            <p className="whitespace-pre-wrap select-text">{msg.content}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Chat Input Bar */}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 border-t border-white/10 bg-neutral-900/60 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={
                      activeDm
                        ? `Message ${activeDm.participantHandles?.find((h) => h.toLowerCase() !== myHandle.toLowerCase()) || '@peer'}...`
                        : `Message group (${activeGroup?.memberHandles.length}/80 members)...`
                    }
                    className="flex-1 rounded-xl border border-white/15 bg-neutral-950 px-3.5 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-white hover:bg-neutral-200 text-black disabled:opacity-30 transition-colors shadow shrink-0 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            ) : (
              /* 3. EMPTY STATE / SELECTION PROMPT */
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="h-16 w-16 rounded-3xl bg-neutral-900/90 border border-white/10 flex items-center justify-center text-white shadow-xl font-black text-2xl">
                  N
                </div>
                <h3 className="text-base font-semibold text-white">Select or Start a Discussion</h3>
                <p className="text-xs text-neutral-400 max-w-sm leading-relaxed">
                  Enter a person's <span className="text-white font-mono">@username</span> on the left to text them directly, or create a group discussion of up to <span className="text-white font-semibold">80 people</span>.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Modal: Add Member to Existing Group Discussion (max 80) */}
        {showAddMemberModal && activeGroup && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowAddMemberModal(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-white/20 bg-neutral-900 p-5 space-y-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <h4 className="text-sm font-semibold text-white">Add People to {activeGroup.name}</h4>
                <button
                  onClick={() => setShowAddMemberModal(false)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="text-xs text-neutral-400 flex justify-between">
                <span>Current members:</span>
                <span className="font-mono text-white font-semibold">
                  {activeGroup.memberHandles.length} / 80 maximum
                </span>
              </div>

              <form onSubmit={handleAddMemberToExistingGroup} className="space-y-3">
                <div className="relative">
                  <AtSign className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                  <input
                    type="text"
                    value={addExistingMemberInput}
                    onChange={(e) => setAddExistingMemberInput(e.target.value)}
                    placeholder="Enter person's @username"
                    className="w-full rounded-xl border border-white/15 bg-neutral-950 pl-8 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white"
                  />
                </div>

                {addExistingMemberError && (
                  <p className="text-xs text-white font-medium">{addExistingMemberError}</p>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddMemberModal(false)}
                    className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!addExistingMemberInput.trim() || activeGroup.memberHandles.length >= 80}
                    className="rounded-xl bg-white hover:bg-neutral-200 text-black px-4 py-1.5 text-xs font-semibold disabled:opacity-40"
                  >
                    Add Member
                  </button>
                </div>
              </form>

              {/* Current member handles list */}
              <div className="space-y-1.5 pt-2 border-t border-white/10">
                <span className="text-[10px] font-mono uppercase text-neutral-500">Group Members:</span>
                <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1 p-2 rounded-xl bg-neutral-950/60 border border-white/5">
                  {activeGroup.memberHandles.map((h) => (
                    <span
                      key={h}
                      className="rounded-full bg-neutral-800 border border-white/10 px-2 py-0.5 text-[10px] text-neutral-300 font-mono"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
