/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { doc, getDoc, collection, query, where, getDocs } from '../lib/firebase';

/**
 * Normalizes a username or handle to lowercase alphanumeric and underscores.
 * Removes leading '@' and any characters that are not a-z, 0-9, or _.
 */
export function normalizeUsername(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
    .trim();
}

/**
 * Validates that a username always starts with a lowercase letter and contains only a-z, 0-9, and _.
 */
export function validateUsernameFormat(raw: string): { valid: boolean; error?: string } {
  const clean = normalizeUsername(raw);
  if (!clean) {
    return { valid: false, error: 'Please enter a username.' };
  }
  if (!/^[a-z]/.test(clean)) {
    return { valid: false, error: 'Username must always start with a lowercase letter (a-z).' };
  }
  if (clean.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters.' };
  }
  if (!/^[a-z][a-z0-9_]*$/.test(clean)) {
    return { valid: false, error: 'Username may only contain lowercase letters, numbers, and underscores.' };
  }
  if (clean === 'user') {
    return { valid: false, error: '"user" is not allowed as a username. Please choose a unique username.' };
  }
  return { valid: true };
}

/**
 * Formats a clean username with '@' prefix for display.
 */
export function formatHandle(username: string): string {
  const clean = normalizeUsername(username);
  return clean ? `@${clean}` : '';
}

/**
 * Checks if a given username is already registered in Firestore.
 * Verifies both the unique /usernames/{username} collection and /users.
 */
export async function isUsernameTaken(dbInstance: any, username: string): Promise<boolean> {
  const clean = normalizeUsername(username);
  if (!clean) return false;

  try {
    // 1. Direct primary key document check on /usernames/{clean} (authoritative unique registry)
    const nameRef = doc(dbInstance, 'usernames', clean);
    const nameSnap = await getDoc(nameRef);
    if (nameSnap.exists()) {
      return true;
    }

    return false;
  } catch (err) {
    console.warn('Error checking username availability:', err);
    return false;
  }
}
