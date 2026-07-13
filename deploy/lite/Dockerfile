FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package*.json ./
COPY apps/client/package.json ./apps/client/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN npm ci --include=dev

COPY apps/client ./apps/client
COPY apps/server ./apps/server
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV APP_TIMEZONE=Asia/Singapore
ENV DATABASE_URL=
ENV DIFFRIENDTIATE_DATA_DIR=/app/data
ENV CHATBOT_BASE_URL=
ENV INTELLIGRATE_GPU_ENABLED=false

COPY package*.json ./
COPY apps/client/package.json ./apps/client/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN npm ci \
  --omit=dev \
  --workspace @diffriendtiate/server \
  --include-workspace-root=false \
  --ignore-scripts \
  && npm cache clean --force

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/client/dist ./apps/client/dist
RUN mkdir -p /app/apps/server/uploads /app/data

EXPOSE 4000

CMD ["node", "apps/server/dist/index.js"]
