// Fake WACTO sender — records every outgoing message instead of sending it.
const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });

export async function sendWactoText(mobile, text) { H.sent.push({ kind: 'text', text }); }
export async function sendWactoImage(mobile, url) { H.sent.push({ kind: 'image', url }); }
export async function sendWactoImageWithCaption(mobile, url, caption) {
  if (H.failCaption) throw new Error('WACTO API error: simulated caption rejection');
  H.sent.push({ kind: 'image+caption', url, text: caption });
}
