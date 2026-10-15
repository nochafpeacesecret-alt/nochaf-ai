import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  User as UserIcon,
  LogOut,
  ChevronDown,
  MessageSquare,
  ArrowLeft,
} from 'lucide-react';

interface NavbarProps {
  onOpenAuth: () => void;
  onOpenAdmin: () => void;
  showAdminTab: boolean;
  isAdminView: boolean;
  setIsAdminView: (val: boolean) => void;
  currentView?: 'ai' | 'messages' | 'admin';
  onSelectView?: (view: 'ai' | 'messages' | 'admin') => void;
  inActiveConversation?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenAuth,
  onOpenAdmin,
  showAdminTab,
  isAdminView,
  setIsAdminView,
  currentView = 'ai',
  onSelectView,
  inActiveConversation = false,
}) => {
  const { user, profile, signOut } = useAuth();
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // In the text someone page: shows letter N as normal for 2 seconds, then changes to back arrow
  const [showBackArrow, setShowBackArrow] = useState(false);

  useEffect(() => {
    if (currentView === 'messages') {
      setShowBackArrow(false);
      const timer = setTimeout(() => {
        setShowBackArrow(true);
      }, 2000); // exactly 2 seconds
      return () => clearTimeout(timer);
    } else {
      setShowBackArrow(false);
    }
  }, [currentView]);

  // Close dropdown when tapping anywhere on the screen
  useEffect(() => {
    if (!showUserDropdown) return;

    const handleScreenClick = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleScreenClick);
    document.addEventListener('touchstart', handleScreenClick);

    return () => {
      document.removeEventListener('mousedown', handleScreenClick);
      document.removeEventListener('touchstart', handleScreenClick);
    };
  }, [showUserDropdown]);

  const handleLogoClick = () => {
    setIsAdminView(false);
    onSelectView?.('ai');
  };

  // When inside a conversation: hide the top Nochaf AI and sign out completely
  if (currentView === 'messages' && inActiveConversation) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-[#0a0a0d]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo strictly: Nochaf.AI */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleLogoClick}
            className="flex items-center gap-2.5 group text-left cursor-pointer"
            title={showBackArrow ? 'Back to Nochaf.AI' : 'Nochaf.AI'}
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-neutral-200 via-neutral-400 to-neutral-700 p-0.5 shadow-md shadow-white/5 transition-transform group-hover:scale-105">
              <div className="flex h-full w-full items-center justify-center rounded-[7px] bg-[#0a0a0d]">
                {showBackArrow ? (
                  <ArrowLeft className="h-4 w-4 text-white animate-in zoom-in-75 duration-300 transition-transform group-hover:-translate-x-0.5" />
                ) : (
                  <span className="font-mono text-sm font-extrabold tracking-wider text-white">N</span>
                )}
              </div>
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-white text-base sm:text-lg">Nochaf.AI</span>
            </div>
          </button>
        </div>

        {/* Right Action Controls: Hidden in messages view to have nothing on its right side */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {currentView === 'messages' ? null : (
            <>
              {/* Top right corner icon: User Profile / Auth State */}
              {user ? (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setShowUserDropdown((prev) => !prev)}
                    className="flex items-center gap-2 rounded-full border border-white/15 bg-neutral-900 p-1 pr-3 text-xs text-neutral-200 hover:border-white/30 transition-colors cursor-pointer"
                    aria-expanded={showUserDropdown}
                    title="Account menu"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-neutral-700 to-neutral-400 text-neutral-200 font-bold text-xs overflow-hidden shrink-0">
                      {profile?.avatar ? (
                        <img
                          src={profile.avatar}
                          alt={profile?.displayName || ''}
                          className="h-full w-full object-cover rounded-full"
                        />
                      ) : (
                        <UserIcon className="h-4 w-4 text-neutral-300" />
                      )}
                    </div>
                    <span className="hidden max-w-[100px] truncate sm:inline font-medium">
                      {profile?.displayName || (profile?.handle ? profile.handle.replace(/^@+/, '') : '')}
                    </span>
                    <ChevronDown className="h-3 w-3 text-neutral-400" />
                  </button>

                  {showUserDropdown && (
                    <div className="absolute right-0 mt-2 w-52 rounded-xl border border-white/15 bg-[#121217] p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                      <div className="px-3 py-2 border-b border-white/10">
                        <p className="text-xs font-semibold text-white truncate">{profile?.displayName || 'Nochaf Member'}</p>
                        <p className="text-[11px] text-neutral-400 truncate">@{profile?.handle || profile?.username || 'member'}</p>
                      </div>

                      <button
                        onClick={() => {
                          setShowUserDropdown(false);
                          setIsAdminView(false);
                          onSelectView?.('messages');
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer mt-1"
                      >
                        <MessageSquare className="h-3.5 w-3.5 text-neutral-400" />
                        <span>Text someone</span>
                      </button>

                      <button
                        onClick={async () => {
                          setShowUserDropdown(false);
                          await signOut();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors mt-0.5 cursor-pointer"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={onOpenAuth}
                  className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-4 py-1.5 text-xs font-semibold text-black transition-all hover:bg-white hover:shadow-[0_0_15px_rgba(255,255,255,0.2)] cursor-pointer"
                >
                  <UserIcon className="h-3.5 w-3.5" />
                  <span>Sign In</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
};

