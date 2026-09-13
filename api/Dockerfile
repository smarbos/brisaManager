FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma

FROM base AS dev
RUN npm install
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "start:dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# tsconfig.json is needed by `prisma db seed` (ts-node prisma/seed.ts): without it
# ts-node resolves seed.ts through Node's ESM loader and fails with ERR_UNKNOWN_FILE_EXTENSION.
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate
COPY --from=build /app/dist ./dist
CMD ["node", "dist/main.js"]
