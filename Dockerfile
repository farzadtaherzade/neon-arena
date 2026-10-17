# Static browser game: build the Vite bundle, then serve it with nginx.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# EXPOSE is metadata only; publish the host port at run time:
#   docker run --rm -d -p 8080:80 neon-arena   (hosts get it at http://localhost:8080)
EXPOSE 80
