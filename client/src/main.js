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

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("on");
  setTimeout(() => t.classList.remove("on"), 2600);
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

function setSource(url) {
  if (!url || url === currentUrl) return;
  currentUrl = url;
  resetView();

  const id = ytId(url);
  if (id) return setYouTube(id);

  if (currentYt) {
    currentYt = null;
    if (ytFrame) ytFrame.src = "about:blank";
    $("ytbox").style.display = "none";
    video.style.display = "block";
  }

  const src = rewrite(url, inDiscord, roomId, proxyTok);
  if (hls) { hls.destroy(); hls = null; }
  if (src.includes(".m3u8") || url.includes(".m3u8")) {
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
    }
  } else {
    video.src = src;
  }
}

function applyState(s) {
  remote = true;
  setSource(s.url);
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
  const src = video.currentSrc || video.src;
  appEl.classList.remove("clean"); // نرجّع النصوص عشان يشوف الخطأ
  hideLoader();
  if (!src || src.endsWith("/")) return;
  let info = "خطأ بالفيديو (code " + (video.error?.code ?? "?") + ")";
  try {
    const r = await fetch(src, { headers: { Range: "bytes=0-0" } });
    info = "السيرفر رد " + r.status;
    if (!r.ok) info += " | " + (await r.text()).slice(0, 150);
    else info += " | " + (r.headers.get("content-type") || "");
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
  fsx: SV('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
};
$("bplay").innerHTML = IC.play;
$("bvol").innerHTML = IC.vol(100);
$("bzin").innerHTML = IC.zin;
$("bzout").innerHTML = IC.zout;
$("brot").innerHTML = IC.rot;
$("bfs").innerHTML = IC.fs;

// ---- إظهار/إخفاء الأزرار ----
let ctlTimer = null;
function showControls(stay) {
  controls.classList.add("show");
  clearTimeout(ctlTimer);
  if (!stay) ctlTimer = setTimeout(() => { if (!video.paused && !volOpen) controls.classList.remove("show"); }, 3500);
}
function toggleControls() {
  if (controls.classList.contains("show")) { controls.classList.remove("show"); closeVol(true); }
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
const seekFrac = (e) => { const r = seekEl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
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
function setVolume(pct) {
  pct = Math.max(0, Math.min(200, Math.round(Number(pct) || 0)));
  $("vpct").textContent = pct + "%";
  $("vfill").style.height = pct / 2 + "%";
  $("vthumb").style.bottom = `calc(${pct / 2}% - 9px)`;
  $("bvol").innerHTML = IC.vol(pct);
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      gainNode = actx.createGain();
      actx.createMediaElementSource(video).connect(gainNode);
      gainNode.connect(actx.destination);
    }
    if (actx.state === "suspended") actx.resume();
    video.volume = 1;
    gainNode.gain.value = pct / 100; // أكثر من 1 = تضخيم فوق الصوت الأصلي
  } catch {
    video.volume = Math.min(1, pct / 100); // احتياط بدون تضخيم
  }
  try { localStorage.setItem("vol", String(pct)); } catch {}
}
function armVolTimer() { clearTimeout(volTimer); volTimer = setTimeout(() => closeVol(), 3000); }
function openVol() { volOpen = true; $("vpop").classList.add("on"); armVolTimer(); showControls(true); }
function closeVol(quiet) { volOpen = false; $("vpop").classList.remove("on"); clearTimeout(volTimer); if (!quiet) showControls(); }
const vt = $("vtrack");
function volFromEvent(e) {
  const r = vt.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
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
const zoomBy = (d) => { view.zoom = +(view.zoom + d).toFixed(2); applyView(); toast("🔍 " + Math.round(view.zoom * 100) + "%"); showControls(); };
$("bzin").onclick = () => zoomBy(0.5);
$("bzout").onclick = () => zoomBy(-0.5);
$("brot").onclick = () => { view.rot = (view.rot + 90) % 360; applyView(); toast("↻ " + view.rot + "°"); showControls(); };

// ---- ملء الشاشة ----
function setImmersive(on) {
  appEl.classList.toggle("immersive", on);
  $("bfs").innerHTML = on ? IC.fsx : IC.fs;
  try {
    if (on) { const f = appEl.requestFullscreen || appEl.webkitRequestFullscreen; f && f.call(appEl)?.catch?.(() => {}); }
    else if (document.fullscreenElement) document.exitFullscreen();
  } catch {}
}
$("bfs").onclick = () => { setImmersive(!appEl.classList.contains("immersive")); showControls(); };
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && appEl.classList.contains("immersive")) setImmersive(false); });

// ---- لمس الشاشة: لمسة = إظهار الأزرار، قرصة = تكبير، سحب = تحريك (وهو مكبّر) ----
const pts = new Map();
let gs = null;
const pdist = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".ctl")) return;
  try { stage.setPointerCapture(e.pointerId); } catch {}
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gs) gs = { t: performance.now(), moved: 0, pinch: false, z0: view.zoom, d0: 1 };
  if (pts.size === 2) { gs.pinch = true; gs.z0 = view.zoom; gs.d0 = pdist() || 1; }
});
stage.addEventListener("pointermove", (e) => {
  const p = pts.get(e.pointerId);
  if (!p || !gs) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  gs.moved += Math.abs(dx) + Math.abs(dy);
  if (pts.size === 2) { view.zoom = (gs.z0 * pdist()) / gs.d0; applyView(); }
  else if (pts.size === 1 && view.zoom > 1) { view.x += dx; view.y += dy; applyView(); }
});
const endPtr = (e) => {
  if (!pts.delete(e.pointerId)) return;
  if (pts.size === 1 && gs) { gs.z0 = view.zoom; gs.d0 = 1; }
  if (pts.size === 0 && gs) {
    if (!gs.pinch && gs.moved < 12 && performance.now() - gs.t < 400) volOpen ? closeVol() : toggleControls();
    gs = null;
  }
};
stage.addEventListener("pointerup", endPtr);
stage.addEventListener("pointercancel", endPtr);

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
