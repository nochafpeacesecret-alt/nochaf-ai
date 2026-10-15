export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  firstName?: string;
  secondName?: string;
  username: string;
  handle: string;
  avatar?: string;
  bio?: string;
  plan: 'free' | 'pro' | 'creator' | 'business';
  isPrivate: boolean;
  role: 'user' | 'admin';
  securityQuestion?: string;
  usernameSetupCompleted?: boolean;
  createdAt: string;
  followersCount?: number;
  followingCount?: number;
  isOnline?: boolean;
  lastSeen?: string;
  deviceId?: string;
  isMuted?: boolean;
  mutedUntil?: number;
  muteReason?: string;
  isShadowBanned?: boolean;
  isFlagged?: boolean;
  spamWarningCount?: number;
  reportCount?: number;
  hasPendingAppeal?: boolean;
}

export type ChatMode = 'general' | 'math' | 'story' | 'business';

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode?: ChatMode;
  messages?: ChatMessage[];
}

export interface MediaAttachment {
  id: string;
  type: 'image' | 'video';
  base64: string;
  mimeType: string;
  name: string;
  size?: string;
  intent?: 'query' | 'edit' | 'general';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  agentSteps?: string[];
  model?: string;
  taskType?: string;
  audioUrl?: string;
  attachments?: MediaAttachment[];
  imageBase64?: string;
  imageMimeType?: string;
  documentName?: string;
  documentSize?: string;
  documentContent?: string;
  documentMimeType?: string;
}

export interface AIMemory {
  id: string;
  userId: string;
  key: string;
  value: string;
  category: 'preference' | 'instruction' | 'context' | 'fact';
  createdAt: string;
}

export interface ProjectWorkspace {
  id: string;
  userId: string;
  name: string;
  description: string;
  notes: string;
  tasks: ProjectTask[];
  codeSnippets: ProjectSnippet[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
}

export interface ProjectSnippet {
  id: string;
  title: string;
  language: string;
  code: string;
}

export interface GeneratedImageItem {
  id: string;
  userId: string;
  prompt: string;
  imageUrl: string;
  aspectRatio: string;
  createdAt: string;
}

export interface DiscussionMessage {
  id: string;
  senderId: string;
  senderHandle: string;
  senderName: string;
  content: string;
  createdAt: string;
  timestamp: string;
}

export interface DirectMessageThread {
  id: string;
  participants: string[];
  participantHandles: string[];
  participantNames: string[];
  lastMessage?: string;
  updatedAt: string;
  createdAt: string;
  createdBy?: string;
}

export interface GroupDiscussionThread {
  id: string;
  name: string;
  createdBy: string;
  creatorHandle: string;
  members: string[]; // uids or handles
  memberHandles: string[]; // maximum 80
  maxMembers: number; // 80
  lastMessage?: string;
  updatedAt: string;
  createdAt: string;
}
