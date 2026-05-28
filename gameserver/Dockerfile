FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
COPY --from=shared . /shared
RUN npm run build
CMD ["node", "dist/index.js"]
