FROM node:20

WORKDIR /app

# copy dependencies first (better caching)
COPY package*.json ./

RUN npm install

# copy all source code
COPY . .

# build frontend (Vite)
RUN npm run build

# expose backend port
EXPOSE 4000

# start express server
CMD ["npm", "start"]