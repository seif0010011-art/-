import { DiscordSDK } from "@discord/embedded-app-sdk";
import Hls from "hls.js";
import { startFire } from "./fire.js";
import { rewrite } from "./mappings.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const statusEl = $("statusText");
const pingEl = $("ping");
let pingTimer = null;

function showPing(ms) {
  ms = Math.round(ms);
  pingEl.textContent = ms + " ms";
  pingEl.className = "ping" + (ms > 300 ? " bad" : ms > 150 ? " mid" : "");
}

const inDiscord = new URLSearchParams(location.search).has("frame_id");
let sdk = null;
let roomId = "local-test";
let channelId = null;
let remote = false; // يمنع حلقة الأحداث لما نطبّق أمر جاء من شخص ثاني
let currentUrl = "";
let proxyTok = ""; // توكن البروكسي من السيرفر
let hls = null;

// ================== شاشة الدخول (نار + صدمة) ==================
const fire = startFire($("fire"));

// ====== الجملة المتغيّرة (8 جمل، كل وحدة بلونها) ======
const TAGS = [
  ["شاهد مع أصحابك… بنفس اللحظة", "🎬", "#ff9100"],
  ["الكل يشوف نفس المشهد… بنفس الثانية", "⚡", "#ffd600"],
  ["أفلام وأنمي بجودة عالية", "🔥", "#ff3d00"],
  ["ادخل الروم… وخلّ السهرة تبدأ", "🍿", "#ffb300"],
  ["صوت يوصل 200%… حسّ بكل مشهد", "🔊", "#ff6a00"],
  ["ما يفوتك شي… المزامنة فورية", "🚀", "#ff2d55"],
  ["الصق الرابط في الشات… ويشتغل", "💥", "#ffa000"],
  ["جاهز للنار؟", "🔥", "#ff4d1a"],
];
const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
const tagEl = $("tag"), heroEl = $("hero"), tdots = $("tdots");
TAGS.forEach(() => tdots.append(document.createElement("i")));
let tgi = 0;
function showTag() {
  const [text, emoji, acc] = TAGS[tgi];
  tagEl.replaceChildren();
  const t = document.createElement("span"); t.className = "tt"; t.textContent = text + "\u00A0"; // مسافة ملتصقة عشان الإيموجي ما ينزل لحاله
  const e = document.createElement("span"); e.className = "te"; e.textContent = emoji;
  tagEl.append(t, e);
  heroEl.style.setProperty("--acc", acc);
  heroEl.style.setProperty("--glow", hexA(acc, 0.45));
  heroEl.style.setProperty("--edge", hexA(acc, 0.75));
  [...tdots.children].forEach((d, i) => d.classList.toggle("on", i === tgi));
  tagEl.getAnimations().forEach((a) => a.cancel());
  tagEl.animate(
    [{ opacity: 0, transform: "translateY(16px) scale(.96)" }, { opacity: 1, transform: "none" }],
    { duration: 520, easing: "cubic-bezier(.2,.9,.2,1)", fill: "both" }
  );
  tgi = (tgi + 1) % TAGS.length;
}
showTag();
const tagTimer = setInterval(() => {
  const o = tagEl.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-14px) scale(.98)" }],
    { duration: 260, fill: "forwards" }
  );
  o.onfinish = showTag;
}, 2900);

// ====== مراحل التحميل (تتغير النصوص كل شوي) ======
const stages = ["تهيئة الجلسة…", "الاتصال بالسيرفر…", "تجهيز المشغّل…", "إشعال النار 🔥", "جاهز!"];
const vers = ["Booting…", "Creating Session…", "Connecting…", "Preparing Player…", "Ready"];
let stageI = 0, minDone = false, netDone = false;
const stageTimer = setInterval(() => {
  if (stageI < stages.length - 2) stageI++;
  $("stagetxt").textContent = stages[stageI];
  $("ver").textContent = "V1.0.0 · " + vers[stageI];
}, 900);
setTimeout(() => { minDone = true; reveal(); }, 2400);
setTimeout(() => { netDone = true; reveal(); }, 7000); // احتياط لو تأخر الاتصال

function reveal() {
  if (!minDone || !netDone || !$("splash")) return; // شاشة الدخول انشالت
  clearInterval(stageTimer);
  $("stagetxt").textContent = stages[4];
  $("ver").textContent = "V1.0.0 · " + vers[4];
  $("loading").classList.add("done");
  const b = $("enter");
  b.disabled = false;
  b.classList.add("ready");
}

let toastT = null;
function toast(text, ms = 2600) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), ms);
}

function vibrate(p) { try { navigator.vibrate?.(p); } catch {} }

$("enter").addEventListener("click", () => {
  let savedVol = 100;
  try { savedVol = Number(localStorage.getItem("vol")) || 100; } catch {}
  setVolume(savedVol);
  const splash = $("splash");
  const flash = $("flash");

  // 1) ومضة بيضاء + اهتزاز الشاشة + انفجار جمرات
  flash.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 450, easing: "ease-out" });
  document.body.classList.add("shake");
  vibrate([80, 40, 160]);
  const r = $("enter").getBoundingClientRect();
  fire.burst(r.left + r.width / 2, r.top + r.height / 2, 220);
  setTimeout(() => fire.burst(innerWidth * .2, innerHeight * .6, 120), 150);
  setTimeout(() => fire.burst(innerWidth * .8, innerHeight * .6, 120), 280);

  // 2) تكبير المحتوى والاحتراق
  splash.classList.add("boom");
  setTimeout(() => splash.classList.add("gone"), 700);

  // 3) إظهار المشغّل
  setTimeout(() => {
    $("app").classList.add("show");
    document.body.classList.remove("shake");
    toast("🔥 أهلاً بك في عالم HOSAM");
  }, 900);
  setTimeout(() => { splash.remove(); fire.stop(); clearInterval(tagTimer); }, 1800);
});

// ================== مربع الروم الصوتي (صغير) ==================
let layoutMode = -1;
function checkTile() {
  const small = innerWidth <= 340 && innerHeight <= 340;
  const grid = (layoutMode === 1 || layoutMode === 2) && Math.min(innerWidth, innerHeight) <= 500;
  document.body.classList.toggle("tile", small || grid);
}
window.addEventListener("resize", checkTile);
checkTile();

// ================== Discord SDK ==================
async function setupDiscord() {
  if (!inDiscord) {
    statusEl.textContent = "وضع تجريبي خارج ديسكورد";
    return;
  }
  sdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
  roomId = sdk.instanceId;   // نضبطها فوراً حتى لو فشل تسجيل الدخول لاحقاً
  channelId = sdk.channelId;
  await sdk.ready();
  try { sdk.subscribe("ACTIVITY_LAYOUT_MODE_UPDATE", (e) => { layoutMode = e.layout_mode; checkTile(); }); } catch {}
  // بدون تسجيل دخول: ما نحتاج حساب المستخدم، فما تطلع نافذة الموافقة أبداً
}

// ================== مشغّل الفيديو ==================
let ytFrame = null;
let currentYt = null;
let ytTime = 0;
let ytState = null;

function ytId(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}

function ytCmd(func, args = []) {
  try {
    ytFrame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  } catch {}
}

function setYouTube(id) {
  video.pause();
  video.style.display = "none";
  $("ytbox").style.display = "block";
  if (!ytFrame) ytFrame = $("yt");
  ytFrame.onload = () =>
    ytFrame.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
  // داخل ديسكورد لازم mapping: Prefix=/youtube  Target=www.youtube.com
  const base = inDiscord ? "/.proxy/youtube" : "https://www.youtube.com";
  ytFrame.src = `${base}/embed/${id}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(location.origin)}`;
  currentYt = id;
  ytState = null;
}

// أحداث مشغّل يوتيوب (تشغيل/إيقاف/الوقت) → نرسلها للباقين
window.addEventListener("message", (e) => {
  if (!currentYt || typeof e.data !== "string") return;
  let d;
  try { d = JSON.parse(e.data); } catch { return; }
  if (d.event !== "infoDelivery" || !d.info) return;
  if (typeof d.info.currentTime === "number") ytTime = d.info.currentTime;
  const st = d.info.playerState;
  if ((st === 1 || st === 2) && st !== ytState) {
    ytState = st;
    if (!remote) send({ type: st === 1 ? "play" : "pause", time: ytTime });
  }
});

function isHlsUrl(u) { return u.includes(".m3u8"); }

function setSource(url, st) {
  if (!url || url === currentUrl) return;
  currentUrl = url;
  resetView();
  stopDash();
  qBaseList = []; qDash = []; qAudio = ""; qMode = "none"; qBase = url; qBaseH = (st && st.qh) || 0; qSel = qPrefGet(); curQ = null; dashFailed = false;

  const id = ytId(url);
  if (id) return setYouTube(id);

  if (currentYt) {
    currentYt = null;
    if (ytFrame) ytFrame.src = "about:blank";
    $("ytbox").style.display = "none";
    video.style.display = "block";
  }

  if (st && st.qualities && st.qualities.length) {
    qMode = "urls";
    qBaseList = st.qualities.map((q) => ({ h: q.h, fps: q.fps || 30, kind: "url", url: q.url }));
  }
  if (st && st.dash && st.dash.levels && st.dash.levels.length && st.dash.audio) {
    qDash = st.dash.levels.map((l) => ({ h: l.h, fps: l.fps || 30, kind: "dash", url: l.url, c: l.c || "" }));
    qAudio = st.dash.audio.url;
  }
  qMerge();
  const pick = qSel ? qPick(qSel) : null;
  qRender();
  if (pick && pick.kind === "dash") { curQ = pick; startDash(pick, 0, true); return; }
  if (pick && pick.kind === "url") { curQ = pick; return loadBase(pick.url, { level: -1 }); }
  loadBase(url, { level: undefined });
}

// يشغّل الرابط الأساسي (mp4 جاهز أو HLS) ويكمل من نفس المكان لو طُلب
function loadBase(useUrl, opts = {}) {
  stopDash();
  if (hls) { hls.destroy(); hls = null; }
  const src = rewrite(useUrl, inDiscord, roomId, proxyTok);
  if ((isHlsUrl(src) || isHlsUrl(useUrl)) && Hls.isSupported()) startHls(src, opts.level);
  else video.src = src;
  if (opts.t != null) resumeAt(opts.t, opts.play);
}
function resumeAt(t, play) {
  remote = true;
  video.addEventListener("loadedmetadata", () => {
    try { video.currentTime = t; } catch {}
    if (play) video.play().catch(() => {});
    setTimeout(() => (remote = false), 900);
  }, { once: true });
  setTimeout(() => (remote = false), 10000); // احتياط
}

let hlsRecovered = false;
function startHls(src, level) {
  if (hls) { hls.destroy(); hls = null; }
  hlsRecovered = false;
  hls = new Hls();
  hls.loadSource(src);
  hls.attachMedia(video);
  if (Hls.Events) {
    // لو الفيديو m3u8 فيه عدة جودات: نعرضها في قائمة الجودة (مع الفريمات)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const seen = new Set();
      const lv = hls.levels
        .map((l, i) => ({ h: l.height, fps: Math.round(parseFloat((l.attrs && l.attrs["FRAME-RATE"]) || 0)) || 30, kind: "hls", idx: i }))
        .filter((x) => x.h && !seen.has(qScore(x)) && seen.add(qScore(x)));
      if (!lv.length) return;
      qMode = "hls"; qBaseList = lv; qMerge();
      let idx = -1;
      if (level !== undefined) idx = level;
      else { const p = qSel ? qPick(qSel) : null; if (p && p.kind === "hls") { idx = p.idx; curQ = p; } }
      hls.currentLevel = idx;
      if (idx >= 0) curQ = lv.find((x) => x.idx === idx) || curQ;
      qRender();
    });
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !hlsRecovered) { hlsRecovered = true; try { hls.recoverMediaError(); return; } catch {} }
      hideLoader();
      appEl.classList.remove("clean");
      let m = "HLS: " + d.type + " / " + d.details + (d.response ? " (" + d.response.code + ")" : "");
      if (d.reason || d.error?.message) m += " | " + String(d.reason || d.error.message).slice(0, 80);
      statusEl.textContent = m;
      setHint("err", "⚠️ " + m);
      toast(m);
    });
  }
}

function applyState(s) {
  remote = true;
  setSubs(s.subs);
  setSource(s.url, s);
  if (currentYt) {
    ytCmd(s.playing ? "playVideo" : "pauseVideo");
    if (Math.abs(ytTime - s.time) > 2) ytCmd("seekTo", [s.time, true]);
  } else {
    if (Math.abs(video.currentTime - s.time) > 1.5) video.currentTime = s.time;
    if (s.playing && video.paused) video.play().catch(() => { hideLoader(); setHint("loading", "👆 اضغط ▶️ في المشغّل للتشغيل"); showControls(true); });
    if (!s.playing && !video.paused) video.pause();
  }
  setTimeout(() => (remote = false), 600);
}

// ================== WebSocket ==================
let ws;
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const base = inDiscord ? "/.proxy" : "";
  ws = new WebSocket(`${proto}://${location.host}${base}/ws/${roomId}`);
  ws.onopen = () => {
    statusEl.textContent = "متصل 🔥";
    if (channelId) send({ type: "hello", channel: channelId });
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: "ping", t: performance.now() }), 2000);
    send({ type: "ping", t: performance.now() });
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    pingEl.textContent = "-- ms";
    statusEl.textContent = "انقطع الاتصال، إعادة المحاولة...";
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "pong") return showPing(performance.now() - msg.t);
    if (msg.type === "tok") { proxyTok = msg.tok; return; }
    if (msg.type === "error") { statusEl.textContent = msg.text; setHint("err", "⚠️ " + msg.text); return toast("⚠️ " + msg.text); }
    if (msg.type === "state") {
      if (msg.url && msg.url !== currentUrl) {
        currentTitle = msg.title || "";
        setHint("loading", "⏳ جاري التشغيل");
        showLoader("start");
        toast("🎬 " + (msg.title || "تم تشغيل فيديو جديد"));
      }
      applyState(msg);
    }
  };
}

const send = (obj) => ws?.readyState === 1 && ws.send(JSON.stringify(obj));

video.addEventListener("play", () => !remote && send({ type: "play", time: video.currentTime }));
video.addEventListener("pause", () => !remote && send({ type: "pause", time: video.currentTime }));
video.addEventListener("seeked", () => !remote && send({ type: "seek", time: video.currentTime }));

video.addEventListener("error", async () => {
  if (dashOn) return dashFallback();
  const src = video.currentSrc || video.src;
  appEl.classList.remove("clean"); // نرجّع النصوص عشان يشوف الخطأ
  hideLoader();
  if (!src || src.endsWith("/")) return;
  let info = "خطأ بالفيديو (code " + (video.error?.code ?? "?") + ")";
  try {
    const r = await fetch(src, { headers: { Range: "bytes=0-0" } });
    info = "السيرفر رد " + r.status;
    if (!r.ok) info += " | " + (await r.text()).slice(0, 150);
    else {
      const ct = r.headers.get("content-type") || "";
      info += " | " + ct;
      if (/mpegurl/i.test(ct) && !hls) { // رابط HLS ما كان ظاهر من اسمه: نشغّله بـ hls.js
        if (Hls.isSupported()) { setHint("loading", "⏳ جاري التشغيل"); showLoader("start"); startHls(src); return; }
        info += " | hls.js غير مدعوم";
      }
    }
  } catch (e) {
    info = "فشل الوصول للبروكسي: " + e.message;
  }
  statusEl.textContent = info;
  setHint("err", "⚠️ ما اشتغل الفيديو، جرّب رابط ثاني");
  toast(info);
});



// ================== نص الحالة (يتحرك ويتغير حسب التشغيل) ==================
const hintEl = $("hint");
const HINT_IDLE = hintEl.innerHTML;
let currentTitle = "";
function setHint(mode, text = "") {
  hintEl.className = mode;
  if (mode === "idle") { hintEl.innerHTML = HINT_IDLE; return; }
  hintEl.textContent = text;
  if (mode === "loading") {
    const d = document.createElement("span");
    d.className = "ld";
    d.innerHTML = "<i>.</i><i>.</i><i>.</i>";
    hintEl.append(d);
  }
}
video.addEventListener("ended", () => appEl.classList.remove("clean"));
video.addEventListener("waiting", () => { if (currentUrl) { setHint("loading", "⏳ جاري التحميل"); showLoader("buffer"); } });
video.addEventListener("playing", () => { appEl.classList.add("clean"); hideLoader(); statusEl.textContent = "متصل 🔥"; setHint("ok", "▶️ يشتغل الحين" + (currentTitle ? " · " + currentTitle : "")); });

// ================== أزرار تحكم المشغّل ==================
const stage = $("stage"), controls = $("controls"), appEl = $("app");
const SV = (b) => `<svg viewBox="0 0 24 24">${b}</svg>`;
const IC = {
  play: SV('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>'),
  pause: SV('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>'),
  vol: (p) => SV('<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none"/>' +
    (p === 0 ? '<path d="M16 9l5 6M21 9l-5 6"/>' :
     p < 70 ? '<path d="M16 9.5a3.5 3.5 0 0 1 0 5"/>' :
     '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>')),
  zin: SV('<circle cx="11" cy="11" r="6"/><path d="M21 21l-5-5M11 8v6M8 11h6"/>'),
  zout: SV('<circle cx="11" cy="11" r="6"/><path d="M21 21l-5-5M8 11h6"/>'),
  rot: SV('<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v5h-5"/>'),
  fs: SV('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  back: SV('<path d="M11 6L5 12l6 6"/><path d="M19 6l-6 6 6 6"/>') ,
  fwd: SV('<path d="M13 6l6 6-6 6"/><path d="M5 6l6 6-6 6"/>'),
  fsx: SV('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
};
$("bplay").innerHTML = IC.play;
$("bvol").innerHTML = IC.vol(100);
$("brot").innerHTML = IC.rot;
$("bfs").innerHTML = IC.fs;

// ---- إظهار/إخفاء الأزرار ----
let ctlTimer = null;
function showControls(stay) {
  controls.classList.add("show");
  clearTimeout(ctlTimer);
  if (!stay) ctlTimer = setTimeout(() => { if (!video.paused && !volOpen && !qOpen && !cOpen) controls.classList.remove("show"); }, 3500);
}
function toggleControls() {
  if (controls.classList.contains("show")) { controls.classList.remove("show"); closeVol(true); closeQ(); closeC(); }
  else showControls();
}
const syncPlayIcon = () => { $("bplay").innerHTML = video.paused ? IC.play : IC.pause; };
video.addEventListener("play", () => { syncPlayIcon(); showControls(); });
video.addEventListener("pause", () => { syncPlayIcon(); showControls(true); });
$("bplay").onclick = () => { video.paused ? video.play().catch(() => {}) : video.pause(); showControls(); };

// ---- شريط التقدّم ----
const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
};
let seeking = false;
function updTime() {
  const d = video.duration;
  $("tcur").textContent = fmt(video.currentTime);
  $("tdur").textContent = isFinite(d) ? fmt(d) : "LIVE";
  if (!seeking) $("seekfill").style.width = (isFinite(d) && d > 0 ? (video.currentTime / d) * 100 : 0) + "%";
}
["timeupdate", "loadedmetadata", "durationchange"].forEach((ev) => video.addEventListener(ev, updTime));
const seekEl = $("seek");
let stageRot = 0; // تدوير الواجهة كلها: 0 / 90 / 270
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const seekFrac = (e) => {
  const r = seekEl.getBoundingClientRect();
  if (stageRot === 90) return clamp01((e.clientY - r.top) / r.height);
  if (stageRot === 270) return clamp01(1 - (e.clientY - r.top) / r.height);
  return clamp01((e.clientX - r.left) / r.width);
};
seekEl.addEventListener("pointerdown", (e) => { seeking = true; try { seekEl.setPointerCapture(e.pointerId); } catch {} $("seekfill").style.width = seekFrac(e) * 100 + "%"; showControls(true); });
seekEl.addEventListener("pointermove", (e) => { if (seeking) $("seekfill").style.width = seekFrac(e) * 100 + "%"; });
seekEl.addEventListener("pointerup", (e) => {
  if (!seeking) return;
  seeking = false;
  const d = video.duration;
  if (isFinite(d) && d > 0) video.currentTime = seekFrac(e) * d;
  showControls();
});
seekEl.addEventListener("pointercancel", () => { seeking = false; });

// ---- الصوت: شريط طولي فوق الأيقونة (محلي لكل شخص، يوصل 200%) ----
let actx = null, gainNode = null, volOpen = false, volTimer = null, vdrag = false, ignoreClick = false;
function audioGraph() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  actx = new AC();
  gainNode = actx.createGain();
  try { actx.createMediaElementSource(video).connect(gainNode); } catch {}
  try { actx.createMediaElementSource(aud).connect(gainNode); } catch {}
  gainNode.connect(actx.destination);
}
function setVolume(pct) {
  pct = Math.max(0, Math.min(200, Math.round(Number(pct) || 0)));
  $("vpct").textContent = pct + "%";
  $("vfill").style.height = pct / 2 + "%";
  $("vthumb").style.bottom = `calc(${pct / 2}% - 9px)`;
  $("bvol").innerHTML = IC.vol(pct);
  try {
    audioGraph();
    if (actx.state === "suspended") actx.resume();
    video.volume = 1; aud.volume = 1;
    gainNode.gain.value = pct / 100; // أكثر من 1 = تضخيم فوق الصوت الأصلي
  } catch {
    video.volume = Math.min(1, pct / 100); aud.volume = Math.min(1, pct / 100); // احتياط بدون تضخيم
  }
  try { localStorage.setItem("vol", String(pct)); } catch {}
}
function armVolTimer() { clearTimeout(volTimer); volTimer = setTimeout(() => closeVol(), 3000); }
function openVol() { closeQ(); volOpen = true; $("vpop").classList.add("on"); armVolTimer(); showControls(true); }
function closeVol(quiet) { volOpen = false; $("vpop").classList.remove("on"); clearTimeout(volTimer); if (!quiet) showControls(); }
const vt = $("vtrack");
function volFromEvent(e) {
  const r = vt.getBoundingClientRect();
  const f = stageRot === 90 ? clamp01((e.clientX - r.left) / r.width)
    : stageRot === 270 ? clamp01(1 - (e.clientX - r.left) / r.width)
    : clamp01(1 - (e.clientY - r.top) / r.height);
  setVolume(Math.round((f * 200) / 5) * 5);
  armVolTimer();
}
// اضغط على الأيقونة وحرّك صبعك لفوق/تحت مباشرة، أو اضغط عليها وبعدين اسحب على الشريط
$("bvol").addEventListener("pointerdown", (e) => {
  if (volOpen) return;
  openVol();
  ignoreClick = true;
  vdrag = true;
  try { vt.setPointerCapture(e.pointerId); } catch {}
});
$("bvol").addEventListener("click", () => {
  if (ignoreClick) { ignoreClick = false; return; }
  volOpen ? closeVol() : openVol();
});
vt.addEventListener("pointerdown", (e) => { vdrag = true; try { vt.setPointerCapture(e.pointerId); } catch {} volFromEvent(e); });
vt.addEventListener("pointermove", (e) => { if (vdrag) volFromEvent(e); });
const endVolDrag = () => { vdrag = false; setTimeout(() => { ignoreClick = false; }, 400); };
vt.addEventListener("pointerup", endVolDrag);
vt.addEventListener("pointercancel", endVolDrag);

// ---- الجودة: كل شخص يختار لحاله (ما تأثر على الباقين) ----
let qBaseList = [], qDash = [], qAudio = "", qList = [], qMode = "none", qSel = 0, qBase = "", qBaseH = 0, qOpen = false, qTimer = null, curQ = null;
const qPrefGet = () => { try { return Number(localStorage.getItem("qpref")) || 0; } catch { return 0; } };
const qPrefSet = (v) => { try { localStorage.setItem("qpref", String(v)); } catch {} };
const qScore = (q) => q.h * 1000 + (q.fps > 30 ? Math.round(q.fps) : 30);
const qLabel = (q) => (q.h >= 2160 ? "4K" : q.h >= 1440 ? "2K" : q.h + "p") + (q.fps > 30 ? Math.round(q.fps) : "");
function qMerge() { // الجودات الجاهزة + الجودات العالية (فيديو وصوت منفصلين)
  const map = new Map();
  qBaseList.forEach((q) => map.set(qScore(q), q));
  if (!dashFailed) qDash.forEach((q) => { if (!map.has(qScore(q))) map.set(qScore(q), q); });
  qList = [...map.values()].sort((a, b) => qScore(a) - qScore(b));
}
function qPick(pref) { // أعلى جودة ما تتجاوز المفضّلة، وإلا أقل جودة متاحة
  if (!qList.length) return null;
  if (pref < 10000) pref = pref * 1000 + 999; // تفضيل قديم محفوظ بالارتفاع فقط
  return [...qList].reverse().find((q) => qScore(q) <= pref) || qList[0];
}
function qRender() {
  $("qwrap").classList.toggle("on", qList.length > 1);
  const cur = curQ || (qSel ? qPick(qSel) : null);
  $("bqual").textContent = cur ? qLabel(cur) : qBaseH ? qBaseH + "p" : "HD";
  const pop = $("qpop");
  pop.replaceChildren();
  const mk = (label, score, on) => {
    const b = document.createElement("button");
    b.className = "qopt" + (on ? " on" : "");
    b.textContent = label;
    b.onclick = () => qChoose(score);
    pop.append(b);
  };
  [...qList].reverse().forEach((q) => mk(qLabel(q), qScore(q), qSel && cur && qScore(cur) === qScore(q)));
  mk("تلقائي", 0, !qSel);
}
function qSwitch(u) { // نبدّل الرابط ونكمل من نفس المكان بدون ما نرسل شي للباقين
  showLoader("buffer");
  loadBase(u, { t: video.currentTime, play: !video.paused, level: -1 });
}
function qChoose(score) {
  qPrefSet(score);
  qSel = score;
  const e = score ? qPick(score) : null;
  const t = video.currentTime || 0, wasPlaying = !video.paused;
  if (e && e.kind === "dash") {
    if (curQ !== e) { showLoader("buffer"); startDash(e, t, wasPlaying); }
  } else if (dashOn) { // رجوع من الجودة العالية للأساسية
    showLoader("buffer");
    curQ = e;
    loadBase(e && e.kind === "url" ? e.url : qBase, { t, play: wasPlaying, level: e && e.kind === "hls" ? e.idx : -1 });
  } else if (qMode === "hls" && hls) {
    hls.currentLevel = e && e.kind === "hls" ? e.idx : -1;
    curQ = e;
  } else if (qMode === "urls") {
    curQ = e;
    qSwitch(e && e.kind === "url" ? e.url : qBase);
  }
  qRender();
  closeQ();
  toast("🎞️ " + (e ? qLabel(e) : "تلقائي"));
}

// ---- الجودات العالية: فيديو لحاله + صوت لحاله، يتزامنون ----
const aud = new Audio();
aud.preload = "auto";
let dashOn = false, dashFailed = false, dashTimer = null;
function startDash(e, t = 0, wasPlaying = true) {
  dashOn = true; curQ = e;
  if (hls) { hls.destroy(); hls = null; }
  remote = true;
  audioGraph();
  video.src = rewrite(e.url, inDiscord, roomId, proxyTok);
  aud.src = rewrite(qAudio, inDiscord, roomId, proxyTok);
  video.muted = true; // الفيديو هنا بدون صوت، الصوت من العنصر الثاني
  video.addEventListener("loadedmetadata", () => {
    try { video.currentTime = t; aud.currentTime = t; } catch {}
    if (wasPlaying) { video.play().catch(() => {}); aud.play().catch(() => {}); }
    setTimeout(() => (remote = false), 900);
  }, { once: true });
  setTimeout(() => (remote = false), 10000);
  clearTimeout(dashTimer);
  dashTimer = setTimeout(() => { if (dashOn && video.readyState < 2) dashFallback(); }, 14000);
  qRender();
}
function stopDash() {
  if (!dashOn) return;
  dashOn = false; clearTimeout(dashTimer);
  aud.pause(); aud.removeAttribute("src"); try { aud.load(); } catch {}
  video.muted = false;
}
async function dashProbe(u) { // نفحص الرابط عشان نعرف سبب الفشل
  if (!u) return "no-src";
  try { const r = await fetch(u, { headers: { Range: "bytes=0-1" } }); return r.status + " " + (r.headers.get("content-type") || "?").slice(0, 16); }
  catch (x) { return "net:" + String(x.message).slice(0, 20); }
}
function dashFallback() { // الجودة العالية ما اشتغلت: نرجع للعادية تلقائي
  if (!dashOn) return;
  dashFailed = true;
  const t = video.currentTime || 0, wasPlaying = !video.paused;
  const bad = curQ, vsrc = video.currentSrc || video.src, asrc = aud.currentSrc || aud.src;
  const vcode = video.error ? video.error.code : "-", acode = aud.error ? aud.error.code : "-", vready = video.readyState;
  stopDash();
  qMerge();
  const cur = curQ ? qScore(curQ) : 0;
  const base = [...qBaseList].reverse().find((q) => qScore(q) <= cur) || qBaseList[0] || null;
  curQ = base;
  loadBase(base && base.kind === "url" ? base.url : qBase, { t, play: wasPlaying, level: base && base.kind === "hls" ? base.idx : -1 });
  qRender();
  toast("⚠️ الجودة العالية ما اشتغلت، رجعت للعادية", 3000);
  Promise.all([dashProbe(vsrc), dashProbe(asrc)]).then(([v, a]) => {
    toast("HQ ✗ " + (bad ? qLabel(bad) + " " + (bad.c || "") : "") + " | فيديو: خطأ " + vcode + " جاهزية " + vready + " (" + v + ") | صوت: خطأ " + acode + " (" + a + ")", 14000);
  });
}
aud.addEventListener("error", () => { if (dashOn) dashFallback(); });
video.addEventListener("play", () => { if (dashOn) aud.play().catch(() => {}); });
video.addEventListener("pause", () => { if (dashOn) aud.pause(); });
video.addEventListener("waiting", () => { if (dashOn) aud.pause(); });
video.addEventListener("playing", () => { if (dashOn) { try { aud.currentTime = video.currentTime; } catch {} aud.play().catch(() => {}); } });
video.addEventListener("seeking", () => { if (dashOn) { try { aud.currentTime = video.currentTime; } catch {} } });
video.addEventListener("ratechange", () => { if (dashOn) aud.playbackRate = video.playbackRate; });
setInterval(() => {
  if (!dashOn || video.paused || video.seeking || aud.readyState < 2) return;
  if (Math.abs(aud.currentTime - video.currentTime) > 0.3) { try { aud.currentTime = video.currentTime; } catch {} }
}, 700);

function openQ() { qOpen = true; $("qpop").classList.add("on"); closeVol(true); clearTimeout(qTimer); qTimer = setTimeout(closeQ, 5000); showControls(true); }
function closeQ() { qOpen = false; $("qpop").classList.remove("on"); clearTimeout(qTimer); }
$("bqual").onclick = () => (qOpen ? closeQ() : openQ());

// ---- تدوير + تكبير/تصغير ----
const view = { rot: 0, zoom: 1, x: 0, y: 0 };
function applyView() {
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  const sideways = view.rot % 180 !== 0;
  const sw = sideways ? H : W, sh = sideways ? W : H; // لما يدور 90° نبدّل العرض والطول عشان يملأ الشاشة
  view.zoom = Math.max(1, Math.min(4, view.zoom));
  if (view.zoom === 1) { view.x = 0; view.y = 0; }
  const mx = (W * view.zoom) / 2, my = (H * view.zoom) / 2;
  view.x = Math.max(-mx, Math.min(mx, view.x));
  view.y = Math.max(-my, Math.min(my, view.y));
  Object.assign(video.style, {
    width: sw + "px", height: sh + "px",
    left: (W - sw) / 2 + "px", top: (H - sh) / 2 + "px",
    transform: `translate(${view.x}px, ${view.y}px) rotate(${view.rot}deg) scale(${view.zoom})`,
  });
}
function resetView() { view.rot = 0; view.zoom = 1; view.x = 0; view.y = 0; applyView(); }
try { new ResizeObserver(applyView).observe(stage); } catch { window.addEventListener("resize", applyView); }
function layoutStage() {
  const W = innerWidth, H = innerHeight, st = stage.style;
  if (!stageRot) {
    st.position = st.left = st.top = st.width = st.height = st.transform = st.transformOrigin = st.zIndex = "";
  } else {
    st.position = "fixed"; st.left = "0"; st.top = "0"; st.zIndex = "8";
    st.width = H + "px"; st.height = W + "px"; st.transformOrigin = "0 0";
    st.transform = stageRot === 90 ? `translateX(${W}px) rotate(90deg)` : `translateY(${H}px) rotate(-90deg)`;
  }
}
function setStageRot(r) {
  stageRot = r;
  appEl.classList.toggle("rotated", !!r);
  layoutStage();
}
window.addEventListener("resize", layoutStage);
// تدوير: الواجهة كلها (الفيديو والأزرار) تدور معه
$("brot").onclick = () => { setStageRot(stageRot === 0 ? 90 : stageRot === 90 ? 270 : 0); showControls(); };

// ---- ملء الشاشة: قفل الاتجاه أفقي من ديسكورد، وإذا ما اشتغل ندوّر الواجهة بنفسنا ----
let fsTimer = null;
function setImmersive(on) {
  appEl.classList.toggle("immersive", on);
  $("bfs").innerHTML = on ? IC.fsx : IC.fs;
  try {
    if (on) { const f = appEl.requestFullscreen || appEl.webkitRequestFullscreen; f && f.call(appEl)?.catch?.(() => {}); }
    else if (document.fullscreenElement) document.exitFullscreen();
  } catch {}
  try { sdk?.commands?.setOrientationLockState?.({ lock_state: on ? 3 : 1, picture_in_picture_lock_state: 1, grid_lock_state: 1 })?.catch?.(() => {}); } catch {}
  clearTimeout(fsTimer);
  if (on) fsTimer = setTimeout(() => { if (appEl.classList.contains("immersive") && innerHeight > innerWidth * 1.1 && !stageRot) setStageRot(90); }, 900);
  else if (stageRot) setStageRot(0);
}
$("bfs").onclick = () => { setImmersive(!appEl.classList.contains("immersive")); showControls(); };
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && appEl.classList.contains("immersive")) setImmersive(false); });

// ---- لمس الشاشة: لمسة = إظهار الأزرار، قرصة = تكبير، سحب = تحريك (وهو مكبّر) ----
const loc = (e) => { // إحداثيات اللمس داخل الواجهة (حتى لو مدوّرة)
  const W = innerWidth, H = innerHeight;
  if (stageRot === 90) return { x: e.clientY, y: W - e.clientX };
  if (stageRot === 270) return { x: H - e.clientY, y: e.clientX };
  return { x: e.clientX, y: e.clientY };
};
let tapTimer = null;
const pts = new Map();
let gs = null;
const pdist = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".ctl")) return;
  try { stage.setPointerCapture(e.pointerId); } catch {}
  pts.set(e.pointerId, loc(e));
  if (!gs) gs = { t: performance.now(), moved: 0, pinch: false, z0: view.zoom, d0: 1 };
  if (pts.size === 2) { gs.pinch = true; gs.z0 = view.zoom; gs.d0 = pdist() || 1; }
});
stage.addEventListener("pointermove", (e) => {
  const p = pts.get(e.pointerId);
  if (!p || !gs) return;
  const q = loc(e), dx = q.x - p.x, dy = q.y - p.y;
  p.x = q.x; p.y = q.y;
  gs.moved += Math.abs(dx) + Math.abs(dy);
  if (pts.size === 2) { view.zoom = (gs.z0 * pdist()) / gs.d0; applyView(); }
  else if (pts.size === 1 && view.zoom > 1) { view.x += dx; view.y += dy; applyView(); }
});
const endPtr = (e) => {
  if (!pts.delete(e.pointerId)) return;
  if (pts.size === 1 && gs) { gs.z0 = view.zoom; gs.d0 = 1; }
  if (pts.size === 0 && gs) {
    if (!gs.pinch && gs.moved < 12 && performance.now() - gs.t < 400) {
      if (volOpen) closeVol(); else if (qOpen) closeQ(); else if (cOpen) closeC();
      else {
        const lx = loc(e).x, w = stage.clientWidth;
        if (tapSkip(lx)) clearTimeout(tapTimer);
        else if (lx < w * 0.38 || lx > w * 0.62) { clearTimeout(tapTimer); tapTimer = setTimeout(toggleControls, 260); } // ننتظر: يمكن لمستين
        else toggleControls();
      }
    }
    gs = null;
  }
};
stage.addEventListener("pointerup", endPtr);
stage.addEventListener("pointercancel", endPtr);


// ================== ترجمة + تقديم/تأخير + سرعة ==================
let cues = [], subUrl = "", cueIdx = 0, lastCueText = null;
let subTracks = [], cOpen = false, cTimer = null;
const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const subsEl = $("subs");
const curTime = () => (currentYt ? ytTime : video.currentTime);

function parseTs(t) {
  const m = t.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
  if (!m) return NaN;
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +("0." + m[4]);
}
function parseSubs(txt) {
  const out = [];
  txt = txt.replace(/^﻿/, "").replace(/\r/g, "");
  for (const block of txt.split(/\n\n+/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const s = parseTs(a), e = parseTs(b.trim().split(/\s+/)[0]);
    if (isNaN(s) || isNaN(e)) continue;
    const text = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "").trim();
    if (text) out.push({ s, e, text });
  }
  return out.sort((x, y) => x.s - y.s);
}
async function loadSubUrl(u) {
  if (u === subUrl) return;
  subUrl = u; cues = []; cueIdx = 0; lastCueText = null; renderSub("");
  if (!u) return updateCC();
  const get = async (enc) => {
    const r = await fetch(rewrite(u, inDiscord, roomId, proxyTok));
    if (!r.ok) throw new Error(r.status);
    return new TextDecoder(enc, { fatal: enc === "utf-8" }).decode(await r.arrayBuffer());
  };
  let list = [];
  try { list = parseSubs(await get("utf-8")); }
  catch { try { list = parseSubs(await get("windows-1256")); } catch {} } // ملفات عربية قديمة
  if (u !== subUrl) return;
  cues = list;
  if (!list.length) toast("⚠️ ما قدرت أقرأ ملف الترجمة");
  updateCC();
}
function renderSub(t) {
  if (t === lastCueText) return;
  lastCueText = t;
  subsEl.innerHTML = "";
  if (t) { const sp = document.createElement("span"); sp.textContent = t; subsEl.appendChild(sp); }
}
function tickSubs() {
  if (!cues.length) return;
  const t = curTime();
  if (cueIdx >= cues.length || cues[cueIdx].s > t + 0.3) cueIdx = 0; // رجع للخلف
  let c = null;
  for (let i = cueIdx; i < cues.length; i++) {
    if (cues[i].s > t) break;
    cueIdx = i;
    if (t <= cues[i].e) { c = cues[i]; break; }
  }
  renderSub(c ? c.text : "");
}
setInterval(tickSubs, 200);

// اللغة المختارة: كل شخص يختار لحاله ويتذكرها (__off = بدون ترجمة)
function chosenTrack() {
  if (!subTracks.length) return null;
  const saved = lsGet("sublang");
  if (saved === "__off") return null;
  return subTracks.find((x) => x.lang === saved) || subTracks[0];
}
function updateCC() {
  const b = $("bcc"), t = chosenTrack();
  b.classList.toggle("off", !subTracks.length);
  b.classList.toggle("on", !!t);
  const pop = $("cpop");
  pop.innerHTML = "";
  const add = (label, val, on) => {
    const o = document.createElement("button");
    o.className = "qopt" + (on ? " on" : ""); o.textContent = label;
    o.onclick = () => { lsSet("sublang", val); closeC(); pickSub(); toast(val === "__off" ? "💬 بدون ترجمة" : "💬 " + val); showControls(); };
    pop.appendChild(o);
  };
  add("بدون ترجمة", "__off", !t);
  subTracks.forEach((x) => add(x.lang, x.lang, t === x));
}
function pickSub() { const t = chosenTrack(); loadSubUrl(t ? t.url : ""); updateCC(); }
function setSubs(list) {
  list = Array.isArray(list) ? list : [];
  if (JSON.stringify(list) === JSON.stringify(subTracks)) return;
  const had = subTracks.length;
  subTracks = list;
  pickSub();
  if (list.length > had) toast("💬 ترجمة جديدة: " + list[list.length - 1].lang);
}
function openC() { cOpen = true; $("cpop").classList.add("on"); closeVol(true); closeQ(); clearTimeout(cTimer); cTimer = setTimeout(closeC, 6000); showControls(true); }
function closeC() { cOpen = false; $("cpop").classList.remove("on"); clearTimeout(cTimer); }
$("bcc").onclick = () => {
  if (!subTracks.length) { toast("💬 ما في ترجمة. اكتب في الشات: .ترجمة عربي + رابط الملف"); return showControls(); }
  cOpen ? closeC() : openC();
};
updateCC();

// تقديم / تأخير 10 ثواني (يتزامن مع الكل)
const skipfx = $("skipfx");
function skipBy(d, fromTap) {
  if (currentYt) { ytCmd("seekTo", [Math.max(0, ytTime + d), true]); }
  else {
    const dur = isFinite(video.duration) ? video.duration : 1e9;
    video.currentTime = Math.min(Math.max(0, video.currentTime + d), dur);
  }
  skipfx.textContent = (d > 0 ? "+" : "−") + Math.abs(d) + "s";
  skipfx.style.left = d > 0 ? "auto" : "14%"; skipfx.style.right = d > 0 ? "14%" : "auto";
  skipfx.classList.remove("go"); void skipfx.offsetWidth; skipfx.classList.add("go");
  if (!fromTap) showControls();
}

// سرعة التشغيل (لكل شخص لحاله)
const SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75];
let spdI = 0;
function setSpeed(i) {
  spdI = i;
  const v = SPEEDS[i];
  video.playbackRate = v;
  $("bspd").textContent = v + "x";
  $("bspd").classList.toggle("on", v !== 1);
}
$("bspd").onclick = () => { setSpeed((spdI + 1) % SPEEDS.length); showControls(); };
video.addEventListener("loadedmetadata", () => { video.playbackRate = SPEEDS[spdI]; });

// لمستين على اليمين/اليسار = تقديم/تأخير
let lastTap = { t: 0, x: 0 };
function tapSkip(x) {
  const now = performance.now(), w = stage.clientWidth, side = x < w * 0.38 ? -1 : x > w * 0.62 ? 1 : 0;
  if (side && now - lastTap.t < 320 && Math.abs(x - lastTap.x) < w * 0.3) { skipBy(side * 10, true); lastTap.t = 0; return true; }
  lastTap = { t: now, x };
  return false;
}

// ================== شاشة التحميل المتحركة ==================
let loaderKind = "", loaderT = 0, loaderTimer = null;
function showLoader(kind = "start") {
  const l = $("loader");
  clearTimeout(loaderTimer);
  if (kind === "buffer" && l.classList.contains("on")) return; // لا نغيّر شاشة البداية
  loaderKind = kind;
  loaderT = performance.now();
  l.className = "on" + (kind === "buffer" ? " buffer" : "");
  $("ltext").textContent = kind === "buffer" ? "جاري التحميل" : "جاري تشغيل الفيديو";
  $("ltitle").textContent = kind === "start" ? currentTitle : "";
}
function hideLoader() {
  clearTimeout(loaderTimer);
  const wait = loaderKind === "start" ? Math.max(0, 1600 - (performance.now() - loaderT)) : 0; // تبقى ظاهرة ثانية ونص على الأقل
  loaderTimer = setTimeout(() => $("loader").classList.remove("on"), wait);
}


setupDiscord()
  .catch((e) => {
    statusEl.textContent = "خطأ: " + e.message;
    const st = $("stagetxt"); if (st) st.textContent = "تعذّر الاتصال، تقدر تكمل";
  })
  .finally(() => {
    connect();
    netDone = true;
    reveal();
  });
