FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY apps/client/package.json ./apps/client/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN npm ci --include=dev --workspace @diffriendtiate/server

COPY apps/server ./apps/server
RUN npm run build --workspace @diffriendtiate/server

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

RUN apk add --no-cache \
    font-carlito \
    font-croscore \
    font-dejavu \
    font-liberation \
    font-noto \
    libreoffice \
    && fc-cache -f

COPY package*.json ./
COPY apps/client/package.json ./apps/client/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN npm ci --omit=dev --workspace @diffriendtiate/server && npm cache clean --force

COPY --from=build /app/apps/server/dist ./apps/server/dist
RUN mkdir -p /app/apps/server/uploads

WORKDIR /app/apps/server
EXPOSE 4000

CMD ["npm", "start"]
