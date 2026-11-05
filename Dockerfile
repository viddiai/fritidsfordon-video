# En container: granskningsvy + renderingskö + schemalagd synk (npm start).
FROM node:22-bookworm-slim

# Systembibliotek som Chrome Headless Shell (Remotion) behöver
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-noto-core fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
      libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# Laddar ner Remotions egen Chrome Headless Shell i förväg
RUN npx remotion browser ensure
COPY . .

ENV NODE_ENV=production PORT=3000 STORAGE_DIR=/data/storage PGLITE_DIR=/data/pglite
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
