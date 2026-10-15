/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const SECURITY_QUESTIONS: string[] = [
  'What was the name of your first school?',
  'What city or town were you born in?',
  "What is your mother's maiden name?",
  'What was the name of your first pet?',
  'What is your favorite book or movie?',
  'What was your childhood nickname?',
  'What was the name of your first elementary school teacher?',
  'What street did you grow up on?',
];

/**
 * Normalizes an answer string for robust comparison:
 * lowercases, trims, and collapses multiple whitespace characters.
 */
export function normalizeSecurityAnswer(answer: string): string {
  if (!answer || typeof answer !== 'string') return '';
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Generates a random cryptographic salt hex string.
 */
export function generateSalt(): string {
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint8Array(16);
      window.crypto.getRandomValues(arr);
      return Array.from(arr)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {}
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * SHA-256 hash implementation using Web Crypto API with fallback.
 */
export async function hashString(value: string, salt: string): Promise<string> {
  const salted = `${salt}::${value}::nochaf_secure_token`;
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const enc = new TextEncoder();
      const data = enc.encode(salted);
      const hashBuf = await window.crypto.subtle.digest('SHA-256', data);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {}
  }

  // Fallback lightweight deterministic hash if WebCrypto is unavailable
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    const char = salted.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Deterministic internal auth password for Firebase Auth client SDK.
 */
export function getInternalAuthPassword(username: string): string {
  const clean = (username || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  return `nochaf_internal_auth_${clean}_sec9b9358a5`;
}

/**
 * Synthetic email for Firebase Auth client SDK (no external email used).
 */
export function getSyntheticEmail(username: string): string {
  const clean = (username || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  return `${clean}@nochaf.user`;
}
