FROM node:18-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY .env* ./
RUN mkdir -p ./data

CMD ["node", "dist/index.js"]
