FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

FROM base AS dev
RUN npm install
COPY . .
CMD ["npm", "run", "dev", "--", "--host"]

FROM base AS build
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
# Passed in from the server's own git checkout at deploy time (see deploy.yml) — this build
# context is scoped to ./guest-web, so .git isn't available here to compute it directly.
ARG VITE_COMMIT_HASH
ENV VITE_COMMIT_HASH=$VITE_COMMIT_HASH
RUN npm run build

FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# The CSP's connect-src must name the API origin this bundle was built to call.
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" && sed -i "s#__API_URL__#${VITE_API_URL}#g" /etc/nginx/conf.d/default.conf
