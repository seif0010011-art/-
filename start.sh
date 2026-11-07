#!/usr/bin/env bash
set -e

# يبني الواجهة
cd client
npm install
npm run build
cd ..

pip install -r server/requirements.txt

# يشغّل البوت بالخلفية (لو الـ Token موجود) ثم السيرفر
if [ -n "$DISCORD_BOT_TOKEN" ]; then
  python bot.py &
fi

exec uvicorn server.main:app --host 0.0.0.0 --port 8000
