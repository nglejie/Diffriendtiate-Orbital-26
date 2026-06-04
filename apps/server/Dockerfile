FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY package*.json ./
COPY apps/client/package.json ./apps/client/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN npm ci --omit=dev --workspace @diffriendtiate/server && npm cache clean --force

COPY apps/server ./apps/server
RUN mkdir -p /app/apps/server/uploads

WORKDIR /app/apps/server
EXPOSE 4000

CMD ["npm", "start"]
