FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=3000 DB_PATH=/app/data/timetracker.db
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
