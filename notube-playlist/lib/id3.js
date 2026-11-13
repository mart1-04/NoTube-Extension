/*
 * Écriture des étiquettes ID3 (titre, artiste) dans un MP3, sans dépendance.
 * L'étiquette d'origine de noTube (qui ne contient que le nom de l'encodeur)
 * est remplacée par une étiquette ID3v2.3 avec TIT2 (titre) et TPE1 (artiste),
 * en UTF-16 pour garder les accents.
 */
self.NTX_ID3 = (function () {
  const syncsafe = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];

  /** Cadre texte ID3v2.3 encodé en UTF-16 avec BOM. */
  function textFrame(id, text) {
    const body = [0x01, 0xff, 0xfe];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      body.push(c & 0xff, (c >> 8) & 0xff);
    }
    const n = body.length;
    const head = [...id].map((ch) => ch.charCodeAt(0));
    return [...head, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, 0, 0, ...body];
  }

  function build(meta) {
    const frames = [];
    if (meta.title) frames.push(...textFrame('TIT2', meta.title));
    if (meta.artist) frames.push(...textFrame('TPE1', meta.artist));
    return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, ...syncsafe(frames.length), ...frames]);
  }

  /** Retire l'étiquette ID3v2 existante en tête du fichier. */
  function strip(bytes) {
    if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
      const footer = bytes[5] & 0x10 ? 10 : 0;
      return bytes.subarray(10 + size + footer);
    }
    return bytes;
  }

  /** Vrai si les octets commencent par une trame audio MPEG (MP3). */
  const isMpegAudio = (b) => b.length > 4 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0;

  /** Renvoie un nouveau MP3 étiqueté, ou null si le fichier n'est pas un MP3 reconnu. */
  function tag(bytes, meta) {
    const audio = strip(bytes);
    if (!isMpegAudio(audio)) return null;
    const t = build(meta);
    const out = new Uint8Array(t.length + audio.length);
    out.set(t, 0);
    out.set(audio, t.length);
    return out;
  }

  return { build, strip, isMpegAudio, tag };
})();
