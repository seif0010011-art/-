import os
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")

app = FastAPI()

# room_id -> {"state", "clients", "host", "free", "last_shock"}
rooms: dict[str, dict] = {}


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

            if kind == "load":
                st.update(url=str(msg.get("url", "")), playing=False, time=0.0)
            elif kind == "play":
                st.update(playing=True, time=float(msg.get("time", 0)))
            elif kind == "pause":
                st.update(playing=False, time=float(msg.get("time", 0)))
            elif kind == "seek":
                st.update(time=float(msg.get("time", 0)))
            elif kind == "sub":
                st["sub"] = str(msg.get("url", ""))
            st["updated_at"] = time.time()

            await broadcast(room, {"type": "state", **current_state(room)}, exclude=ws)
    except WebSocketDisconnect:
        pass
    finally:
        room["clients"].discard(ws)
        if not room["clients"]:
            rooms.pop(room_id, None)
        else:
            if room["host"] is ws:
                room["host"] = next(iter(room["clients"]))
            await send_roles(room)


dist = Path(__file__).resolve().parent.parent / "client" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="client")
