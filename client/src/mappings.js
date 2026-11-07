// دومينات اختيارية تمرّ مباشرة عبر URL Mappings (توفير للباندويث).
// أي دومين غير موجود هنا يمرّ تلقائي عبر بروكسي السيرفر /api/proxy، فما تحتاج تضيفه.
export const MAP = {
  // "commondatastorage.googleapis.com": "/test",
};

export function rewrite(url, inDiscord, roomId = "", tok = "") {
  try {
    const u = new URL(url);
    if (inDiscord && MAP[u.hostname]) return `/.proxy${MAP[u.hostname]}${u.pathname}${u.search}`;
    const px = inDiscord ? "/.proxy" : "";
    return `${px}/api/proxy?p=${inDiscord ? 1 : 0}&room=${encodeURIComponent(roomId)}&t=${encodeURIComponent(tok)}&url=${encodeURIComponent(url)}`;
  } catch {
    return url; // رابط نسبي مثل /.proxy/... يبقى كما هو
  }
}
