# Watch Together — Discord Activity

سيرفر Python (FastAPI) + واجهة JS بسيطة تشغّل فيديو متزامن لكل من في الروم الصوتي.

## الهيكل
```
server/main.py      # OAuth2 token + WebSocket للمزامنة + يخدم الواجهة
client/src/main.js  # Discord SDK + مشغّل الفيديو (mp4 / HLS)
start.sh            # يبني الواجهة ويشغّل السيرفر
.replit             # إعداد Replit
```

## 1) Discord Developer Portal
1. New Application.
2. **OAuth2**: انسخ `Client ID` و `Client Secret`.
3. **Activities → Settings**: فعّل Activities، وفعّل دعم الجوال (Mobile).
4. **Activities → URL Mappings**: خلّ الـ Root Mapping (`/`) يشير لدومين Replit، بدون `https://`
   مثال: `my-app.username.repl.co`
5. أي مصدر فيديو خارجي لازم تضيفه هنا كـ mapping، مثال:
   `/cdn` → `video-host.example.com` ثم تستخدم الرابط `/.proxy/cdn/file.mp4`

## 2) GitHub
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/<you>/discord-watch.git
git push -u origin main
```

## 3) Replit
1. Create Repl → **Import from GitHub**.
2. من **Secrets** أضف:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `VITE_DISCORD_CLIENT_ID`
3. اضغط Run (يشغّل `start.sh`).
4. انسخ رابط الـ Repl وحطه في URL Mappings (الخطوة 1.4).

## 4) التجربة
- ادخل روم صوتي، اضغط 🚀 (Activities) واختر تطبيقك.
- الصق رابط فيديو واضغط تشغيل، الكل في الروم يتزامن معك.

## ملاحظات
- اشتغل بـ HTTPS فقط؛ ديسكورد يحجب أي طلب خارج الـ URL Mappings.
- جودة 4K تعتمد على مصدر الفيديو وسرعة إنترنت كل مشاهد، ومشغّل HLS يقدر يبدّل الجودة تلقائياً.
- استخدم فقط فيديوهات تملك حقوقها أو مصرّح لك بعرضها.
- حالياً أي شخص يتحكم بالتشغيل. لو تبي المضيف فقط، قولي وأعدّلها.

## البوت (bot.py)
- أوامر عربية: `/join` `/leave` `/watch` `/about`
- أضف `DISCORD_BOT_TOKEN` في Secrets (من Developer Portal ← Bot ← Reset Token).
- ادعُ البوت من OAuth2 ← URL Generator: `bot` + `applications.commands`، صلاحيات Connect و Speak.
- `start.sh` يشغّله تلقائياً مع السيرفر.
- اختياري: `BANNER_URL` في Secrets لعرض صورة داخل رسائل البوت.

## الواجهة
- شاشة دخول نارية (جمرات + glitch + اهتزاز + ومضة)، والخلفية `client/public/hero.jpg` (بدّلها بأي صورة).
- الاسم "Developed by Hosam" يظهر بالإنجليزي في شاشة الدخول وأسفل المشغّل وفي رسائل البوت.
