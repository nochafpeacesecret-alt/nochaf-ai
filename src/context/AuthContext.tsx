import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  db,
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  onSnapshot,
} from '../lib/firebase';
import firebaseConfig from '../../firebase-applet-config.json';
import { UserProfile } from '../types';
import { normalizeUsername, isUsernameTaken, validateUsernameFormat } from '../utils/username';
import {
  hashString,
  generateSalt,
  normalizeSecurityAnswer,
  getInternalAuthPassword,
  getSyntheticEmail,
} from '../utils/security';
import { getDeviceId } from '../utils/fingerprint';
import {
  verifyDeviceSignupEligibility,
  recordDeviceSignup,
  findExistingAccountByGoogleEmail,
  linkGoogleEmailToAccount,
} from '../utils/antiSpam';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  signInUsername: (username: string, pass: string) => Promise<void>;
  signUpUsername: (params: {
    name?: string;
    firstName?: string;
    secondName?: string;
    username: string;
    password: string;
    securityQuestion: string;
    securityAnswer: string;
  }) => Promise<void>;
  getSecurityQuestionByUsername: (username: string) => Promise<{
    exists: boolean;
    question?: string;
    username?: string;
  }>;
  verifySecurityAnswerAndResetPassword: (
    username: string,
    answer: string,
    newPassword: string
  ) => Promise<void>;
  completeGoogleUsernameSetup: (
    chosenUsername: string,
    chosenName?: string,
    securityQuestion?: string,
    securityAnswer?: string
  ) => Promise<void>;
  signInEmail: (email: string, pass: string) => Promise<void>;
  signUpEmail: (email: string, pass: string, name: string, username?: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInGuestDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<void>;
  formatAuthError: (err: any) => string;
  setError: (err: string | null) => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nochaf_active_session');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.uid && !parsed.uid.startsWith('guest_')) {
            return parsed;
          }
          localStorage.removeItem('nochaf_active_session');
          localStorage.removeItem('nochaf_active_profile');
        }
      } catch {}
    }
    return null;
  });
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nochaf_active_profile');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.uid && !parsed.uid.startsWith('guest_')) {
            return parsed;
          }
        }
      } catch {}
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Subscribe to user profile document
        const userDocRef = doc(db, 'users', currentUser.uid);
        const unsubProfile = onSnapshot(userDocRef, async (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setProfile(data);
            try {
              localStorage.setItem('nochaf_active_profile', JSON.stringify(data));
              localStorage.setItem('nochaf_last_real_account', JSON.stringify({
                name: data.displayName || currentUser.displayName || 'Nochaf Member',
                email: data.email || currentUser.email || '',
                avatar: data.avatar || currentUser.photoURL || '',
                handle: data.handle || data.username || 'user',
                uid: currentUser.uid,
              }));
            } catch {}
          } else {
            // Initial document setup
            let baseHandle = (currentUser.displayName || currentUser.email?.split('@')[0] || 'user')
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, '')
              .trim();
            if (!baseHandle) baseHandle = 'user';

            let chosenUsername = baseHandle;
            const taken = await isUsernameTaken(db, chosenUsername);
            if (taken) {
              chosenUsername = `${baseHandle}_${currentUser.uid.slice(0, 4)}`.toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
            }

            try {
              await setDoc(doc(db, 'usernames', chosenUsername), {
                uid: currentUser.uid,
                username: chosenUsername,
                createdAt: new Date().toISOString(),
              });
            } catch {}

            const newProfile: UserProfile = {
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || 'Nochaf Explorer',
              username: chosenUsername,
              handle: chosenUsername,
              plan: 'free',
              isPrivate: false,
              role: (currentUser.email === 'nochafpeace@gmail.com' || currentUser.email === 'nochafpeacesecret@gmail.com') ? 'admin' : 'user',
              createdAt: new Date().toISOString(),
              followersCount: 0,
              followingCount: 0,
            };
            await setDoc(userDocRef, { ...newProfile, isOnline: true, lastSeen: new Date().toISOString() }, { merge: true });
            setProfile(newProfile);
            try {
              localStorage.setItem('nochaf_active_profile', JSON.stringify(newProfile));
              localStorage.setItem('nochaf_last_real_account', JSON.stringify({
                name: newProfile.displayName,
                email: newProfile.email,
                handle: newProfile.handle,
                uid: currentUser.uid,
              }));
            } catch {}
          }
          setLoading(false);
        }, (err) => {
          console.warn('Profile sync notice:', err.message);
          setLoading(false);
        });

        const updatePresence = (online: boolean) => {
          try {
            setDoc(userDocRef, { isOnline: online, lastSeen: new Date().toISOString() }, { merge: true });
          } catch {}
        };

        updatePresence(!document.hidden);
        const heartbeat = setInterval(() => {
          if (!document.hidden) {
            updatePresence(true);
          }
        }, 12000);

        const handleVisibilityChange = () => {
          updatePresence(!document.hidden);
        };
        const handleLeave = () => {
          updatePresence(false);
        };
        const handleActivity = () => {
          if (!document.hidden) {
            updatePresence(true);
          }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', handleLeave);
        window.addEventListener('beforeunload', handleLeave);
        window.addEventListener('focus', () => updatePresence(true));
        window.addEventListener('pointerdown', handleActivity, { passive: true });
        window.addEventListener('keydown', handleActivity, { passive: true });

        return () => {
          clearInterval(heartbeat);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          window.removeEventListener('pagehide', handleLeave);
          window.removeEventListener('beforeunload', handleLeave);
          window.removeEventListener('pointerdown', handleActivity);
          window.removeEventListener('keydown', handleActivity);
          updatePresence(false);
          unsubProfile();
        };
      } else {
        // If no Firebase Auth user, check if we have a valid username session saved
        const savedSession = localStorage.getItem('nochaf_active_session');
        if (savedSession) {
          try {
            const parsedSession = JSON.parse(savedSession);
            if (parsedSession?.uid && !parsedSession.uid.startsWith('guest_')) {
              setUser(parsedSession);
              const uSnap = await getDoc(doc(db, 'users', parsedSession.uid));
              if (uSnap.exists()) {
                const uData = uSnap.data() as UserProfile;
                setProfile(uData);
                localStorage.setItem('nochaf_active_profile', JSON.stringify(uData));
                setDoc(doc(db, 'users', parsedSession.uid), { isOnline: true, lastSeen: new Date().toISOString() }, { merge: true }).catch(() => {});
              }
            } else {
              localStorage.removeItem('nochaf_active_session');
              localStorage.removeItem('nochaf_active_profile');
            }
          } catch {}
        }
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const formatAuthError = (err: any): string => {
    const code = err.code || '';
    if (code === 'auth/operation-not-allowed') {
      return 'This sign-in method is not enabled in Firebase Console. Please enable it in Firebase Authentication > Sign-in method.';
    }
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return 'Invalid email or password. Please verify credentials.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'An account with this email already exists. Please log in.';
    }
    if (code === 'auth/weak-password') {
      return 'Password should be at least 6 characters.';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'Google sign-in was cancelled.';
    }
    if (code === 'auth/popup-blocked') {
      return 'Sign-in popup was blocked by browser. Please allow popups for this site.';
    }
    if (code === 'auth/invalid-phone-number') {
      return 'Invalid phone number format. Please include country code (e.g., +15551234567 or +254712345678).';
    }
    if (code === 'auth/missing-phone-number') {
      return 'Please enter a valid phone number with country code.';
    }
    if (code === 'auth/quota-exceeded') {
      return 'SMS quota exceeded for this project. Please try Google Sign-In or Email/Password.';
    }
    if (code === 'auth/captcha-check-failed') {
      return 'reCAPTCHA verification failed. Please try again.';
    }
    if (code === 'auth/invalid-verification-code') {
      return 'Incorrect OTP verification code. Please check your SMS and re-enter the code.';
    }
    if (code === 'auth/code-expired') {
      return 'The SMS verification code has expired. Please request a new code.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many attempts. Access has been temporarily disabled. Try again later or reset password.';
    }
    return err.message || 'An error occurred during authentication.';
  };

  const signInUsername = async (usernameInput: string, pass: string) => {
    setError(null);
    const raw = usernameInput.trim();
    if (!raw) {
      const msg = 'Please enter your username.';
      setError(msg);
      throw new Error(msg);
    }
    if (!pass) {
      const msg = 'Please enter your password.';
      setError(msg);
      throw new Error(msg);
    }

    // A. Check if the user entered an email address (for existing google/email accounts)
    if (raw.includes('@') && raw.includes('.') && !raw.startsWith('@')) {
      try {
        const cred = await signInWithEmailAndPassword(auth, raw, pass);
        if (cred.user) {
          const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
          let profData: UserProfile | null = null;
          if (userDoc.exists()) {
            profData = userDoc.data() as UserProfile;
          } else {
            const handle = raw.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
            profData = {
              uid: cred.user.uid,
              email: raw,
              displayName: cred.user.displayName || handle,
              username: handle,
              handle,
              role: 'user',
              plan: 'free',
              isPrivate: false,
              createdAt: new Date().toISOString(),
              followersCount: 0,
              followingCount: 0,
            };
            await setDoc(doc(db, 'users', cred.user.uid), profData, { merge: true });
          }
          setProfile(profData);
          setUser(cred.user);
          localStorage.setItem('nochaf_active_session', JSON.stringify({
            uid: cred.user.uid,
            email: cred.user.email,
            displayName: cred.user.displayName,
          }));
          localStorage.setItem('nochaf_active_profile', JSON.stringify(profData));
          return;
        }
      } catch (emailErr: any) {
        if (emailErr.code === 'auth/wrong-password' || emailErr.code === 'auth/invalid-credential') {
          const msg = 'Invalid password. Please verify credentials.';
          setError(msg);
          throw new Error(msg);
        }
      }
    }

    // B. Username Sign-In
    const clean = normalizeUsername(raw);
    if (!clean) {
      const msg = 'Please enter your username.';
      setError(msg);
      throw new Error(msg);
    }
    if (!/^[a-z]/.test(clean)) {
      const msg = 'Username must always start with a lowercase letter (a-z).';
      setError(msg);
      throw new Error(msg);
    }

    try {
      let userDocRef = doc(db, 'usernames', clean);
      let snap = await getDoc(userDocRef);

      // If not directly in usernames doc, also check users collection by handle or username
      let data = snap.exists() ? snap.data() : null;
      if (!data) {
        const uQ = query(collection(db, 'users'), where('username', '==', clean));
        const uRes = await getDocs(uQ);
        if (!uRes.empty) {
          const firstU = uRes.docs[0];
          data = { ...firstU.data(), uid: firstU.id } as any;
        }
      }

      if (!data) {
        const msg = `No account found with username @${clean}. Please check your username or create an account.`;
        setError(msg);
        throw new Error(msg);
      }

      const syntheticEmail = data.syntheticEmail || data.email || getSyntheticEmail(clean);
      const internalAuthPass = getInternalAuthPassword(clean);
      let sessionUid = data.uid || ('u_' + clean);

      if (data.passwordHash && data.salt) {
        const enteredHash = await hashString(pass, data.salt);
        if (enteredHash !== data.passwordHash) {
          const msg = 'Incorrect password. Please verify credentials.';
          setError(msg);
          throw new Error(msg);
        }

        try {
          const authCred = await signInWithEmailAndPassword(auth, syntheticEmail, internalAuthPass);
          sessionUid = authCred.user.uid;
        } catch (authErr: any) {
          if (authErr.code === 'auth/user-not-found' || authErr.code === 'auth/invalid-credential') {
            try {
              const createdCred = await createUserWithEmailAndPassword(auth, syntheticEmail, internalAuthPass);
              sessionUid = createdCred.user.uid;
            } catch {
              try {
                const cred2 = await signInWithEmailAndPassword(auth, syntheticEmail, pass);
                sessionUid = cred2.user.uid;
              } catch {}
            }
          }
        }
      } else {
        // Fallback for legacy account without hash
        const emailToUse = data.syntheticEmail || data.email || getSyntheticEmail(clean);
        try {
          const authCred = await signInWithEmailAndPassword(auth, emailToUse, pass);
          sessionUid = authCred.user.uid;
        } catch {
          try {
            const authCred2 = await signInWithEmailAndPassword(auth, emailToUse, internalAuthPass);
            sessionUid = authCred2.user.uid;
          } catch {}
        }
      }

      // Establish profile session
      let fetchedProfile: UserProfile | null = null;
      try {
        const profileSnap = await getDoc(doc(db, 'users', sessionUid));
        if (profileSnap.exists()) {
          fetchedProfile = profileSnap.data() as UserProfile;
        }
      } catch {}

      const resolvedProfile: UserProfile = fetchedProfile || {
        uid: sessionUid,
        email: syntheticEmail,
        displayName: data.displayName || data.firstName || clean,
        firstName: data.firstName || '',
        secondName: data.secondName || '',
        username: clean,
        handle: clean,
        plan: 'free',
        isPrivate: false,
        role: (clean === 'nochafpeacesecret' || syntheticEmail === 'nochafpeacesecret@gmail.com') ? 'admin' : 'user',
        createdAt: data.createdAt || new Date().toISOString(),
        followersCount: 0,
        followingCount: 0,
      };

      setProfile(resolvedProfile);
      const sessionUser = {
        uid: sessionUid,
        email: syntheticEmail,
        displayName: resolvedProfile.displayName,
      } as any;
      setUser(sessionUser);

      try {
        localStorage.setItem('nochaf_active_session', JSON.stringify(sessionUser));
        localStorage.setItem('nochaf_active_profile', JSON.stringify(resolvedProfile));
        localStorage.setItem('nochaf_last_real_account', JSON.stringify({
          name: resolvedProfile.displayName,
          email: resolvedProfile.email,
          handle: resolvedProfile.handle,
          uid: sessionUid,
        }));
      } catch {}
    } catch (err: any) {
      const msg = formatAuthError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const signUpUsername = async ({
    name,
    firstName = '',
    secondName = '',
    username,
    password,
    securityQuestion,
    securityAnswer,
  }: {
    name?: string;
    firstName?: string;
    secondName?: string;
    username: string;
    password: string;
    securityQuestion: string;
    securityAnswer: string;
  }) => {
    setError(null);
    const clean = normalizeUsername(username);
    const candidateName = (name || `${firstName?.trim() || ''} ${secondName?.trim() || ''}`).trim();
    if (!candidateName) {
      const msg = 'Please enter your Name.';
      setError(msg);
      throw new Error(msg);
    }
    if (candidateName.toLowerCase() === 'user') {
      const msg = '"user" is not allowed. Please enter your real Name.';
      setError(msg);
      throw new Error(msg);
    }
    
    const userValidation = validateUsernameFormat(clean);
    if (!userValidation.valid) {
      const msg = userValidation.error || 'Username must always start with a lowercase letter (a-z).';
      setError(msg);
      throw new Error(msg);
    }

    if (password.length < 6) {
      const msg = 'Password must contain at least 6 characters.';
      setError(msg);
      throw new Error(msg);
    }

    const cleanAnswer = normalizeSecurityAnswer(securityAnswer);
    if (!securityQuestion || !cleanAnswer) {
      const msg = 'Please choose a security question and provide an answer to recover your account if you forget your password.';
      setError(msg);
      throw new Error(msg);
    }

    const taken = await isUsernameTaken(db, clean);
    if (taken) {
      const msg = `Username @${clean} is already taken. Please choose another username.`;
      setError(msg);
      throw new Error(msg);
    }

    const deviceCheck = await verifyDeviceSignupEligibility();

    try {
      const salt = generateSalt();
      const passwordHash = await hashString(password, salt);
      const securityAnswerHash = await hashString(cleanAnswer, salt);
      const syntheticEmail = getSyntheticEmail(clean);
      const internalAuthPass = getInternalAuthPassword(clean);

      let credUid = 'u_' + clean + '_' + Date.now().toString(36);
      try {
        const cred = await createUserWithEmailAndPassword(auth, syntheticEmail, internalAuthPass);
        credUid = cred.user.uid;
      } catch (createErr: any) {
        if (createErr.code === 'auth/email-already-in-use') {
          try {
            const cred = await signInWithEmailAndPassword(auth, syntheticEmail, internalAuthPass);
            credUid = cred.user.uid;
          } catch {}
        }
      }

      const fullName = (name || `${firstName.trim()} ${secondName.trim()}`).trim();
      const nameParts = fullName.split(' ');
      const finalFirst = firstName.trim() || nameParts[0] || fullName;
      const finalSecond = secondName.trim() || nameParts.slice(1).join(' ') || '';

      await setDoc(doc(db, 'usernames', clean), {
        uid: credUid,
        username: clean,
        displayName: fullName,
        firstName: finalFirst,
        secondName: finalSecond,
        salt,
        passwordHash,
        securityQuestion,
        securityAnswerHash,
        syntheticEmail,
        deviceId: deviceCheck.deviceId,
        createdAt: new Date().toISOString(),
      });

      const newProfile: UserProfile = {
        uid: credUid,
        displayName: fullName,
        firstName: finalFirst,
        secondName: finalSecond,
        email: syntheticEmail,
        username: clean,
        handle: clean,
        plan: 'free',
        isPrivate: false,
        role: 'user',
        deviceId: deviceCheck.deviceId,
        securityQuestion,
        usernameSetupCompleted: true,
        createdAt: new Date().toISOString(),
        followersCount: 0,
        followingCount: 0,
      };

      await setDoc(doc(db, 'users', credUid), newProfile);
      await recordDeviceSignup(deviceCheck.deviceId, credUid, clean);
      setProfile(newProfile);
      const sessionUser = {
        uid: credUid,
        email: syntheticEmail,
        displayName: fullName,
      } as any;
      setUser(sessionUser);

      try {
        localStorage.setItem('nochaf_active_session', JSON.stringify(sessionUser));
        localStorage.setItem('nochaf_active_profile', JSON.stringify(newProfile));
        localStorage.setItem('nochaf_last_real_account', JSON.stringify({
          name: fullName,
          email: syntheticEmail,
          handle: clean,
          uid: credUid,
        }));
      } catch {}
    } catch (err: any) {
      const msg = formatAuthError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const getSecurityQuestionByUsername = async (usernameInput: string) => {
    const clean = normalizeUsername(usernameInput);
    if (!clean) {
      throw new Error('Please enter your username.');
    }
    if (!/^[a-z]/.test(clean)) {
      throw new Error('Username must always start with a lowercase letter (a-z).');
    }

    const nameRef = doc(db, 'usernames', clean);
    let snap = await getDoc(nameRef);
    let data = snap.exists() ? snap.data() : null;

    if (!data) {
      const uQ = query(collection(db, 'users'), where('username', '==', clean));
      const uRes = await getDocs(uQ);
      if (!uRes.empty) {
        data = uRes.docs[0].data();
      }
    }

    if (!data) {
      throw new Error(`No account found with username @${clean}. Please check your username.`);
    }

    if (!data.securityQuestion) {
      throw new Error(`This account has not set a security question.`);
    }

    return {
      exists: true,
      question: data.securityQuestion as string,
      username: clean,
    };
  };

  const verifySecurityAnswerAndResetPassword = async (
    usernameInput: string,
    answerInput: string,
    newPassword: string
  ) => {
    setError(null);
    const clean = normalizeUsername(usernameInput);
    if (!clean) throw new Error('Please enter your username.');
    if (!/^[a-z]/.test(clean)) throw new Error('Username must always start with a lowercase letter (a-z).');

    if (!newPassword || newPassword.length < 6) {
      throw new Error('Password must contain at least 6 characters.');
    }

    const nameRef = doc(db, 'usernames', clean);
    let snap = await getDoc(nameRef);
    let data = snap.exists() ? snap.data() : null;
    let foundUid = data?.uid;

    if (!data) {
      const uQ = query(collection(db, 'users'), where('username', '==', clean));
      const uRes = await getDocs(uQ);
      if (!uRes.empty) {
        data = uRes.docs[0].data();
        foundUid = uRes.docs[0].id;
      }
    }

    if (!data) {
      throw new Error(`No account found with username @${clean}.`);
    }

    if (!data.salt || !data.securityAnswerHash) {
      throw new Error('This account does not have security question verification enabled.');
    }

    const normalizedAnswer = normalizeSecurityAnswer(answerInput);
    const testHash = await hashString(normalizedAnswer, data.salt);

    if (testHash !== data.securityAnswerHash) {
      throw new Error('Incorrect answer to security question. Please try again.');
    }

    // Answer matched! Authenticate session so user is logged in
    const syntheticEmail = data.syntheticEmail || getSyntheticEmail(clean);
    const internalAuthPass = getInternalAuthPassword(clean);
    let sessionUid = data.uid || ('u_' + clean);

    try {
      const cred = await signInWithEmailAndPassword(auth, syntheticEmail, internalAuthPass);
      sessionUid = cred.user.uid;
    } catch (authErr: any) {
      if (authErr.code === 'auth/user-not-found') {
        try {
          const cred = await createUserWithEmailAndPassword(auth, syntheticEmail, internalAuthPass);
          sessionUid = cred.user.uid;
        } catch {}
      }
    }

    const newPasswordHash = await hashString(newPassword, data.salt);

    await setDoc(
      nameRef,
      {
        passwordHash: newPasswordHash,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    if (data.uid) {
      try {
        await setDoc(
          doc(db, 'users', data.uid),
          {
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {}
    }

    // Set authenticated user and profile immediately
    let profileData: UserProfile | null = null;
    try {
      const uSnap = await getDoc(doc(db, 'users', sessionUid));
      if (uSnap.exists()) {
        profileData = uSnap.data() as UserProfile;
      }
    } catch {}

    const resolvedProfile: UserProfile = profileData || {
      uid: sessionUid,
      email: syntheticEmail,
      displayName: data.displayName || data.firstName || clean,
      username: clean,
      handle: clean,
      plan: 'free',
      isPrivate: false,
      role: 'user',
      createdAt: data.createdAt || new Date().toISOString(),
      followersCount: 0,
      followingCount: 0,
    };

    setProfile(resolvedProfile);
    const sessionUser = {
      uid: sessionUid,
      email: syntheticEmail,
      displayName: resolvedProfile.displayName,
    } as any;
    setUser(sessionUser);

    try {
      localStorage.setItem('nochaf_active_session', JSON.stringify(sessionUser));
      localStorage.setItem('nochaf_active_profile', JSON.stringify(resolvedProfile));
      localStorage.setItem('nochaf_last_real_account', JSON.stringify({
        name: resolvedProfile.displayName,
        email: resolvedProfile.email,
        handle: resolvedProfile.handle,
        uid: sessionUid,
      }));
    } catch {}
  };

  const completeGoogleUsernameSetup = async (
    chosenUsername: string,
    chosenName?: string,
    securityQuestion?: string,
    securityAnswer?: string
  ) => {
    if (!auth.currentUser) throw new Error('Google sign-in required.');
    const clean = normalizeUsername(chosenUsername);
    const cleanDisplayName = (chosenName || auth.currentUser.displayName || '').trim();
    if (!cleanDisplayName || cleanDisplayName.toLowerCase() === 'user') {
      throw new Error('"user" is not allowed. Please enter your real Name.');
    }
    if (!clean || clean.length < 3) {
      throw new Error('Username must be at least 3 characters and contain only letters, numbers, or underscores.');
    }
    if (clean.toLowerCase() === 'user') {
      throw new Error('"user" is not allowed as a username. Please choose a unique username.');
    }

    // Check device limits
    const deviceCheck = await verifyDeviceSignupEligibility();
    if (!deviceCheck.allowed) {
      throw new Error(deviceCheck.reason || 'Too many accounts on this phone. Use existing account.');
    }

    const taken = await isUsernameTaken(db, clean);
    if (taken) {
      throw new Error(`Username @${clean} is already taken. Please choose another.`);
    }

    const salt = generateSalt();
    let securityAnswerHash = '';
    if (securityQuestion && securityAnswer) {
      securityAnswerHash = await hashString(normalizeSecurityAnswer(securityAnswer), salt);
    }

    await setDoc(doc(db, 'usernames', clean), {
      uid: auth.currentUser.uid,
      username: clean,
      displayName: cleanDisplayName,
      securityQuestion: securityQuestion || '',
      securityAnswerHash: securityAnswerHash || '',
      salt,
      deviceId: deviceCheck.deviceId,
      createdAt: new Date().toISOString(),
    });

    const updates: Partial<UserProfile> = {
      displayName: cleanDisplayName,
      username: clean,
      handle: clean,
      usernameSetupCompleted: true,
      securityQuestion: securityQuestion || '',
      deviceId: deviceCheck.deviceId,
    };

    await setDoc(doc(db, 'users', auth.currentUser.uid), updates, { merge: true });

    if (auth.currentUser.email) {
      await linkGoogleEmailToAccount(auth.currentUser.uid, auth.currentUser.email, clean);
    }
    await recordDeviceSignup(deviceCheck.deviceId, auth.currentUser.uid, clean);

    setProfile((prev) => (prev ? { ...prev, ...updates } : ({
      uid: auth.currentUser!.uid,
      displayName: cleanDisplayName,
      email: auth.currentUser!.email || '',
      username: clean,
      handle: clean,
      role: 'user',
      plan: 'free',
      isPrivate: false,
      usernameSetupCompleted: true,
      createdAt: new Date().toISOString(),
      followersCount: 0,
      followingCount: 0,
      unreadCount: 0,
    } as UserProfile)));
  };

  const signInEmail = async (email: string, pass: string) => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err: any) {
      const msg = formatAuthError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const signUpEmail = async (email: string, pass: string, name: string, chosenUsername?: string) => {
    setError(null);
    try {
      // 1. Normalize username: username = username.toLowerCase().replace(/[^a-z0-9_]/g,'').trim()
      const rawUser = (chosenUsername && chosenUsername.trim()) || name;
      let cleanUsername = rawUser.toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
      if (!cleanUsername) {
        cleanUsername = 'user_' + Math.floor(1000 + Math.random() * 9000);
      }

      // 2. On signup, check if username exists. If yes, return error "Handle @xxx taken"
      const taken = await isUsernameTaken(db, cleanUsername);
      if (taken) {
        const errorMsg = `Handle @${cleanUsername} taken`;
        setError(errorMsg);
        throw new Error(errorMsg);
      }

      const cred = await createUserWithEmailAndPassword(auth, email, pass);

      // Reserve username in /usernames/{cleanUsername}
      try {
        await setDoc(doc(db, 'usernames', cleanUsername), {
          uid: cred.user.uid,
          username: cleanUsername,
          createdAt: new Date().toISOString(),
        });
      } catch (uErr) {
        console.warn('Username registry write:', uErr);
      }

      const newProfile: UserProfile = {
        uid: cred.user.uid,
        email,
        displayName: name,
        username: cleanUsername,
        handle: cleanUsername,
        plan: 'free',
        isPrivate: false,
        role: (email === 'nochafpeace@gmail.com' || email === 'nochafpeacesecret@gmail.com') ? 'admin' : 'user',
        createdAt: new Date().toISOString(),
        followersCount: 0,
        followingCount: 0,
      };
      await setDoc(doc(db, 'users', cred.user.uid), newProfile);
      setProfile(newProfile);
    } catch (err: any) {
      const msg = err.message?.startsWith('Handle @') ? err.message : formatAuthError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const signInGoogle = async () => {
    setError(null);

    // 1. Direct Google Accounts via Google Identity Services (GIS)
    // Takes user directly to Google Accounts without address/search bar loading
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
      try {
        await new Promise<void>((resolve, reject) => {
          const clientId =
            (firebaseConfig as any).oAuthClientId ||
            '383746966607-g5jks3pv18oid24pt92nuvesfgc8rfoc.apps.googleusercontent.com';
          const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'email profile openid',
            prompt: 'select_account',
            callback: async (tokenResponse: any) => {
              if (tokenResponse.error) {
                if (tokenResponse.error === 'access_denied') {
                  resolve();
                  return;
                }
                reject(new Error(tokenResponse.error_description || tokenResponse.error));
                return;
              }
              try {
                const credential = GoogleAuthProvider.credential(null, tokenResponse.access_token);
                const cred = await signInWithCredential(auth, credential);
                if (cred.user) {
                  setUser(cred.user);
                  try {
                    localStorage.setItem('nochaf_active_session', JSON.stringify({
                      uid: cred.user.uid,
                      email: cred.user.email,
                      displayName: cred.user.displayName,
                    }));
                  } catch {}
                }
                resolve();
              } catch (fbErr: any) {
                reject(fbErr);
              }
            },
          });
          tokenClient.requestAccessToken({ prompt: 'select_account' });
        });
        return;
      } catch (gisErr: any) {
        console.warn('Direct Google Accounts notice, falling back to popup:', gisErr);
      }
    }

    // 2. Standard Firebase popup fallback
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account',
      });
      const cred = await signInWithPopup(auth, provider);
      if (cred.user) {
        setUser(cred.user);
        try {
          localStorage.setItem('nochaf_active_session', JSON.stringify({
            uid: cred.user.uid,
            email: cred.user.email,
            displayName: cred.user.displayName,
          }));
        } catch {}
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        return;
      }
      const msg = formatAuthError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  // Guest login is strictly disallowed per user policy
  const signInGuestDemo = async () => {
    const msg = 'Guest login is disabled. Please log in with Google or your username.';
    setError(msg);
    throw new Error(msg);
  };

  const signOut = async () => {
    setError(null);
    try {
      const currentUid = user?.uid;

      // 1. Instantly clear react session state first so UI updates immediately
      setUser(null);
      setProfile(null);

      // 2. Clear all local storage and session items immediately
      try {
        localStorage.removeItem('nochaf_active_session');
        localStorage.removeItem('nochaf_active_profile');
        sessionStorage.clear();
      } catch {}

      // 3. Mark presence offline in background (non-blocking)
      if (currentUid && !currentUid.startsWith('guest_')) {
        setDoc(doc(db, 'users', currentUid), { isOnline: false, lastSeen: new Date().toISOString() }, { merge: true }).catch(() => {});
      }

      // 4. Firebase Auth signout
      await fbSignOut(auth).catch(() => {});
    } catch (err: any) {
      setUser(null);
      setProfile(null);
      setError(err.message || 'Signed out');
    }
  };

  const resetPassword = async (email: string) => {
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err: any) {
      const msg = formatAuthError(err);
      setError(msg);
      throw new Error(msg);
    }
  };

  const updateUserProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return;
    try {
      // If updating username or handle, check uniqueness
      if (updates.username || updates.handle) {
        const rawNew = updates.username || updates.handle || '';
        const clean = rawNew.toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
        if (clean && clean !== profile?.username && clean !== profile?.handle) {
          const taken = await isUsernameTaken(db, clean);
          if (taken) {
            const err = `Handle @${clean} taken`;
            setError(err);
            throw new Error(err);
          }
          try {
            await setDoc(doc(db, 'usernames', clean), {
              uid: user.uid,
              username: clean,
              createdAt: new Date().toISOString(),
            });
          } catch {}
          updates.username = clean;
          updates.handle = clean;
        }
      }

      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, updates, { merge: true });
      setProfile((prev) => {
        const next = prev ? { ...prev, ...updates } : (updates as UserProfile);
        try {
          localStorage.setItem('nochaf_persistent_saved_profile', JSON.stringify(next));
        } catch {}
        return next;
      });
    } catch (err: any) {
      console.error('Update profile error:', err);
      setProfile((prev) => {
        const next = prev ? { ...prev, ...updates } : (updates as UserProfile);
        try {
          localStorage.setItem('nochaf_persistent_saved_profile', JSON.stringify(next));
        } catch {}
        return next;
      });
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        error,
        signInUsername,
        signUpUsername,
        getSecurityQuestionByUsername,
        verifySecurityAnswerAndResetPassword,
        completeGoogleUsernameSetup,
        signInEmail,
        signUpEmail,
        signInGoogle,
        signInGuestDemo,
        signOut,
        resetPassword,
        updateUserProfile,
        formatAuthError,
        setError,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
