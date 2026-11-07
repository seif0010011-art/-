import os

import discord
from discord import app_commands

TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")
FIRE = 0xFF4500
CREDIT = "Developed by Hosam"
BANNER = os.getenv("BANNER_URL", "")  # اختياري: رابط صورة تظهر في الرسائل


class HosamBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
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

    async def on_ready(self):
        await self.change_presence(
            activity=discord.Activity(type=discord.ActivityType.watching, name="🔥 HOSAM | أفلام وأنمي")
        )
        print(f"Logged in as {self.user}")


bot = HosamBot()


def fire_embed(title: str, desc: str) -> discord.Embed:
    e = discord.Embed(title=f"🔥 {title}", description=desc, color=FIRE)
    e.set_footer(text=CREDIT)
    if BANNER:
        e.set_image(url=BANNER)
    return e


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


@bot.tree.command(name="بنج", description="سرعة استجابة البوت")
async def ping(inter: discord.Interaction):
    ms = round(bot.latency * 1000)
    state = "🟢 ممتاز" if ms < 150 else "🟡 مقبول" if ms < 300 else "🔴 بطيء"
    await inter.response.send_message(embed=fire_embed("البنج", f"**{ms}ms**  {state}"))


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("DISCORD_BOT_TOKEN غير موجود في Secrets")
    bot.run(TOKEN)
