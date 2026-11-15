FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY server ./server
COPY shared ./shared
COPY LICENSE ./LICENSE
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production
ENV PORT=4173
EXPOSE 4173
VOLUME /app/data
CMD ["node", "server/index.js"]
