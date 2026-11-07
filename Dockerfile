# ===== 1) بناء الواجهة =====
FROM node:20-slim AS client
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
ARG VITE_DISCORD_CLIENT_ID
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
RUN npm run build

# ===== 2) السيرفر + البوت =====
FROM python:3.11-slim
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY . .
COPY --from=client /app/client/dist client/dist

CMD ["sh", "-c", "if [ -n \"$DISCORD_BOT_TOKEN\" ]; then python bot.py & fi; exec uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
