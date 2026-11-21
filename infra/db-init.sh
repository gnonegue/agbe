#!/bin/sh
# Exécuté UNE fois à la création de la base (docker-entrypoint-initdb.d).
# Crée le rôle applicatif sans privilèges : l'API ne peut ni modifier le schéma, ni désactiver les triggers,
# ni réécrire le grand livre (droits retirés par la migration audit_fixes).
set -eu
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD manquant}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_pw="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE agbe_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD :'app_pw';
GRANT CONNECT ON DATABASE agbe TO agbe_app;
GRANT USAGE ON SCHEMA public TO agbe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agbe_app;
SQL
