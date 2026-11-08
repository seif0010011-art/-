import asyncio
import hmac
import ipaddress
import os
import re
import socket
import time
from urllib.parse import quote, urljoin, urlparse
from pathlib import Path

import httpx

try:
    import yt_dlp
except ImportError:  # يشتغل السيرفر حتى لو الأداة غير مثبتة
    yt_dlp = None
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")

app = FastAPI()

# room_id -> {"state", "clients", "host", "free", "last_shock"}
rooms: dict[str, dict] = {}
# channel_id (الروم الصوتي) -> room_id (instance النشاط)
channel_rooms: dict[str, str] = {}
# أمر تشغيل وصل قبل ما أحد يفتح النشاط
pending: dict[str, dict] = {}
BOT_KEY = os.getenv("DISCORD_BOT_TOKEN", "")
SECRET = (BOT_KEY or CLIENT_SECRET or "dev-secret").encode()


def room_token(room: str) -> str:
    """توكن بدون حالة: يثبت أن الطلب جاء من نشاط حقيقي حتى لو السيرفر فيه أكثر من نسخة."""
    return hmac.new(SECRET, room.encode(), "sha256").hexdigest()[:32]


class TokenRequest(BaseModel):
    code: str


@app.post("/api/token")
async def exchange_token(body: TokenRequest):
    """يبدّل code القادم من ديسكورد بـ access_token (السر يبقى في السيرفر)."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://discord.com/api/oauth2/token",
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": body.code,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail="token exchange failed")
    return {"access_token": r.json()["access_token"]}


# ================== استخراج الفيديو من صفحات المواقع (yt-dlp) ==================
DIRECT_EXT = (".mp4", ".m3u8", ".webm", ".mkv", ".mov", ".m4v", ".mp3")
media_headers: dict[str, dict] = {}  # رابط مباشر -> هيدرز يحتاجها الموقع (Referer...)


def is_direct(url: str) -> bool:
    return url.startswith("/.proxy/") or urlparse(url).path.lower().endswith(DIRECT_EXT)


def _cookie_file():
    """كوكيز اختيارية (متغير YTDLP_COOKIES بصيغة Netscape) لتجاوز حظر يوتيوب على السيرفرات."""
    data = os.getenv("YTDLP_COOKIES", "").strip()
    if not data:
        return None
    path = "/tmp/yt_cookies.txt"
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(data + "\n")
        return path
    except Exception as e:
        print("cookies write failed:", repr(e))
        return None


def _is_yt(url: str) -> bool:
    try:
        h = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    return h == "youtu.be" or h.endswith("youtube.com") or h.endswith("youtube-nocookie.com")


def _pick_muxed(info: dict):
    """يختار من نتيجة yt-dlp الجودات اللي فيها صوت وصورة معاً. يرجّع None لو ما في."""
    quals = {}
    for f in info.get("formats") or []:
        h, u, proto = f.get("height"), f.get("url"), f.get("protocol") or ""
        if not h or not u or h > 1080 or f.get("vcodec") == "none" or f.get("acodec") == "none":
            continue
        if not (proto.startswith("http") or proto.startswith("m3u8")):
            continue
        rank = (proto.startswith("http"), f.get("ext") == "mp4", f.get("tbr") or 0)
        if h not in quals or rank > quals[h][0]:
            quals[h] = (rank, u, dict(f.get("http_headers") or {}))
    if not quals:
        return None
    hs = sorted(quals)
    qh = max([h for h in hs if h <= 720] or [hs[0]])
    # كل الجودات HLS: نمرّر الملف الرئيسي (master) والمشغّل يعرض الجودات بنفسه
    masters = {f.get("manifest_url") for f in info.get("formats") or []
               if f.get("manifest_url") and (f.get("protocol") or "").startswith("m3u8")
               and f.get("vcodec") != "none" and f.get("acodec") != "none"}
    if len(masters) == 1 and not any(v[0][0] for v in quals.values()):
        return next(iter(masters)), info.get("title") or "", quals[qh][2], [], qh
    qlist = [{"h": h, "url": quals[h][1], "hd": quals[h][2]} for h in hs]
    return quals[qh][1], info.get("title") or "", quals[qh][2], qlist, qh


class _YtLog:
    """يلتقط تحذيرات yt-dlp عشان نعرف سبب غياب الجودات."""

    def __init__(self):
        self.msgs = []

    def debug(self, m):
        pass

    def info(self, m):
        pass

    def warning(self, m):
        m = str(m).replace("\n", " ").strip()
        if m and m not in self.msgs:
            self.msgs.append(m)

    def error(self, m):
        self.warning(m)


def _yt_env() -> str:
    import shutil
    import subprocess
    from importlib.util import find_spec
    try:
        ver = yt_dlp.version.__version__
    except Exception:
        ver = "?"
    deno = "none"
    if shutil.which("deno"):
        try:
            deno = subprocess.run(["deno", "--version"], capture_output=True, text=True, timeout=10).stdout.split("\n")[0][:20] or "err"
        except Exception as e:
            deno = "err:" + str(e)[:30]
    return f"ytdlp {ver} | {deno} | ejs {'yes' if find_spec('yt_dlp_ejs') else 'NO'}"


def _resolve_yt(url: str):
    """يوتيوب: نجرّب أكثر من عميل (client) لأن بعضها يعطي فيديو+صوت جاهز وبعضها لا."""
    cf = _cookie_file()
    attempts = [(None, True), (["web_safari"], True), (["tv"], True), (["mweb"], True), (["ios"], False), (["android_vr"], False)]
    diags, blocked, t0 = [], 0, time.time()
    log = _YtLog()
    for clients, use_cf in attempts:
        if time.time() - t0 > 80:
            break
        name = ",".join(clients) if clients else "default"
        opts = {"quiet": True, "logger": log, "noplaylist": True, "skip_download": True,
                "socket_timeout": 20, "ignore_no_formats_error": True, "format": "best",
                "js_runtimes": {"deno": {}}, "remote_components": ["ejs:github"]}
        if clients:
            opts["extractor_args"] = {"youtube": {"player_client": clients}}
        if use_cf and cf:
            opts["cookiefile"] = cf
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as e:
            msg = str(e)
            if "Sign in to confirm" in msg or "not a bot" in msg:
                blocked += 1
            diags.append(f"{name}: {msg[-70:]}")
            continue
        if info.get("entries"):
            info = next(iter(info["entries"]))
        res = _pick_muxed(info)
        if res:
            print("yt ok via", name, flush=True)
            return res
        fm = info.get("formats") or []
        v = sum(1 for f in fm if f.get("vcodec") not in (None, "none") and f.get("acodec") in (None, "none"))
        a = sum(1 for f in fm if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none"))
        diags.append(f"{name}: {len(fm)}f v{v} a{a}")
    print("yt failed:", diags, flush=True)
    if blocked and blocked == len(diags):
        raise RuntimeError("YT_BLOCKED")
    warn = " ; ".join(m[:110] for m in log.msgs[:3])
    raise RuntimeError(("YT " + " | ".join(diags) + " || WARN: " + warn + " || " + _yt_env())[-900:])


def _resolve_sync(url: str):
    if yt_dlp is None:
        raise RuntimeError("yt-dlp غير مثبت")
    if _is_yt(url):
        return _resolve_yt(url)
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "socket_timeout": 20,
        # نفضّل 480-720p جاهز (فيديو+صوت)، بعده HLS، وبعده أي شي متاح
        "format": "best[ext=mp4][protocol^=http][height<=?720][height>=?480]/best[protocol^=m3u8][height<=?720]/best[ext=mp4][protocol^=http]/best[protocol^=http]/best",
    }
    cf = _cookie_file()
    if cf:
        opts["cookiefile"] = cf
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        if "Sign in to confirm" in str(e) or "not a bot" in str(e):
            raise RuntimeError("YT_BLOCKED") from e
        raise
    if info.get("entries"):
        info = next(iter(info["entries"]))
    direct = info.get("url")
    if not direct:
        raise RuntimeError("ما لقيت رابط فيديو")
    # كل الجودات اللي فيها صوت وصورة (حد أقصى 1080p) عشان كل عضو يختار اللي يناسب نتّه
    quals = {}
    for f in info.get("formats") or []:
        h, u, proto = f.get("height"), f.get("url"), f.get("protocol") or ""
        if not h or not u or h > 1080 or f.get("vcodec") == "none" or f.get("acodec") == "none":
            continue
        if not (proto.startswith("http") or proto.startswith("m3u8")):
            continue
        rank = (proto.startswith("http"), f.get("ext") == "mp4", f.get("tbr") or 0)
        if h not in quals or rank > quals[h][0]:
            quals[h] = (rank, u, dict(f.get("http_headers") or {}))
    qlist = [{"h": h, "url": v[1], "hd": v[2]} for h, v in sorted(quals.items())]
    return direct, info.get("title") or "", dict(info.get("http_headers") or {}), qlist, info.get("height")


async def resolve(url: str, title: str = ""):
    """يرجّع (رابط مباشر, عنوان). الروابط المباشرة تمر كما هي."""
    if is_direct(url):
        return url, title, [], None
    if not await asyncio.to_thread(_safe_url, url):
        raise RuntimeError("رابط غير مسموح")
    direct, t, headers, quals, qh = await asyncio.wait_for(asyncio.to_thread(_resolve_sync, url), 100)
    if len(media_headers) > 300:
        media_headers.clear()
    media_headers[direct] = headers
    for q in quals:
        media_headers[q["url"]] = q.pop("hd")
    return direct, (t or title), quals, qh


class PlayRequest(BaseModel):
    channel_id: str
    url: str
    title: str = ""


@app.post("/api/play")
async def api_play(body: PlayRequest, x_key: str = Header(default="")):
    """يستدعيه البوت فقط (يتحقق بمفتاح سري) لتشغيل رابط في روم صوتي."""
    if not BOT_KEY or not hmac.compare_digest(x_key, BOT_KEY):
        raise HTTPException(status_code=403, detail="forbidden")
    if not body.url.startswith(("http://", "https://", "/.proxy/")):
        raise HTTPException(status_code=400, detail="bad url")
    try:
        play_url, play_title, play_q, play_qh = await resolve(body.url, body.title)
    except Exception as e:
        print("resolve failed:", repr(e), flush=True)
        return {"status": "yt_blocked" if "YT_BLOCKED" in str(e) else "unsupported", "detail": str(e)[-1000:]}
    room_id = channel_rooms.get(body.channel_id)
    room = rooms.get(room_id) if room_id else None
    if room is None:
        pending[body.channel_id] = {"url": play_url, "title": play_title, "q": play_q, "qh": play_qh}
        return {"status": "pending"}
    room["state"].update(subs=[], url=play_url, title=play_title, qualities=play_q, qh=play_qh, playing=True, time=0.0, updated_at=time.time())
    await broadcast(room, {"type": "state", **current_state(room)})
    return {"status": "playing"}


class SubRequest(BaseModel):
    channel_id: str
    url: str = ""
    lang: str = ""


@app.post("/api/sub")
async def api_sub(body: SubRequest, x_key: str = Header(default="")):
    """يستدعيه البوت: يضع ملف ترجمة (.srt/.vtt) للفيديو الشغّال. url فاضي = إلغاء الترجمة."""
    if not BOT_KEY or not hmac.compare_digest(x_key, BOT_KEY):
        raise HTTPException(status_code=403, detail="forbidden")
    if body.url and not body.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="bad url")
    room_id = channel_rooms.get(body.channel_id)
    room = rooms.get(room_id) if room_id else None
    if room is None:
        return {"status": "no_room"}
    lang = (body.lang or "ترجمة").strip()[:24]
    if not body.url:
        room["state"]["subs"] = []          # url فاضي = حذف كل الترجمات
    else:
        subs = [x for x in room["state"].get("subs", []) if x["lang"] != lang]   # نفس اللغة تتبدّل
        subs.append({"lang": lang, "url": body.url})
        room["state"]["subs"] = subs[:12]
    await broadcast(room, {"type": "state", **current_state(room)})
    return {"status": "ok"}


def _safe_url(url: str) -> bool:
    """يمنع الوصول للشبكات الداخلية (حماية SSRF)."""
    try:
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            return False
        for info in socket.getaddrinfo(u.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except Exception:
        return False


@app.get("/api/proxy")
async def api_proxy(request: Request, url: str, room: str = "", p: int = 0, t: str = ""):
    """يمرّر الفيديو (mp4 / m3u8) من أي رابط خارجي، فلا تحتاج URL Mapping لكل دومين.
    يشتغل فقط لروم موجود (room) عشان ما يتحول لبروكسي مفتوح."""
    if not room or not hmac.compare_digest(t, room_token(room)):
        print("proxy: bad token for room", repr(room))
        raise HTTPException(status_code=403, detail="bad token")
    prefix = "/.proxy" if p else ""

    def wrap(u: str) -> str:
        return f"{prefix}/api/proxy?p={p}&room={quote(room, safe='')}&t={quote(t, safe='')}&url={quote(u, safe='')}"

    fwd = {"User-Agent": "Mozilla/5.0", "Accept-Encoding": "identity"}
    if request.headers.get("range"):
        fwd["Range"] = request.headers["range"]

    client = httpx.AsyncClient(timeout=httpx.Timeout(30, read=60))
    cur = url
    r = None
    try:
        for _ in range(5):
            if not await asyncio.to_thread(_safe_url, cur):
                print("proxy: blocked url", cur)
                raise HTTPException(status_code=400, detail="blocked url")
            extra = {k: v for k, v in media_headers.get(url, {}).items() if k.lower() in ("user-agent", "referer", "origin", "cookie")}
            r = await client.send(client.build_request("GET", cur, headers={**fwd, **extra}), stream=True)
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                cur = urljoin(cur, r.headers["location"])
                await r.aclose()
                continue
            break
        else:
            raise HTTPException(status_code=400, detail="too many redirects")
    except HTTPException:
        await client.aclose()
        raise
    except Exception as e:
        await client.aclose()
        print("proxy fetch failed:", repr(e))
        raise HTTPException(status_code=502, detail="fetch failed: " + type(e).__name__)

    ctype = r.headers.get("content-type", "")
    if ".m3u8" in urlparse(cur).path or "mpegurl" in ctype.lower():
        text = (await r.aread()).decode("utf-8", "replace")
        await r.aclose()
        await client.aclose()
        out = []
        for line in text.splitlines():
            if line.startswith("#"):
                line = re.sub(r'URI="([^"]+)"', lambda m: f'URI="{wrap(urljoin(cur, m.group(1)))}"', line)
            elif line.strip():
                line = wrap(urljoin(cur, line.strip()))
            out.append(line)
        return Response("\n".join(out), media_type="application/vnd.apple.mpegurl")

    headers = {k: r.headers[k] for k in ("content-type", "content-length", "accept-ranges", "content-range") if k in r.headers}

    async def gen():
        try:
            async for chunk in r.aiter_raw():
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()

    return StreamingResponse(gen(), status_code=r.status_code, headers=headers)


def current_state(room: dict) -> dict:
    s = dict(room["state"])
    if s["playing"]:
        s["time"] += time.time() - s["updated_at"]
    return s


async def safe_send(room: dict, ws: WebSocket, payload: dict):
    try:
        await ws.send_json(payload)
    except Exception:
        room["clients"].discard(ws)


async def broadcast(room: dict, payload: dict, exclude: WebSocket | None = None):
    for c in list(room["clients"]):
        if c is not exclude:
            await safe_send(room, c, payload)


async def send_roles(room: dict):
    """يبلّغ كل واحد هل هو المضيف + عدد المشاهدين."""
    n = len(room["clients"])
    for c in list(room["clients"]):
        await safe_send(
            room,
            c,
            {"type": "role", "host": c is room["host"], "free": room["free"], "count": n},
        )


@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str):
    await ws.accept()
    await ws.send_json({"type": "tok", "tok": room_token(room_id)})
    room = rooms.setdefault(
        room_id,
        {
            "state": {"url": "", "subs": [], "qualities": [], "playing": False, "time": 0.0, "updated_at": time.time()},
            "clients": set(),
            "host": None,
            "free": False,
            "last_shock": 0.0,
        },
    )
    room["clients"].add(ws)
    if room["host"] is None:
        room["host"] = ws  # أول واحد يدخل هو المضيف
    await send_roles(room)
    await ws.send_json({"type": "state", **current_state(room)})

    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            st = room["state"]

            # ---- رسائل مفتوحة للجميع ----
            if kind == "ping":
                await safe_send(room, ws, {"type": "pong", "t": msg.get("t")})
                continue

            if kind == "hello":
                ch = str(msg.get("channel", ""))[:32]
                if ch:
                    channel_rooms[ch] = room_id
                    p = pending.pop(ch, None)
                    if p:
                        st.update(subs=[], url=p["url"], title=p["title"], qualities=p.get("q", []), qh=p.get("qh"), playing=True, time=0.0, updated_at=time.time())
                        await broadcast(room, {"type": "state", **current_state(room)})
                continue

            if kind == "react":
                emoji = str(msg.get("emoji", "🔥"))[:4]
                await broadcast(room, {"type": "react", "emoji": emoji})
                continue

            if kind == "shock":
                now = time.time()
                if now - room["last_shock"] > 5:  # حماية من الإزعاج
                    room["last_shock"] = now
                    await broadcast(room, {"type": "shock"})
                continue

            # ---- إعدادات المضيف ----
            if kind == "perm":
                if ws is room["host"]:
                    room["free"] = bool(msg.get("free"))
                    await send_roles(room)
                continue

            # ---- أوامر التحكم بالفيديو ----
            if kind not in ("load", "play", "pause", "seek"):
                continue
            if ws is not room["host"] and not room["free"]:
                # ما عنده صلاحية: رجّعه للحالة الحالية
                await safe_send(room, ws, {"type": "state", **current_state(room)})
                continue

            echo = False
            if kind == "load":
                try:
                    lurl, ltitle, lq, lqh = await resolve(str(msg.get("url", "")).strip(), "")
                except Exception as e:
                    print("resolve failed:", repr(e))
                    msg_txt = "يوتيوب حاظر السيرفر، جرّب رابط ثاني" if "YT_BLOCKED" in str(e) else "ما قدرت أستخرج الفيديو من هذا الرابط"
                    await safe_send(room, ws, {"type": "error", "text": msg_txt})
                    continue
                st.update(subs=[], url=lurl, title=ltitle, qualities=lq, qh=lqh, playing=True, time=0.0)
                echo = True
            elif kind == "play":
                st.update(playing=True, time=float(msg.get("time", 0)))
            elif kind == "pause":
                st.update(playing=False, time=float(msg.get("time", 0)))
            elif kind == "seek":
                st.update(time=float(msg.get("time", 0)))
            st["updated_at"] = time.time()

            await broadcast(room, {"type": "state", **current_state(room)}, exclude=None if echo else ws)
    except WebSocketDisconnect:
        pass
    finally:
        room["clients"].discard(ws)
        if not room["clients"]:
            rooms.pop(room_id, None)
            for k in [k for k, v in channel_rooms.items() if v == room_id]:
                channel_rooms.pop(k, None)
        else:
            if room["host"] is ws:
                room["host"] = next(iter(room["clients"]))
            await send_roles(room)


dist = Path(__file__).resolve().parent.parent / "client" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="client")
