FROM node:22.22.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM node:22.22.2-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production LEUBAI_HOST=127.0.0.1 LEUBAI_PORT=5200
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY deploy/modelscope-start.mjs deploy/modelscope-nginx.conf ./deploy/
RUN mkdir -p /app/.leubai-local /tmp/leubai-nginx \
    && chown -R node:node /app/.leubai-local /tmp/leubai-nginx
USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:7860/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/modelscope-start.mjs"]
