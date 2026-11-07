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

// كتابة تلقائية للعبارة
const line = "شاهد مع أصحابك… بنفس اللحظة";
let ti = 0;
const typer = setInterval(() => {
  $("typed").textContent = line.slice(0, ++ti);
  if (ti >= line.length) clearInterval(typer);
}, 70);

// ====== مراحل التحميل (تتغير النصوص كل شوي) ======
const stages = ["تهيئة الجلسة…", "الاتصال بالسيرفر…", "تجهيز المشغّل…", "إشعال النار 🔥", "جاهز!"];
const vers = ["Booting…", "Creating Session…", "Connecting…", "Preparing Player…", "Ready"];
let stageI = 0, minDone = false, netDone = false;
const stageTimer = setInterval(() => {
  if (stageI < stages.length - 2) stageI++;
  $("stage").textContent = stages[stageI];
  $("ver").textContent = "V1.0.0 · " + vers[stageI];
}, 900);
setTimeout(() => { minDone = true; reveal(); }, 2400);
setTimeout(() => { netDone = true; reveal(); }, 7000); // احتياط لو تأخر الاتصال

function reveal() {
  if (!minDone || !netDone) return;
  clearInterval(stageTimer);
  $("stage").textContent = stages[4];
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
  setTimeout(() => { splash.remove(); fire.stop(); }, 1800);
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
    if (s.playing && video.paused) video.play().catch(() => { setHint("loading", "👆 اضغط ▶️ في المشغّل للتشغيل"); });
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
video.addEventListener("waiting", () => currentUrl && setHint("loading", "⏳ جاري التحميل"));
video.addEventListener("playing", () => setHint("ok", "▶️ يشتغل الحين" + (currentTitle ? " · " + currentTitle : "")));

// ================== الصوت (محلي لكل شخص، يوصل 200%) ==================
let actx = null, gainNode = null;
const volEl = $("vol");

function setVolume(pct) {
  pct = Math.max(0, Math.min(200, Math.round(Number(pct) || 0)));
  volEl.value = pct;
  $("vlabel").textContent = pct + "%";
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
volEl.addEventListener("input", () => setVolume(volEl.value));
$("vdn").onclick = () => setVolume(Number(volEl.value) - 10);
$("vup").onclick = () => setVolume(Number(volEl.value) + 10);

setupDiscord()
  .catch((e) => {
    statusEl.textContent = "خطأ: " + e.message;
    $("stage").textContent = "تعذّر الاتصال، تقدر تكمل";
  })
  .finally(() => {
    connect();
    netDone = true;
    reveal();
  });
