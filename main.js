import { DiscordSDK } from "@discord/embedded-app-sdk";
import Hls from "hls.js";
import { startFire } from "./fire.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const statusEl = $("statusText");

const inDiscord = new URLSearchParams(location.search).has("frame_id");
let sdk = null;
let roomId = "local-test";
let remote = false; // يمنع حلقة الأحداث لما نطبّق أمر جاء من شخص ثاني
let currentUrl = "";
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

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("on");
  setTimeout(() => t.classList.remove("on"), 2600);
}

function vibrate(p) { try { navigator.vibrate?.(p); } catch {} }

$("enter").addEventListener("click", () => {
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
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "rpc.activities.write"],
  });

  // داخل ديسكورد كل الطلبات تمر عبر /.proxy
  const res = await fetch("/.proxy/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await res.json();
  await sdk.commands.authenticate({ access_token });

  roomId = sdk.instanceId; // كل من في نفس الـ Activity يتشارك نفس الروم
}

// ================== مشغّل الفيديو ==================
function setSource(url) {
  if (!url || url === currentUrl) return;
  currentUrl = url;
  if (hls) { hls.destroy(); hls = null; }
  if (url.includes(".m3u8") && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(video);
  } else {
    video.src = url;
  }
}

function applyState(s) {
  remote = true;
  setSource(s.url);
  if (Math.abs(video.currentTime - s.time) > 1.5) video.currentTime = s.time;
  if (s.playing && video.paused) video.play().catch(() => {});
  if (!s.playing && !video.paused) video.pause();
  setTimeout(() => (remote = false), 300);
}

// ================== WebSocket ==================
let ws;
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const base = inDiscord ? "/.proxy" : "";
  ws = new WebSocket(`${proto}://${location.host}${base}/ws/${roomId}`);
  ws.onopen = () => (statusEl.textContent = "متصل 🔥");
  ws.onclose = () => {
    statusEl.textContent = "انقطع الاتصال، إعادة المحاولة...";
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") {
      if (msg.url && msg.url !== currentUrl) toast("🎬 تم تشغيل فيديو جديد");
      applyState(msg);
    }
  };
}

const send = (obj) => ws?.readyState === 1 && ws.send(JSON.stringify(obj));

video.addEventListener("play", () => !remote && send({ type: "play", time: video.currentTime }));
video.addEventListener("pause", () => !remote && send({ type: "pause", time: video.currentTime }));
video.addEventListener("seeked", () => !remote && send({ type: "seek", time: video.currentTime }));

$("load").onclick = () => {
  const url = $("url").value.trim();
  if (!url) return toast("الصق رابط الفيديو أول");
  setSource(url);
  send({ type: "load", url });
};

setupDiscord()
  .catch((e) => (statusEl.textContent = "خطأ: " + e.message))
  .finally(connect);
