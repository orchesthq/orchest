FROM node:20-slim AS base
WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the app source and build it.
COPY tsconfig.json ./
COPY src ./src
RUN npm install --include=dev && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]

