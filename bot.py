import asyncio
import json
import os
import time
from pathlib import Path
from typing import Optional

import discord
import httpx
from discord.http import Route
from discord import app_commands

TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")
FIRE = 0xFF4500
CREDIT = "Developed by Hosam"
BANNER = os.getenv("BANNER_URL", "")  # اختياري: رابط صورة تظهر في الرسائل
SERVER = f"http://127.0.0.1:{os.getenv('PORT', '8000')}"
LIB_PATH = Path(__file__).with_name("library.json")


def load_library() -> list:
    try:
        return json.loads(LIB_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


async def push(channel_id: int, url: str, title: str) -> str:
    """يرسل أمر التشغيل للسيرفر. يرجّع playing أو pending أو error."""
    try:
        async with httpx.AsyncClient(timeout=70) as c:
            r = await c.post(
                f"{SERVER}/api/play",
                headers={"X-Key": TOKEN},
                json={"channel_id": str(channel_id), "url": url, "title": title},
            )
        return r.json().get("status", "error") if r.status_code == 200 else "error"
    except Exception:
        return "error"


class HosamBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True  # لازم لأوامر النقطة مثل .شغل
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        from discord.http import Route

        app_id = self.application_id
        list_route = Route("GET", "/applications/{application_id}/commands", application_id=app_id)

        # 1) نحذف أمر التشغيل (Entry Point) لأن ديسكورد يمنع مسحه أثناء المزامنة
        try:
            for c in await self.http.request(list_route):
                if c.get("type") == 4:
                    await self.http.request(
                        Route(
                            "DELETE",
                            "/applications/{application_id}/commands/{command_id}",
                            application_id=app_id,
                            command_id=c["id"],
                        )
                    )
        except Exception as e:
            print("Entry point delete error:", e)

        # 2) نسجّل أوامر البوت
        try:
            await self.tree.sync()
        except Exception as e:
            print("Sync error:", e)

        # 3) نرجّع أمر التشغيل
        try:
            await self.http.request(
                Route("POST", "/applications/{application_id}/commands", application_id=app_id),
                json={
                    "name": "launch",
                    "description": "🔥 شغّل النشاط",
                    "type": 4,      # PRIMARY_ENTRY_POINT
                    "handler": 2,   # DISCORD_LAUNCH_ACTIVITY
                    "integration_types": [0, 1],
                    "contexts": [0, 1, 2],
                },
            )
            print("Entry point command ready")
        except Exception as e:
            print("Entry point error:", e)

    async def on_message(self, msg: discord.Message):
        """أوامر بالنقطة: .اصعد  .انزل  .بنج  .شغل <رابط أو عنوان>"""
        if msg.author.bot or not msg.guild or not msg.content.startswith("."):
            return
        cmd, _, arg = msg.content[1:].strip().partition(" ")
        arg = arg.strip()
        voice = msg.author.voice
        ch = voice.channel if voice else None

        if cmd == "بنج":
            m = await msg.reply(embed=ping_embed(await measure()))
            for _ in range(20):
                await asyncio.sleep(2)
                try:
                    await m.edit(embed=ping_embed(await measure()))
                except Exception:
                    break
            return

        if cmd == "انزل":
            vc = msg.guild.voice_client
            if not vc:
                return await msg.reply(embed=fire_embed("ما أنا في روم", "البوت مو داخل أي روم صوتي."))
            await vc.disconnect()
            return await msg.reply(embed=fire_embed("انطفت النار", "طلعت من الروم 👋"))

        if cmd in ("اصعد", "شغل") and not ch:
            return await msg.reply(embed=fire_embed("ادخل روم صوتي أول", "لازم تكون داخل روم صوتي."))

        if cmd == "اصعد":
            if msg.guild.voice_client:
                await msg.guild.voice_client.move_to(ch)
            else:
                await ch.connect()
            return await msg.reply(embed=fire_embed("دخلت النار!", f"أنا الحين في **{ch.name}** 🎧"))

        if cmd == "شغل":
            if arg.startswith(("http://", "https://")):
                status = await push(ch.id, arg, "رابط مباشر")
                return await msg.reply(embed=played_embed(status, "رابط مباشر"))
            if arg:
                q = arg.lower()
                item = next((i for i in load_library() if q in i["title"].lower()), None)
                if not item:
                    return await msg.reply(embed=fire_embed("ما لقيته", "جرّب اسم ثاني أو حط رابط."))
                if item.get("episodes"):
                    return await msg.reply(
                        embed=fire_embed(item["title"], "اختر الحلقة من القائمة 👇"),
                        view=EpisodeView(item, ch.id),
                    )
                status = await push(ch.id, item["url"], item["title"])
                return await msg.reply(embed=played_embed(status, item["title"]))
            return await msg.reply(embed=fire_embed("شنو أشغل؟", "اكتب: `.شغل رابط` أو `.شغل اسم الفيلم`"))

    async def on_ready(self):
        if not getattr(self, "_presence_started", False):
            self._presence_started = True
            asyncio.create_task(self.presence_loop())
        print(f"Logged in as {self.user}")

    async def presence_loop(self):
        """حالة البوت تعرض البنج الحي وتتحدث كل 30 ثانية."""
        while not self.is_closed():
            try:
                ms = await measure()
                await self.change_presence(
                    activity=discord.Activity(type=discord.ActivityType.watching, name=f"🔥 HOSAM | {ms}ms")
                )
            except Exception as e:
                print("presence error:", e)
            await asyncio.sleep(30)


bot = HosamBot()


def fire_embed(title: str, desc: str) -> discord.Embed:
    e = discord.Embed(title=f"🔥 {title}", description=desc, color=FIRE)
    e.set_footer(text=CREDIT)
    if BANNER:
        e.set_image(url=BANNER)
    return e


async def measure() -> int:
    """يقيس زمن الاستجابة الحقيقي لـ Discord API بالملي ثانية."""
    t = time.perf_counter()
    await bot.http.request(Route("GET", "/gateway"))
    return round((time.perf_counter() - t) * 1000)


def ping_embed(ms: int) -> discord.Embed:
    pct = max(1, min(100, round(100 - ms / 4)))          # كل ما قلّ الرقم زادت النسبة
    filled = round(pct / 10)
    bar = "█" * filled + "░" * (10 - filled)
    dot = "🟢" if ms < 150 else "🟡" if ms < 300 else "🔴"
    return fire_embed("البنج المباشر", f"{dot} **{ms}ms**\n`{bar}` **{pct}%**\nيتحدث تلقائي ⚡")


@bot.tree.command(name="اصعد", description="يدخل البوت الروم الصوتي اللي أنت فيه")
async def join(inter: discord.Interaction):
    if not inter.user.voice or not inter.user.voice.channel:
        return await inter.response.send_message(
            embed=fire_embed("ادخل روم صوتي أول", "لازم تكون داخل روم صوتي عشان أنضم لك."), ephemeral=True
        )
    ch = inter.user.voice.channel
    if inter.guild.voice_client:
        await inter.guild.voice_client.move_to(ch)
    else:
        await ch.connect()
    await inter.response.send_message(embed=fire_embed("دخلت النار!", f"أنا الحين في **{ch.name}** 🎧"))


@bot.tree.command(name="انزل", description="يطلع البوت من الروم الصوتي")
async def leave(inter: discord.Interaction):
    vc = inter.guild.voice_client
    if not vc:
        return await inter.response.send_message(embed=fire_embed("ما أنا في روم", "البوت مو داخل أي روم صوتي."), ephemeral=True)
    await vc.disconnect()
    await inter.response.send_message(embed=fire_embed("انطفت النار", "طلعت من الروم 👋"))


@bot.tree.command(name="طريقة", description="طريقة فتح المشاهدة الجماعية")
async def watch(inter: discord.Interaction):
    await inter.response.send_message(
        embed=fire_embed(
            "المشاهدة الجماعية جاهزة",
            "1️⃣ ادخل روم صوتي\n2️⃣ اضغط أيقونة **الأنشطة** 🚀\n3️⃣ اختر نشاط **HOSAM**\n4️⃣ الصق رابط الفيديو والكل يشاهد معك بنفس اللحظة 🎬",
        )
    )


@bot.tree.command(name="معلومات", description="عن البوت")
async def about(inter: discord.Interaction):
    await inter.response.send_message(
        embed=fire_embed("HOSAM","بوت ونشاط مشاهدة أفلام وأنمي مع الأصدقاء، مزامنة فورية وجودة عالية.\n\n**Developed by Hosam**")
    )


@bot.tree.command(name="بنج", description="سرعة البوت (مباشر ويتحرك)")
async def ping(inter: discord.Interaction):
    await inter.response.send_message(embed=ping_embed(await measure()))
    for _ in range(20):          # يتحدث كل ثانيتين لمدة 40 ثانية تقريباً
        await asyncio.sleep(2)
        try:
            await inter.edit_original_response(embed=ping_embed(await measure()))
        except Exception:
            break


def played_embed(status: str, title: str) -> discord.Embed:
    if status == "playing":
        return fire_embed("تم التشغيل", f"**{title}**\nيشتغل الحين عند كل من في النشاط 🎬")
    if status == "pending":
        return fire_embed("جاهز", f"**{title}**\nافتح النشاط (الأنشطة 🚀) وبيشتغل تلقائي.")
    if status == "unsupported":
        return fire_embed("ما قدرت أجيب الفيديو", "هذا الموقع/الرابط ما انفتح معي. جرّب رابط ثاني أو رابط مباشر mp4.")
    return fire_embed("صار خطأ", "ما قدرت أرسل أمر التشغيل، جرّب مرة ثانية.")


class EpisodeSelect(discord.ui.Select):
    def __init__(self, item: dict, channel_id: int):
        self.item = item
        self.channel_id = channel_id
        opts = [discord.SelectOption(label=e["name"][:100], value=str(i)) for i, e in enumerate(item["episodes"][:25])]
        super().__init__(placeholder="اختر الحلقة", options=opts)

    async def callback(self, inter: discord.Interaction):
        ep = self.item["episodes"][int(self.values[0])]
        title = f'{self.item["title"]} - {ep["name"]}'
        status = await push(self.channel_id, ep["url"], title)
        await inter.response.send_message(embed=played_embed(status, title))


class EpisodeView(discord.ui.View):
    def __init__(self, item: dict, channel_id: int):
        super().__init__(timeout=300)
        self.add_item(EpisodeSelect(item, channel_id))


async def title_autocomplete(inter: discord.Interaction, current: str):
    q = current.lower()
    return [
        app_commands.Choice(name=i["title"][:100], value=i["title"][:100])
        for i in load_library()
        if q in i["title"].lower()
    ][:25]


@bot.tree.command(name="شغل", description="شغّل فيلم أو حلقة أو رابط مباشر للكل في الروم")
@app_commands.describe(الرابط="(اختياري) رابط مباشر mp4 أو m3u8", العنوان="(اختياري) اختر من المكتبة")
@app_commands.autocomplete(العنوان=title_autocomplete)
async def play(inter: discord.Interaction, الرابط: Optional[str] = None, العنوان: Optional[str] = None):
    voice = inter.user.voice
    if not voice or not voice.channel:
        return await inter.response.send_message(
            embed=fire_embed("ادخل روم صوتي أول", "لازم تكون داخل روم صوتي."), ephemeral=True
        )
    ch = voice.channel

    if الرابط:
        if not الرابط.startswith(("http://", "https://")):
            return await inter.response.send_message(
                embed=fire_embed("رابط غلط", "لازم يبدأ بـ https://"), ephemeral=True
            )
        await inter.response.defer()  # الاستخراج ياخذ وقت أكثر من 3 ثواني
        status = await push(ch.id, الرابط, "رابط مباشر")
        return await inter.followup.send(embed=played_embed(status, "رابط مباشر"))

    if العنوان:
        item = next((i for i in load_library() if i["title"] == العنوان), None)
        if not item:
            return await inter.response.send_message(embed=fire_embed("ما لقيته", "اختر من القائمة."), ephemeral=True)
        if item.get("episodes"):
            return await inter.response.send_message(
                embed=fire_embed(item["title"], "اختر الحلقة من القائمة 👇"),
                view=EpisodeView(item, ch.id),
            )
        status = await push(ch.id, item["url"], item["title"])
        return await inter.response.send_message(embed=played_embed(status, item["title"]))

    await inter.response.send_message(
        embed=fire_embed("شنو أشغل؟", "حط رابط، أو اختر عنوان من المكتبة."), ephemeral=True
    )


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("DISCORD_BOT_TOKEN غير موجود في Secrets")
    bot.run(TOKEN)
