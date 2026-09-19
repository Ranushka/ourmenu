FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY packages/api/package.json packages/api/package.json
RUN npm install --legacy-peer-deps
COPY . .
RUN npx prisma generate --config packages/api/prisma.config.ts
RUN npx nx build @org/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV UPLOADS_DIR=/app/uploads
COPY --from=build /repo/packages/api/dist ./dist
COPY --from=build /repo/packages/api/prisma ./prisma
COPY --from=build /repo/packages/api/prisma.config.ts ./prisma.config.ts
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 3333
CMD ["sh", "-c", "npx prisma db push --accept-data-loss --config prisma.config.ts && node dist/main.js"]
