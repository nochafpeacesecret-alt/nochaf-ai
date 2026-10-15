/**
 * Hardware and Browser Fingerprinting Utility for Nochaf.AI
 * Generates and persists a stable, high-entropy device ID for anti-spam enforcement.
 */

export async function getDeviceId(): Promise<string> {
  if (typeof window === 'undefined') {
    return 'srv_unknown_device';
  }

  // Check existing cached device ID
  try {
    const existing = localStorage.getItem('nochaf_device_id');
    if (existing && existing.length >= 16) {
      return existing;
    }
  } catch {}

  // Gather browser & device hardware characteristics
  const components: string[] = [];

  try {
    // 1. Screen & Viewport metrics
    components.push(`${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`);
    components.push(`${window.devicePixelRatio || 1}`);

    // 2. Navigator traits
    const nav = window.navigator as any;
    components.push(nav.userAgent || '');
    components.push(nav.language || nav.userLanguage || '');
    components.push(`${nav.hardwareConcurrency || 4}`);
    components.push(`${nav.maxTouchPoints || 0}`);
    components.push(nav.platform || '');

    // 3. Timezone
    try {
      components.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    } catch {}

    // 4. Canvas Fingerprint
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('Nochaf.Device.Fp<@!>', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('Nochaf.Device.Fp<@!>', 4, 17);
        components.push(canvas.toDataURL());
      }
    } catch {}
  } catch {}

  // Hash components using SHA-256
  const rawString = components.join('###');
  let hashHex = '';
  try {
    const enc = new TextEncoder();
    const data = enc.encode(rawString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch {
    // Fallback simple fast string hash
    let h = 0x811c9dc5;
    for (let i = 0; i < rawString.length; i++) {
      h ^= rawString.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    hashHex = ('dev_' + (h >>> 0).toString(16) + Math.random().toString(36).substring(2)).slice(0, 32);
  }

  const finalDeviceId = `dev_${hashHex}`;

  try {
    localStorage.setItem('nochaf_device_id', finalDeviceId);
  } catch {}

  return finalDeviceId;
}
