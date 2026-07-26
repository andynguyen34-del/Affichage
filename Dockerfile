FROM node:20-bookworm-slim

# better-sqlite3 est compile a l'installation : on a besoin d'une chaine de build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Le verrou de versions est copie avec le manifeste : deux constructions de
# l'image installent ainsi exactement les memes versions.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Point de montage du partage reseau (voir docker-compose.yml)
RUN mkdir -p /partage /app/data

ENV PORT=8080 \
    DATA_DIR=/app/data \
    SOURCE_ROOT=/partage

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
