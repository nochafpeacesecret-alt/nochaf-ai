import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { auth, db, doc, getDoc, collection, query, where, getDocs } from '../../lib/firebase';
import {
  Lock,
  User as UserIcon,
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  X,
  KeyRound,
  HelpCircle,
  Shield,
  ShieldCheck,
  RotateCcw,
  Check,
} from 'lucide-react';
import { SECURITY_QUESTIONS } from '../../utils/security';
import { findExistingAccountByGoogleEmail, verifyDeviceSignupEligibility } from '../../utils/antiSpam';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: MainAuthMode;
}

type MainAuthMode = 'login' | 'create_account' | 'forgot_password' | 'google_setup' | 'google_account_picker';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialMode }) => {
  const {
    signInUsername,
    signUpUsername,
    getSecurityQuestionByUsername,
    verifySecurityAnswerAndResetPassword,
    completeGoogleUsernameSetup,
    signInGoogle,
    formatAuthError,
    error,
    clearError,
  } = useAuth();

  // Primary mode: 'login' | 'create_account' | 'forgot_password' | 'google_setup'
  const [mainMode, setMainMode] = useState<MainAuthMode>(initialMode || 'create_account');

  // Form Fields for Account Creation
  const [fullName, setFullName] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [isCustomQuestion, setIsCustomQuestion] = useState(false);
  const [customQuestionText, setCustomQuestionText] = useState('');

  // 3-Second Hold Human Verification State for Account Creation
  const [holdProgress, setHoldProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const holdTimerRef = useRef<any>(null);
  const holdIntervalRef = useRef<any>(null);

  // Real logged in account (if previously logged in; empty if not yet logged in)
  const [lastRealAccount] = useState<{
    name?: string;
    email?: string;
    avatar?: string;
    handle?: string;
  } | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nochaf_last_real_account');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return null;
  });

  // Password Visibility Toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Forgot Password 3-Step State
  // Step 1: Enter Username -> fetch question
  // Step 2: Answer question -> verify answer
  // Step 3: Create & confirm new password -> update and log in
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [retrievedQuestion, setRetrievedQuestion] = useState('');
  const [recoveryAnswerInput, setRecoveryAnswerInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  // Google Setup Fields
  const [googleNameInput, setGoogleNameInput] = useState('');
  const [googleUsernameInput, setGoogleUsernameInput] = useState('');
  const [googleSecurityQuestion, setGoogleSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [googleSecurityAnswer, setGoogleSecurityAnswer] = useState('');
  const [isGoogleCustomQuestion, setIsGoogleCustomQuestion] = useState(false);
  const [googleCustomQuestionText, setGoogleCustomQuestionText] = useState('');

  // UI State
  const [loading, setLoading] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showWrongPasswordForgotPrompt, setShowWrongPasswordForgotPrompt] = useState(false);

  // Auto-dismiss notices after 3 seconds
  useEffect(() => {
    if (localError) {
      const timer = setTimeout(() => {
        setLocalError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [localError]);

  useEffect(() => {
    if (feedbackSuccess) {
      const timer = setTimeout(() => {
        setFeedbackSuccess(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [feedbackSuccess]);

  // Success Popup Modal ("Account Created!")
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [createdUserName, setCreatedUserName] = useState('');
  const [redirectCountdown, setRedirectCountdown] = useState(3);

  const autoRedirectTimerRef = useRef<any>(null);

  // Full reset of all forms and sub-states
  const resetAllState = () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    setHoldProgress(0);
    setIsHolding(false);

    setMainMode(initialMode || 'login');
    setFullName('');
    setUsernameInput('');
    setPassword('');
    setConfirmPassword('');
    setSecurityQuestion(SECURITY_QUESTIONS[0]);
    setSecurityAnswer('');
    setIsCustomQuestion(false);
    setCustomQuestionText('');
    setShowPassword(false);
    setShowConfirmPassword(false);

    setForgotStep(1);
    setRecoveryUsername('');
    setRetrievedQuestion('');
    setRecoveryAnswerInput('');
    setNewPassword('');
    setConfirmNewPassword('');
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);

    setGoogleNameInput('');
    setGoogleUsernameInput('');
    setGoogleSecurityQuestion(SECURITY_QUESTIONS[0]);
    setGoogleSecurityAnswer('');
    setIsGoogleCustomQuestion(false);
    setGoogleCustomQuestionText('');

    setFeedbackSuccess(null);
    setLocalError(null);
    setShowWrongPasswordForgotPrompt(false);
    setShowSuccessPopup(false);
    clearError();
  };

  useEffect(() => {
    if (isOpen) {
      resetAllState();
      if (initialMode) {
        setMainMode(initialMode);
      }
    } else {
      resetAllState();
      if (autoRedirectTimerRef.current) clearInterval(autoRedirectTimerRef.current);
    }
  }, [isOpen, initialMode]);

  const handleModalClose = () => {
    resetAllState();
    onClose();
  };

  // Handle countdown for Success Popup Modal
  useEffect(() => {
    if (showSuccessPopup) {
      setRedirectCountdown(3);
      autoRedirectTimerRef.current = setInterval(() => {
        setRedirectCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(autoRedirectTimerRef.current);
            setShowSuccessPopup(false);
            onClose();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (autoRedirectTimerRef.current) clearInterval(autoRedirectTimerRef.current);
      };
    }
  }, [showSuccessPopup]);

  if (!isOpen) return null;

  // -------------------------------------------------------------
  // 1. CREATE ACCOUNT (Username, Password & Security Question)
  // -------------------------------------------------------------
  const validateCreateForm = (): boolean => {
    const cleanName = fullName.trim();
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const cleanAns = securityAnswer.trim();

    if (!cleanName) {
      setLocalError('Please enter your Name.');
      return false;
    }

    if (cleanName.toLowerCase() === 'user') {
      setLocalError('"user" is not allowed as a Name. Please enter your real Name.');
      return false;
    }

    if (!cleanUser) {
      setLocalError('Please enter a Username.');
      return false;
    }

    if (!/^[a-z]/.test(cleanUser)) {
      setLocalError('Username must always start with a lowercase letter (a-z).');
      return false;
    }

    if (cleanUser.length < 3) {
      setLocalError('Username must be at least 3 characters.');
      return false;
    }

    if (!/^[a-z][a-z0-9_]*$/.test(cleanUser)) {
      setLocalError('Username may only contain lowercase letters, numbers, and underscores.');
      return false;
    }

    if (cleanUser.toLowerCase() === 'user') {
      setLocalError('"user" is not allowed as a Username. Please choose a unique Username.');
      return false;
    }

    const hasLength = password.length >= 8 && password.length <= 20;
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^a-zA-Z0-9]/.test(password);

    if (!hasLength) {
      setLocalError('Password must contain between 8 and 20 characters.');
      return false;
    }

    if (!hasLetter || !hasNumber) {
      setLocalError('Password must contain both letters and numbers.');
      return false;
    }

    if (!hasSpecial) {
      setLocalError('Password must contain at least one special character (e.g. !@#$%).');
      return false;
    }

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match. Please ensure both passwords match.');
      return false;
    }

    const finalQuestion = isCustomQuestion ? customQuestionText.trim() : securityQuestion.trim();
    if (!finalQuestion) {
      setLocalError(isCustomQuestion ? 'Please enter your custom question.' : 'Please choose a recovery question.');
      return false;
    }

    if (!cleanAns) {
      setLocalError('Please enter your answer for the recovery question.');
      return false;
    }

    return true;
  };

  const executeCreateAccount = async () => {
    clearError();
    setLocalError(null);

    if (!validateCreateForm()) {
      return;
    }

    const cleanName = fullName.trim();
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const cleanAns = securityAnswer.trim();
    const finalQuestion = isCustomQuestion ? customQuestionText.trim() : securityQuestion.trim();

    setLoading(true);
    try {
      await signUpUsername({
        name: cleanName,
        username: cleanUser,
        password,
        securityQuestion: finalQuestion,
        securityAnswer: cleanAns,
      });
      setCreatedUserName(cleanName);
      setShowSuccessPopup(true);
    } catch (err: any) {
      setLocalError(err.message || 'Failed to create account.');
    } finally {
      setLoading(false);
      setHoldProgress(0);
      setIsHolding(false);
    }
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    executeCreateAccount();
  };

  // Human verification: Hold button option or tap to create account
  const handleHoldStart = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (loading) return;

    if (!validateCreateForm()) {
      return;
    }

    clearError();
    setLocalError(null);
    setIsHolding(true);
    setHoldProgress(0);

    const startTime = Date.now();
    const duration = 2000;

    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setHoldProgress(pct);
    }, 50);

    holdTimerRef.current = setTimeout(() => {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      setHoldProgress(100);
      setIsHolding(false);
      executeCreateAccount();
    }, duration);
  };

  const handleHoldCancel = (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (isHolding) {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      setIsHolding(false);
      setHoldProgress(0);
    }
  };

  // 2. LOG IN FLOW (Username & Password)
  // -------------------------------------------------------------
  const handleLogIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);
    setShowWrongPasswordForgotPrompt(false);

    const rawInput = usernameInput.trim();
    if (!rawInput) {
      setLocalError('Please enter your username.');
      return;
    }

    const cleanUser = rawInput.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    if (!rawInput.includes('@') && !/^[a-z]/.test(cleanUser)) {
      setLocalError('Username must always start with a lowercase letter (a-z).');
      return;
    }

    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      await signInUsername(cleanUser, password);
      onClose();
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('credential')) {
        setShowWrongPasswordForgotPrompt(true);
      }
      setLocalError(msg);
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------
  // 3. GOOGLE SIGN IN (LAYER 2: Google = 1 account only forever)
  // -------------------------------------------------------------
  const handleGoogleSignIn = async () => {
    clearError();
    setLocalError(null);
    setLoading(true);
    try {
      await signInGoogle();
      const currentUser = auth.currentUser;
      if (currentUser && currentUser.email) {
        // LAYER 2 - Check if googleEmail already exists in /usersPrivate or /users -> don't create new, login to old!
        const existing = await findExistingAccountByGoogleEmail(currentUser.email);
        if (existing?.exists && existing.existingUid) {
          // One Gmail = One Nochaf account forever. Log into existing account immediately
          onClose();
          return;
        }

        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        const data = userDoc.data();
        if (!userDoc.exists() || !data?.usernameSetupCompleted) {
          // LAYER 1 & 3: Check device limits before allowing username setup
          const deviceCheck = await verifyDeviceSignupEligibility();
          if (!deviceCheck.allowed) {
            setLocalError(deviceCheck.reason || 'Too many accounts on this phone. Use existing account.');
            setLoading(false);
            return;
          }

          // First time or username not created yet: ask user to choose Name & Username
          const incomingDisplayName = currentUser.displayName || '';
          const safeName = incomingDisplayName.toLowerCase() === 'user' ? '' : incomingDisplayName;
          setGoogleNameInput(safeName);

          const suggested = safeName
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '')
            .trim();
          setGoogleUsernameInput(suggested === 'user' ? '' : suggested);
          setMainMode('google_setup');
          setLoading(false);
          return;
        }
      }
      onClose();
    } catch (err: any) {
      setLocalError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // Complete Google Username & Name Creation
  const handleCompleteGoogleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);

    const cleanName = googleNameInput.trim();
    if (!cleanName) {
      setLocalError('Please enter your Name.');
      return;
    }
    if (cleanName.toLowerCase() === 'user') {
      setLocalError('"user" is not allowed. Please enter your real Name.');
      return;
    }

    const cleanUser = googleUsernameInput.trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    if (!cleanUser || cleanUser.length < 3) {
      setLocalError('Username must be at least 3 characters (letters, numbers, or underscore).');
      return;
    }
    if (!/^[a-z]/.test(cleanUser)) {
      setLocalError('Username must always start with a lowercase letter (a-z).');
      return;
    }
    if (cleanUser.toLowerCase() === 'user') {
      setLocalError('"user" is not allowed as a username. Please choose a unique username.');
      return;
    }

    const finalGoogleQuestion = isGoogleCustomQuestion ? googleCustomQuestionText.trim() : googleSecurityQuestion.trim();
    if (!finalGoogleQuestion) {
      setLocalError(isGoogleCustomQuestion ? 'Please enter your custom question.' : 'Please select a security question for account recovery.');
      return;
    }

    if (!googleSecurityAnswer.trim()) {
      setLocalError('Please enter your answer for account recovery.');
      return;
    }

    setLoading(true);
    try {
      await completeGoogleUsernameSetup(
        cleanUser,
        cleanName,
        finalGoogleQuestion,
        googleSecurityAnswer.trim()
      );
      setCreatedUserName(cleanName);
      setShowSuccessPopup(true);
    } catch (err: any) {
      setLocalError(err.message || 'Failed to complete username setup.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------
  // 4. FORGOT PASSWORD (Security Question & Reset Flow)
  // -------------------------------------------------------------
  // Step 1: Look up account by Username
  const handleLookupRecoveryUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);

    const cleanUser = recoveryUsername.trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    if (!cleanUser) {
      setLocalError('Please enter your username.');
      return;
    }

    if (!/^[a-z]/.test(cleanUser)) {
      setLocalError('Username must always start with a lowercase letter (a-z).');
      return;
    }

    setLoading(true);
    try {
      const result = await getSecurityQuestionByUsername(cleanUser);
      if (result.question) {
        setRetrievedQuestion(result.question);
        setForgotStep(2);
      } else {
        setLocalError(`No security question found for @${cleanUser}.`);
      }
    } catch (err: any) {
      setLocalError(err.message || `No account found with username @${cleanUser}.`);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify Security Answer
  const handleVerifySecurityAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);

    const cleanAnswer = recoveryAnswerInput.trim();
    if (!cleanAnswer) {
      setLocalError('Please enter your answer to the security question.');
      return;
    }

    setLoading(true);
    try {
      // Test the answer against stored hash
      const cleanUser = recoveryUsername.trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
      const userRef = doc(db, 'usernames', cleanUser);
      let snap = await getDoc(userRef);
      let data = snap.exists() ? snap.data() : null;

      if (!data) {
        const uQ = query(collection(db, 'users'), where('username', '==', cleanUser));
        const uRes = await getDocs(uQ);
        if (!uRes.empty) {
          data = uRes.docs[0].data();
        }
      }

      if (!data) {
        throw new Error('User not found.');
      }
      const { hashString, normalizeSecurityAnswer } = await import('../../utils/security');
      const testHash = await hashString(normalizeSecurityAnswer(cleanAnswer), data.salt);

      if (testHash !== data.securityAnswerHash) {
        throw new Error('Incorrect answer to security question. Please try again.');
      }

      // Security question answer is correct! Advance to Step 3
      setForgotStep(3);
    } catch (err: any) {
      setLocalError(err.message || 'Incorrect answer to security question. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Create New Password and Confirm
  const handleSetNewPasswordAndLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);

    if (!newPassword || newPassword.length < 6) {
      setLocalError('New password must contain at least 6 characters.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setLocalError('Passwords do not match. Please ensure both passwords match.');
      return;
    }

    setLoading(true);
    try {
      const cleanUser = recoveryUsername.trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
      await verifySecurityAnswerAndResetPassword(
        cleanUser,
        recoveryAnswerInput.trim(),
        newPassword
      );
      setFeedbackSuccess('Password reset successfully! You are now logged in.');
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setLocalError(err.message || 'Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const activeDisplayError = localError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200">
      {/* ========================================================= */}
      {/* SUCCESS POPUP MODAL (When Account Created) */}
      {/* ========================================================= */}
      {showSuccessPopup ? (
        <div className="relative w-full max-w-sm rounded-2xl border border-white/20 bg-[#121218] p-6 text-white shadow-2xl text-center animate-in zoom-in-95 duration-200">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-emerald-400/10 border border-emerald-500/30 text-emerald-400 shadow-lg mb-4">
            <CheckCircle2 className="h-8 w-8" />
          </div>

          <h3 className="text-base font-bold tracking-tight text-white mb-1">
            Account Created Successfully!
          </h3>
          <p className="text-xs text-neutral-400 leading-relaxed mb-4">
            Welcome to <span className="text-white font-semibold">Nochaf.AI</span>, {createdUserName}. Your account and security recovery question have been configured.
          </p>

          <div className="rounded-xl border border-white/10 bg-neutral-900/80 p-3 text-left text-xs text-neutral-300 space-y-1 mb-5">
            <div className="flex justify-between text-[11px]">
              <span className="text-neutral-500 font-mono">Status:</span>
              <span className="text-emerald-400 font-medium">Session Active</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-neutral-500 font-mono">Recovery:</span>
              <span className="text-white font-medium">Security Question Configured</span>
            </div>
          </div>

          <button
            onClick={() => {
              setShowSuccessPopup(false);
              onClose();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-xs font-semibold text-black hover:bg-neutral-100 transition-all shadow-lg cursor-pointer"
          >
            <span>Enter Nochaf.AI</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>

          <p className="mt-2 text-[10px] font-mono text-neutral-500">
            Routing automatically in {redirectCountdown}s...
          </p>
        </div>
      ) : (
        /* ========================================================= */
        /* MAIN AUTHENTICATION CONTAINER */
        /* ========================================================= */
        <div className="relative w-full max-w-md rounded-2xl border border-white/20 bg-[#101015] p-6 text-white shadow-2xl max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between pb-3.5 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-white to-neutral-300 text-black font-extrabold text-sm shadow">
                N
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-tight text-white">Nochaf Authentication</h2>
              </div>
            </div>
            <button
              onClick={handleModalClose}
              className="rounded-lg p-1 text-neutral-400 hover:text-white transition-colors cursor-pointer"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Top-Level Tabs: 'Log In' and 'Create Account' (only when not in recovery/google setup/picker) */}
          {mainMode !== 'forgot_password' && mainMode !== 'google_setup' && mainMode !== 'google_account_picker' && (
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-neutral-900/90 p-1 border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMainMode('login');
                  clearError();
                  setLocalError(null);
                  setFeedbackSuccess(null);
                  setShowWrongPasswordForgotPrompt(false);
                }}
                className={`rounded-lg py-2 font-medium transition-colors cursor-pointer ${
                  mainMode === 'login'
                    ? 'bg-neutral-100 text-black font-semibold shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainMode('create_account');
                  clearError();
                  setLocalError(null);
                  setFeedbackSuccess(null);
                  setShowWrongPasswordForgotPrompt(false);
                }}
                className={`rounded-lg py-2 font-medium transition-colors cursor-pointer ${
                  mainMode === 'create_account'
                    ? 'bg-neutral-100 text-black font-semibold shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          {/* Pop-up Alert Message on Screen with (×) to cancel it */}
          {activeDisplayError && (
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] w-[92%] max-w-sm animate-in fade-in slide-in-from-top-3 duration-150">
              <div className="flex items-start justify-between gap-3 rounded-2xl border border-red-500/40 bg-[#161218]/95 p-3.5 text-xs text-red-100 shadow-2xl backdrop-blur-xl ring-1 ring-red-500/30">
                <div className="space-y-0.5 flex-1 pr-1">
                  <p className="font-semibold text-red-300">Notice</p>
                  <p className="text-[11px] leading-relaxed text-red-200/95">{activeDisplayError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearError();
                    setLocalError(null);
                  }}
                  className="rounded-lg p-1 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer shrink-0"
                  title="Dismiss warning (×)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {feedbackSuccess && (
            <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <p className="leading-relaxed">{feedbackSuccess}</p>
            </div>
          )}

          {/* Wrong password prompt */}
          {showWrongPasswordForgotPrompt && mainMode === 'login' && (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-center justify-between">
              <div>
                <p className="font-semibold text-amber-300">Incorrect password</p>
                <p className="text-[11px] text-amber-200/90">Forgot your password? Use your security question.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRecoveryUsername(usernameInput.trim());
                  setMainMode('forgot_password');
                  setForgotStep(1);
                  clearError();
                  setLocalError(null);
                  setFeedbackSuccess(null);
                }}
                className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-300 transition-colors shadow cursor-pointer shrink-0 ml-2"
              >
                Forgot Password?
              </button>
            </div>
          )}

          {/* ========================================================= */}
          {/* FLOW A: CREATE ACCOUNT (No Email, Plus Security Question) */}
          {/* ========================================================= */}
          {mainMode === 'create_account' && (
            <form onSubmit={handleCreateAccount} className="mt-4 space-y-3">
              {/* Name */}
              <div>
                <label className="block text-[11px] font-semibold text-white mb-1">
                  Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Your name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-2 px-3 text-xs text-white placeholder-white/30 focus:border-white/40 focus:outline-none"
                />
              </div>

              {/* Username Input */}
              <div>
                <label className="block text-[11px] font-semibold text-white mb-1">
                  Username
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="username"
                    value={usernameInput}
                    onChange={(e) =>
                      setUsernameInput(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-2 px-3 text-xs text-white placeholder-white/30 focus:border-white/40 focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-[11px] font-semibold text-white mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-2 pl-9 pr-9 text-xs text-white placeholder-white/30 focus:border-white/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* TikTok-style Real-time Strong Password Checklist & Strength Bar */}
                {(() => {
                  const pwHasLength = password.length >= 8 && password.length <= 20;
                  const pwHasLetterAndNumber = /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
                  const pwHasSpecial = /[^a-zA-Z0-9]/.test(password);
                  const pwScore = (pwHasLength ? 1 : 0) + (pwHasLetterAndNumber ? 1 : 0) + (pwHasSpecial ? 1 : 0);

                  return (
                    <div className="mt-2 p-2.5 rounded-xl bg-neutral-900/90 border border-white/10 space-y-2">
                      <div className="flex items-center justify-between text-[10.5px]">
                        <span className="text-neutral-400">Password strength:</span>
                        <span className={`font-semibold ${
                          pwScore === 3
                            ? 'text-emerald-400'
                            : pwScore === 2
                            ? 'text-amber-400'
                            : password
                            ? 'text-rose-400'
                            : 'text-neutral-500'
                        }`}>
                          {pwScore === 3 ? 'Strong' : pwScore === 2 ? 'Medium' : password ? 'Weak' : 'Not entered'}
                        </span>
                      </div>
                      {/* Strength meter bar */}
                      <div className="grid grid-cols-3 gap-1.5 h-1 w-full">
                        <div className={`h-full rounded-full transition-colors ${
                          pwScore >= 1
                            ? (pwScore === 1 ? 'bg-rose-500' : pwScore === 2 ? 'bg-amber-400' : 'bg-emerald-400')
                            : 'bg-neutral-800'
                        }`} />
                        <div className={`h-full rounded-full transition-colors ${
                          pwScore >= 2
                            ? (pwScore === 2 ? 'bg-amber-400' : 'bg-emerald-400')
                            : 'bg-neutral-800'
                        }`} />
                        <div className={`h-full rounded-full transition-colors ${
                          pwScore >= 3 ? 'bg-emerald-400' : 'bg-neutral-800'
                        }`} />
                      </div>
                      {/* Requirements checklist (TikTok style) */}
                      <div className="space-y-1 pt-0.5">
                        <div className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                          pwHasLength ? 'text-emerald-400 font-medium' : 'text-neutral-400'
                        }`}>
                          {pwHasLength ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400 stroke-[3] shrink-0" />
                          ) : (
                            <div className="h-1.5 w-1.5 rounded-full bg-neutral-600 ml-1 mr-1 shrink-0" />
                          )}
                          <span>8 to 20 characters</span>
                        </div>
                        <div className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                          pwHasLetterAndNumber ? 'text-emerald-400 font-medium' : 'text-neutral-400'
                        }`}>
                          {pwHasLetterAndNumber ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400 stroke-[3] shrink-0" />
                          ) : (
                            <div className="h-1.5 w-1.5 rounded-full bg-neutral-600 ml-1 mr-1 shrink-0" />
                          )}
                          <span>Letters and numbers</span>
                        </div>
                        <div className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                          pwHasSpecial ? 'text-emerald-400 font-medium' : 'text-neutral-400'
                        }`}>
                          {pwHasSpecial ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400 stroke-[3] shrink-0" />
                          ) : (
                            <div className="h-1.5 w-1.5 rounded-full bg-neutral-600 ml-1 mr-1 shrink-0" />
                          )}
                          <span>At least 1 special character (e.g. !@#$%)</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-[11px] font-semibold text-white mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`w-full rounded-xl border bg-neutral-900/90 py-2 pl-9 pr-9 text-xs text-white placeholder-white/30 focus:outline-none ${
                      confirmPassword && password !== confirmPassword
                        ? 'border-red-500/60 focus:border-red-500'
                        : 'border-white/10 focus:border-white/40'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-white cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="mt-1 text-[10px] text-red-400">Passwords do not match.</p>
                )}
              </div>

              {/* Security Question Section (Mandatory for Password Recovery) */}
              <div className="rounded-xl border border-white/15 bg-neutral-900/70 p-3 space-y-2 mt-3">
                <div className="flex items-center gap-1.5 text-white">
                  <ShieldCheck className="h-3.5 w-3.5 text-white" />
                  <span className="text-[11px] font-semibold text-white">Recovery Question</span>
                </div>
                <p className="text-[10.5px] text-neutral-300 leading-relaxed">
                  Fill this security question. You will use it to verify your identity and reset your password if you ever forget it.
                </p>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10.5px] font-semibold text-white">
                      Select Question
                    </label>
                    {isCustomQuestion ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomQuestion(false);
                          setSecurityQuestion(SECURITY_QUESTIONS[0]);
                        }}
                        className="text-[10px] text-neutral-400 hover:text-white underline cursor-pointer"
                      >
                        Choose from list
                      </button>
                    ) : null}
                  </div>

                  {!isCustomQuestion ? (
                    <div>
                      <select
                        value={securityQuestion}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setIsCustomQuestion(true);
                            setCustomQuestionText('');
                          } else {
                            setSecurityQuestion(e.target.value);
                          }
                        }}
                        className="w-full rounded-xl border border-white/10 bg-neutral-950 py-2 px-3 text-xs text-neutral-200 focus:border-white/40 focus:outline-none cursor-pointer"
                      >
                        {SECURITY_QUESTIONS.map((q, idx) => (
                          <option key={idx} value={q} className="bg-neutral-950 text-white">
                            {q}
                          </option>
                        ))}
                        <option value="__custom__" className="bg-neutral-950 text-emerald-400 font-semibold">
                          creat your own question...
                        </option>
                      </select>

                      {/* "creat your own question" button below the questions */}
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomQuestion(true);
                          setCustomQuestionText('');
                        }}
                        className="mt-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold block text-left cursor-pointer transition-colors"
                      >
                        creat your own question
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        required
                        placeholder="Type your own question..."
                        value={customQuestionText}
                        onChange={(e) => setCustomQuestionText(e.target.value)}
                        className="w-full rounded-xl border border-emerald-500/50 bg-neutral-950 py-2 px-3 text-xs text-white placeholder-white/30 focus:border-emerald-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomQuestion(false);
                          setSecurityQuestion(SECURITY_QUESTIONS[0]);
                        }}
                        className="text-[10px] text-neutral-400 hover:text-white cursor-pointer"
                      >
                        ← Back to select question
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10.5px] font-semibold text-white mb-1">
                    Answer
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="enter answer"
                    value={securityAnswer}
                    onChange={(e) => setSecurityAnswer(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-neutral-950 py-2 px-3 text-xs text-white placeholder-white/30 focus:border-white/40 focus:outline-none"
                  />
                </div>
              </div>

              {/* Create Account Submission Button */}
              <div className="mt-3">
                <button
                  type="submit"
                  disabled={loading}
                  onClick={(e) => {
                    e.preventDefault();
                    executeCreateAccount();
                  }}
                  className="relative w-full overflow-hidden rounded-xl bg-white py-3 text-xs font-semibold text-black transition-all hover:bg-neutral-100 active:scale-[0.99] select-none cursor-pointer disabled:opacity-50 shadow-md"
                >
                  <div className="relative z-10 flex items-center justify-center gap-2">
                    {loading ? (
                      <span className="animate-pulse">Creating Account...</span>
                    ) : (
                      <span>Create Account</span>
                    )}
                  </div>
                </button>
              </div>

              {/* Log in with Google button */}
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-neutral-900 py-2.5 text-xs font-semibold text-white hover:bg-neutral-850 hover:border-white/30 transition-colors cursor-pointer shadow-sm"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path
                      fill="#EA4335"
                      d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.4l3.7 2.9C6.5 7.4 9 5 12 5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.6 14.7c-.2-.7-.4-1.5-.4-2.7 0-1.1.2-1.9.4-2.7L1.9 6.4C.7 8.8 0 10.4 0 12s.7 3.2 1.9 5.6l3.7-2.9z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.3L1.9 16c1.8 3.8 5.6 7 10.1 7z"
                    />
                  </svg>
                  <span>Log in with Google</span>
                </button>
              </div>
            </form>
          )}

          {/* ========================================================= */}
          {/* FLOW B: LOG IN FLOW (Username & Password) */}
          {/* ========================================================= */}
          {mainMode === 'login' && (
            <form onSubmit={handleLogIn} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-white mb-1">
                  Username
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="username"
                    value={usernameInput}
                    onChange={(e) =>
                      setUsernameInput(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-2 px-3 text-xs text-white placeholder-white/30 focus:border-white/40 focus:outline-none transition-colors font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-white">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const cleanUser = usernameInput.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
                      setRecoveryUsername(cleanUser);
                      setMainMode('forgot_password');
                      setForgotStep(1);
                      clearError();
                      setLocalError(null);
                      setFeedbackSuccess(null);
                    }}
                    className="text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-2 pl-9 pr-10 text-xs text-white placeholder-white/30 focus:border-white/40 focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 py-2.5 text-xs font-semibold text-black transition-all hover:bg-white hover:shadow-lg disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <span className="animate-pulse">Validating Password...</span>
                ) : (
                  <>
                    <span>Log In</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>

              {/* Log in with Google button */}
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-neutral-900 py-2.5 text-xs font-semibold text-white hover:bg-neutral-850 hover:border-white/30 transition-colors cursor-pointer shadow-sm"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path
                      fill="#EA4335"
                      d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.4l3.7 2.9C6.5 7.4 9 5 12 5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.6 14.7c-.2-.7-.4-1.5-.4-2.7 0-1.1.2-1.9.4-2.7L1.9 6.4C.7 8.8 0 10.4 0 12s.7 3.2 1.9 5.6l3.7-2.9z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.3L1.9 16c1.8 3.8 5.6 7 10.1 7z"
                    />
                  </svg>
                  <span>Log in with Google</span>
                </button>
              </div>
            </form>
          )}

          {/* ========================================================= */}
          {/* FLOW C: FORGOT PASSWORD (Security Question Verification) */}
          {/* ========================================================= */}
          {mainMode === 'forgot_password' && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-xs font-semibold text-neutral-200">
                  Password Recovery via Security Question
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMainMode('login');
                    clearError();
                    setLocalError(null);
                    setFeedbackSuccess(null);
                  }}
                  className="text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  ← Back to Log In
                </button>
              </div>

              {/* Step 1: Enter Username */}
              {forgotStep === 1 && (
                <form onSubmit={handleLookupRecoveryUsername} className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-white mb-1">
                      Username
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-2.5 text-xs font-mono text-neutral-400">@</span>
                      <input
                        type="text"
                        required
                        placeholder="username"
                        value={recoveryUsername}
                        onChange={(e) =>
                          setRecoveryUsername(
                            e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                          )
                        }
                        className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-2 pl-8 pr-3 text-xs text-white placeholder-neutral-500 focus:border-white/40 focus:outline-none font-mono"
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-400 leading-normal">
                      Enter your username to retrieve your security question.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 py-2.5 text-xs font-semibold text-black transition-all hover:bg-white hover:shadow-lg disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? (
                      <span className="animate-pulse">Retrieving Security Question...</span>
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* Step 2: Answer the Security Question */}
              {forgotStep === 2 && (
                <form onSubmit={handleVerifySecurityAnswer} className="space-y-3 pt-1">
                  <div className="rounded-xl border border-white/15 bg-neutral-900/80 p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-400 font-mono">Account:</span>
                      <span className="text-white font-mono font-medium">@{recoveryUsername}</span>
                    </div>
                    <div className="pt-1 border-t border-white/10">
                      <span className="block text-[10px] font-mono uppercase text-neutral-400 mb-0.5">
                        Your Security Question:
                      </span>
                      <p className="text-xs font-semibold text-white leading-relaxed">
                        {retrievedQuestion}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-400 mb-1">
                      Security Answer
                    </label>
                    <div className="relative">
                      <HelpCircle className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
                      <input
                        type="text"
                        required
                        placeholder="Enter the answer you set during registration"
                        value={recoveryAnswerInput}
                        onChange={(e) => setRecoveryAnswerInput(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-2 pl-9 pr-3 text-xs text-white placeholder-neutral-500 focus:border-white/40 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setForgotStep(1)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-neutral-100 py-2.5 text-xs font-semibold text-black transition-all hover:bg-white hover:shadow-lg disabled:opacity-50 cursor-pointer"
                    >
                      {loading ? (
                        <span className="animate-pulse">Checking Answer...</span>
                      ) : (
                        <>
                          <span>Verify Answer</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* Step 3: Create & Confirm New Password */}
              {forgotStep === 3 && (
                <form onSubmit={handleSetNewPasswordAndLogin} className="space-y-3 pt-1">
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span>Security question verified! Create your new password below.</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-400 mb-1">
                      New Password (Min 6 chars)
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-2 pl-9 pr-10 text-xs text-white placeholder-neutral-500 focus:border-white/40 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-2.5 text-neutral-400 hover:text-white cursor-pointer"
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-400 mb-1">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
                      <input
                        type={showConfirmNewPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        className={`w-full rounded-xl border bg-neutral-900/90 py-2 pl-9 pr-10 text-xs text-white placeholder-neutral-500 focus:outline-none ${
                          confirmNewPassword && newPassword !== confirmNewPassword
                            ? 'border-red-500/60 focus:border-red-500'
                            : 'border-white/10 focus:border-white/40'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                        className="absolute right-3 top-2.5 text-neutral-400 hover:text-white cursor-pointer"
                      >
                        {showConfirmNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {confirmNewPassword && newPassword !== confirmNewPassword && (
                      <p className="mt-1 text-[10px] text-red-400">Passwords do not match.</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 py-2.5 text-xs font-semibold text-black transition-all hover:bg-white hover:shadow-lg disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? (
                      <span className="animate-pulse">Updating Password & Logging In...</span>
                    ) : (
                      <>
                        <span>Confirm & Log In</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* FLOW D: GOOGLE USERNAME CREATION STEP */}
          {/* ========================================================= */}
          {mainMode === 'google_setup' && (
            <form onSubmit={handleCompleteGoogleSetup} className="mt-4 space-y-3">
              <div className="rounded-xl border border-white/15 bg-neutral-900/80 p-3 space-y-1">
                <div className="flex items-center gap-2 text-white font-semibold text-xs">
                  <UserIcon className="h-4 w-4 text-emerald-400" />
                  <span>Create Your Username</span>
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-[10.5px] font-mono uppercase text-neutral-400 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Your Name"
                  value={googleNameInput}
                  onChange={(e) => setGoogleNameInput(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-1.5 px-3 text-xs text-white placeholder-neutral-500 focus:border-white/40 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10.5px] font-mono uppercase text-neutral-400 mb-1">
                  Choose Username
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2 text-xs font-mono text-neutral-400">@</span>
                  <input
                    type="text"
                    required
                    placeholder="username"
                    value={googleUsernameInput}
                    onChange={(e) =>
                      setGoogleUsernameInput(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-neutral-900/90 py-1.5 pl-8 pr-3 text-xs text-white placeholder-neutral-500 focus:border-white/40 focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Security Recovery Question for Google Account */}
              <div className="rounded-xl border border-white/15 bg-neutral-900/70 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-neutral-200">
                  <ShieldCheck className="h-3.5 w-3.5 text-neutral-300" />
                  <span className="text-[11px] font-semibold">Security Recovery Question</span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] font-mono uppercase text-neutral-400">
                      Select Question
                    </label>
                    {isGoogleCustomQuestion ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsGoogleCustomQuestion(false);
                          setGoogleSecurityQuestion(SECURITY_QUESTIONS[0]);
                        }}
                        className="text-[10px] text-neutral-400 hover:text-white underline cursor-pointer"
                      >
                        Choose from list
                      </button>
                    ) : null}
                  </div>

                  {!isGoogleCustomQuestion ? (
                    <div>
                      <select
                        value={googleSecurityQuestion}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setIsGoogleCustomQuestion(true);
                            setGoogleCustomQuestionText('');
                          } else {
                            setGoogleSecurityQuestion(e.target.value);
                          }
                        }}
                        className="w-full rounded-xl border border-white/10 bg-neutral-950 py-1.5 px-3 text-xs text-neutral-200 focus:border-white/40 focus:outline-none cursor-pointer"
                      >
                        {SECURITY_QUESTIONS.map((q, idx) => (
                          <option key={idx} value={q} className="bg-neutral-950 text-white">
                            {q}
                          </option>
                        ))}
                        <option value="__custom__" className="bg-neutral-950 text-emerald-400 font-semibold">
                          creat your own question...
                        </option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          setIsGoogleCustomQuestion(true);
                          setGoogleCustomQuestionText('');
                        }}
                        className="mt-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold block text-left cursor-pointer transition-colors"
                      >
                        creat your own question
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        required
                        placeholder="Type your own question..."
                        value={googleCustomQuestionText}
                        onChange={(e) => setGoogleCustomQuestionText(e.target.value)}
                        className="w-full rounded-xl border border-emerald-500/50 bg-neutral-950 py-1.5 px-3 text-xs text-white placeholder-white/30 focus:border-emerald-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsGoogleCustomQuestion(false);
                          setGoogleSecurityQuestion(SECURITY_QUESTIONS[0]);
                        }}
                        className="text-[10px] text-neutral-400 hover:text-white cursor-pointer"
                      >
                        ← Back to select question
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase text-neutral-400 mb-1">
                    Your Answer
                  </label>
                  <input
                    type="text"
                    required
                    placeholder=""
                    value={googleSecurityAnswer}
                    onChange={(e) => setGoogleSecurityAnswer(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-neutral-950 py-1.5 px-3 text-xs text-white placeholder-neutral-500 focus:border-white/40 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 py-2.5 text-xs font-semibold text-black transition-all hover:bg-white hover:shadow-lg disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <span className="animate-pulse">Setting Up Username...</span>
                ) : (
                  <>
                    <span>Complete & Log In</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* ========================================================= */}
          {/* FLOW E: GOOGLE ACCOUNT PICKER */}
          {/* "Choose an account to continue to Nochaf AI" */}
          {/* ========================================================= */}
          {mainMode === 'google_account_picker' && (
            <div className="mt-4 space-y-4 animate-in fade-in duration-200">
              <div className="text-center pt-1 pb-1">
                {/* Google Logo */}
                <svg className="h-7 w-7 mx-auto mb-2.5" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.4l3.7 2.9C6.5 7.4 9 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.6 14.7c-.2-.7-.4-1.5-.4-2.7 0-1.1.2-1.9.4-2.7L1.9 6.4C.7 8.8 0 10.4 0 12s.7 3.2 1.9 5.6l3.7-2.9z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.3L1.9 16c1.8 3.8 5.6 7 10.1 7z"
                  />
                </svg>
                <h3 className="text-lg font-bold text-white tracking-tight">Choose an account</h3>
                <p className="text-xs text-neutral-300 mt-1">
                  to continue to <span className="text-white font-semibold">Nochaf web app</span>
                </p>
              </div>

              {/* Account list */}
              <div className="space-y-2 pt-1">
                {lastRealAccount ? (
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    className="w-full flex items-center gap-3.5 p-3 rounded-2xl border border-white/10 bg-neutral-900/90 hover:bg-neutral-800/90 hover:border-white/30 transition-all text-left cursor-pointer group shadow-sm disabled:opacity-50"
                  >
                    <div className="h-10 w-10 rounded-full bg-neutral-800 border border-white/10 text-neutral-300 flex items-center justify-center shrink-0 shadow text-sm overflow-hidden">
                      {lastRealAccount.avatar ? (
                        <img src={lastRealAccount.avatar} alt="" className="h-full w-full object-cover rounded-full" />
                      ) : (
                        <UserIcon className="h-5 w-5 text-neutral-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white truncate group-hover:text-neutral-100">
                        {lastRealAccount.name || 'Your Account'}
                      </p>
                      <p className="text-[11px] text-neutral-400 truncate font-mono">
                        {lastRealAccount.email || (lastRealAccount.handle ? `@${lastRealAccount.handle}` : '')}
                      </p>
                    </div>
                    <span className="text-[10px] bg-white/10 text-neutral-300 px-2 py-0.5 rounded-full font-mono">
                       Continue
                    </span>
                  </button>
                ) : null}

                {/* Sign in with Google / Use another account */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center gap-3.5 p-3 rounded-2xl border border-dashed border-white/15 bg-neutral-900/40 hover:bg-neutral-900 hover:border-white/30 transition-all text-left cursor-pointer group disabled:opacity-50"
                >
                  <div className="h-10 w-10 rounded-full border border-white/20 bg-neutral-800 text-neutral-300 flex items-center justify-center shrink-0">
                    <UserIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-neutral-200 group-hover:text-white">
                      {lastRealAccount ? 'Use another account' : 'Continue with Google'}
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      {lastRealAccount ? 'Sign in with a different Google account' : 'Sign in using your Google account to Nochaf web app'}
                    </p>
                  </div>
                </button>
              </div>

              {/* Privacy notice */}
              <p className="text-[10.5px] text-neutral-500 text-center leading-relaxed pt-2 px-1">
                To continue, Google will share your profile information securely with <span className="text-neutral-300 font-medium">Nochaf web app</span>.
              </p>

              <div className="pt-2 flex justify-center border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setMainMode('login')}
                  className="text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer py-1"
                >
                  ← Back to Log In
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
