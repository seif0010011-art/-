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


def _resolve_sync(url: str):
    if yt_dlp is None:
        raise RuntimeError("yt-dlp غير مثبت")
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "socket_timeout": 20,
        "format": "best[ext=mp4][protocol^=http]/best[protocol^=http]/best[ext=mp4]/best",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("entries"):
        info = next(iter(info["entries"]))
    direct = info.get("url")
    if not direct:
        raise RuntimeError("ما لقيت رابط فيديو")
    return direct, info.get("title") or "", dict(info.get("http_headers") or {})


async def resolve(url: str, title: str = ""):
    """يرجّع (رابط مباشر, عنوان). الروابط المباشرة تمر كما هي."""
    if is_direct(url):
        return url, title
    if not await asyncio.to_thread(_safe_url, url):
        raise RuntimeError("رابط غير مسموح")
    direct, t, headers = await asyncio.wait_for(asyncio.to_thread(_resolve_sync, url), 60)
    if len(media_headers) > 200:
        media_headers.clear()
    media_headers[direct] = headers
    return direct, (t or title)


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
        play_url, play_title = await resolve(body.url, body.title)
    except Exception as e:
        print("resolve failed:", repr(e))
        return {"status": "unsupported"}
    room_id = channel_rooms.get(body.channel_id)
    room = rooms.get(room_id) if room_id else None
    if room is None:
        pending[body.channel_id] = {"url": play_url, "title": play_title}
        return {"status": "pending"}
    room["state"].update(url=play_url, title=play_title, playing=True, time=0.0, updated_at=time.time())
    await broadcast(room, {"type": "state", **current_state(room)})
    return {"status": "playing"}


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
            "state": {"url": "", "playing": False, "time": 0.0, "updated_at": time.time()},
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
                        st.update(url=p["url"], title=p["title"], playing=True, time=0.0, updated_at=time.time())
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
            if kind not in ("load", "play", "pause", "seek", "sub"):
                continue
            if ws is not room["host"] and not room["free"]:
                # ما عنده صلاحية: رجّعه للحالة الحالية
                await safe_send(room, ws, {"type": "state", **current_state(room)})
                continue

            echo = False
            if kind == "load":
                try:
                    lurl, ltitle = await resolve(str(msg.get("url", "")).strip(), "")
                except Exception as e:
                    print("resolve failed:", repr(e))
                    await safe_send(room, ws, {"type": "error", "text": "ما قدرت أستخرج الفيديو من هذا الرابط"})
                    continue
                st.update(url=lurl, title=ltitle, playing=True, time=0.0)
                echo = True
            elif kind == "play":
                st.update(playing=True, time=float(msg.get("time", 0)))
            elif kind == "pause":
                st.update(playing=False, time=float(msg.get("time", 0)))
            elif kind == "seek":
                st.update(time=float(msg.get("time", 0)))
            elif kind == "sub":
                st["sub"] = str(msg.get("url", ""))
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
