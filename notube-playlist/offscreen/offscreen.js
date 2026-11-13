/*
 * Document invisible (API offscreen).
 * Le service worker MV3 ne peut pas créer d'adresse « blob: » : ce document le
 * fait pour lui. Il récupère le fichier chez noTube, vérifie qu'il s'agit bien
 * d'un fichier audio de taille normale, écrit les étiquettes titre / artiste,
 * puis renvoie une adresse blob que le service worker télécharge.
 */
const blobs = new Map(); // adresse blob -> minuterie de libération

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'ntx-offscreen') return; // message destiné à quelqu'un d'autre
  if (msg.type === 'fetch-tag') {
    fetchAndTag(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'revoke') {
    revoke(msg.blobUrl);
    sendResponse({ ok: true });
  }
});

async function fetchAndTag({ url, meta, tag, minBytes, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return { ok: false, server: true, error: `le serveur a répondu ${res.status}` };
    const type = res.headers.get('content-type') || '';
    if (/text\/html/i.test(type)) return { ok: false, server: true, error: 'le serveur a renvoyé une page web' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < minBytes) {
      return { ok: false, server: true, error: `fichier anormalement petit (${Math.round(bytes.length / 1024)} Ko)` };
    }
    let out = bytes;
    let tagged = false;
    if (tag) {
      const t = NTX_ID3.tag(bytes, meta);
      if (t) { out = t; tagged = true; }
    }
    const blobUrl = URL.createObjectURL(new Blob([out], { type: tagged ? 'audio/mpeg' : type || 'application/octet-stream' }));
    blobs.set(blobUrl, setTimeout(() => revoke(blobUrl), 30 * 60e3)); // libération de secours
    return { ok: true, blobUrl, size: out.length, tagged };
  } catch (e) {
    return { ok: false, network: true, error: e.name === 'AbortError' ? 'délai dépassé' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function revoke(blobUrl) {
  if (!blobs.has(blobUrl)) return;
  clearTimeout(blobs.get(blobUrl));
  blobs.delete(blobUrl);
  URL.revokeObjectURL(blobUrl);
}
