# syntax=docker/dockerfile:1.7
# ---- build du jeu (PWA statique) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- nginx : sert le front et relaie /api vers le conteneur back ----
FROM nginx:1.28-alpine
RUN rm -f /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/snippets /etc/nginx/templates /var/www/certbot
COPY nginx/snippets/ /etc/nginx/snippets/
# Gabarit : ${AGBE_DOMAIN} et ${AGBE_SECURITY_CONTACT} sont remplacés au démarrage (envsubst de l'image officielle).
COPY nginx/agbe.conf.template /etc/nginx/templates/agbe.conf.template
# Dans docker-compose, l'API est joignable par le nom de service « back ».
RUN sed -i 's#server 127.0.0.1:3000;#server back:3000;#' /etc/nginx/templates/agbe.conf.template
COPY --from=build /app/dist /var/www/agbe
EXPOSE 80 443
