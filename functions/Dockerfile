FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/lib ./lib

USER node
CMD ["node", "lib/jobs/runCloudRunJob.js"]
