FROM node:22-alpine AS build
WORKDIR /repo
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json .npmrc ./
COPY packages/web/package.json packages/web/package.json
RUN npm install --legacy-peer-deps
COPY . .
RUN npx nx build @org/web

FROM nginx:alpine
COPY --from=build /repo/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
