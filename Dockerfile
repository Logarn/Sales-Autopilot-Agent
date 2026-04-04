FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN mkdir -p ./data
CMD ["node", "dist/index.js"]
