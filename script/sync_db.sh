#!/bin/bash
set -e

# Chargement des paramètres
PROJECT_NAME=$1
FROM_HOST=$2
FROM_SSH_USER=$3
FROM_PREFIX=$4
FROM_DB_HOST_FALLBACK=$5
FROM_DB_NAME_FALLBACK=$6
FROM_DB_USER_FALLBACK=$7
FROM_DB_PASSWORD_FALLBACK=$8
TO_HOST=$9
TO_SSH_USER=${10}
TO_PREFIX=${11}
TO_DB_HOST_FALLBACK=${12}
TO_DB_NAME_FALLBACK=${13}
TO_DB_USER_FALLBACK=${14}
TO_DB_PASSWORD_FALLBACK=${15}
BRANCH_NAME=${16}

# Configuration SSH pour éviter les demandes de mot de passe (comme pour Git)
SSH_COMMAND_VAL=${GIT_SSH_COMMAND:-$SSH_COMMAND}
SSH_CMD="ssh"
SCP_CMD="scp"

if [[ -n "$SSH_COMMAND_VAL" ]]; then
  SSH_CMD="$SSH_COMMAND_VAL"
  # Pour SCP, on essaie de remplacer 'ssh' par 'scp' dans la commande pour garder les options (-i, etc.)
  if [[ "$SSH_COMMAND_VAL" =~ ^(.*)ssh([[:space:]]+.*)$ ]]; then
    SCP_CMD="${BASH_REMATCH[1]}scp${BASH_REMATCH[2]}"
  fi
fi

if [[ -z "$PROJECT_NAME" ]]; then
  echo "❌ Paramètres manquants. Usage: $0 <project_name> <from_host> <from_user> <from_prefix> <from_db_host> <from_db_name> <from_db_user> <from_db_pass> <to_host> <to_user> <to_prefix> <to_db_host> <to_db_name> <to_db_user> <to_db_pass> [branch_name]"
  exit 1
fi

SOURCE_ENV="source"
TARGET_ENV="target"

# Exécute une commande localement ou à distance
run_cmd() {
  local ssh_user="$1"
  local host="$2"
  local cmd="$3"

  if [[ -z "$host" || -z "$ssh_user" ]]; then
    bash -c "$cmd"
  else
    $SSH_CMD "$ssh_user@$host" "$cmd"
  fi
}

# Récupère le nom du container Docker à partir d’un préfixe
get_container_name() {
  local ssh_user="$1"
  local host="$2"
  local prefix="$3"
  run_cmd "$ssh_user" "$host" "docker ps --format '{{.Names}}'" | grep "^$prefix" | head -n 1
}

# Récupère les infos de DB depuis le .env du container
get_db_from_env() {
  local ssh_user="$1"
  local host="$2"
  local container="$3"

  # On récupère le contenu du .env (on suppose qu'il est à la racine de l'app dans le container)
  local env_content
  env_content=$(run_cmd "$ssh_user" "$host" "docker exec $container cat .env" 2>/dev/null || echo "")

  if [[ -z "$env_content" ]]; then
    return
  fi

  # Extraction des variables (supporte plusieurs formats courants)
  local db_host=$(echo "$env_content" | grep -E "^DB_HOST=" | head -n 1 | cut -d'=' -f2- | tr -d '\r' | xargs echo)
  local db_name=$(echo "$env_content" | grep -E "^(DB_DATABASE|DB_NAME)=" | head -n 1 | cut -d'=' -f2- | tr -d '\r' | xargs echo)
  local db_user=$(echo "$env_content" | grep -E "^(DB_USERNAME|DB_USER)=" | head -n 1 | cut -d'=' -f2- | tr -d '\r' | xargs echo)
  local db_pass=$(echo "$env_content" | grep -E "^(DB_PASSWORD|DB_PASS)=" | head -n 1 | cut -d'=' -f2- | tr -d '\r' | xargs echo)

  # Valeurs par défaut
  [[ -z "$db_host" ]] && db_host="localhost"

  echo "$db_host|$db_name|$db_user|$db_pass"
}

echo "🔁 Copie de '$SOURCE_ENV' vers '$TARGET_ENV' pour le projet '$PROJECT_NAME'..."

# Si une branche est spécifiée, on l'ajoute au préfixe (utile pour les environnements de review)
if [[ -n "$BRANCH_NAME" ]]; then
  TO_PREFIX="${TO_PREFIX}-${BRANCH_NAME}"
fi

# Récupération des noms de containers
FROM_CONTAINER=$(get_container_name "$FROM_SSH_USER" "$FROM_HOST" "$FROM_PREFIX")
TO_CONTAINER=$(get_container_name "$TO_SSH_USER" "$TO_HOST" "$TO_PREFIX")

if [[ -z "$FROM_CONTAINER" ]]; then
  echo "❌ Container source non trouvé pour le préfixe '$FROM_PREFIX' sur ${FROM_HOST:-localhost}"
  exit 1
fi

if [[ -z "$TO_CONTAINER" ]]; then
  echo "❌ Container cible non trouvé pour le préfixe '$TO_PREFIX' sur ${TO_HOST:-localhost}"
  exit 1
fi

# Récupération des infos de DB depuis les containers (.env)
echo "🔍 Récupération de la configuration DB depuis les containers..."

FROM_DB_INFO=$(get_db_from_env "$FROM_SSH_USER" "$FROM_HOST" "$FROM_CONTAINER")
if [[ -n "$FROM_DB_INFO" ]]; then
  IFS='|' read -r FROM_DB_HOST FROM_DB_NAME FROM_DB_USER FROM_DB_PASSWORD <<< "$FROM_DB_INFO"
  echo "✅ Configuration DB source récupérée depuis le .env du container"
else
  # Fallback sur les paramètres fournis si pas de .env
  FROM_DB_HOST="$FROM_DB_HOST_FALLBACK"
  FROM_DB_NAME="$FROM_DB_NAME_FALLBACK"
  FROM_DB_USER="$FROM_DB_USER_FALLBACK"
  FROM_DB_PASSWORD="$FROM_DB_PASSWORD_FALLBACK"
  echo "ℹ️ Utilisation de la configuration DB source fournie en paramètre (fallback)"
fi

TO_DB_INFO=$(get_db_from_env "$TO_SSH_USER" "$TO_HOST" "$TO_CONTAINER")
if [[ -n "$TO_DB_INFO" ]]; then
  IFS='|' read -r TO_DB_HOST TO_DB_NAME TO_DB_USER TO_DB_PASSWORD <<< "$TO_DB_INFO"
  echo "✅ Configuration DB cible récupérée depuis le .env du container"
else
  # Fallback sur les paramètres fournis si pas de .env
  TO_DB_HOST="$TO_DB_HOST_FALLBACK"
  TO_DB_NAME="$TO_DB_NAME_FALLBACK"
  TO_DB_USER="$TO_DB_USER_FALLBACK"
  TO_DB_PASSWORD="$TO_DB_PASSWORD_FALLBACK"
  echo "ℹ️ Utilisation de la configuration DB cible fournie en paramètre (fallback)"
fi

# Validation des paramètres de connexion
if [[ -z "$FROM_DB_NAME" || -z "$FROM_DB_USER" ]]; then
  echo "❌ Paramètres de base de données SOURCE incomplets (Host: $FROM_DB_HOST, DB: $FROM_DB_NAME, User: $FROM_DB_USER)"
  exit 1
fi

if [[ -z "$TO_DB_NAME" || -z "$TO_DB_USER" ]]; then
  echo "❌ Paramètres de base de données CIBLE incomplets (Host: $TO_DB_HOST, DB: $TO_DB_NAME, User: $TO_DB_USER)"
  exit 1
fi

FILENAME="/tmp/dump_$FROM_PREFIX.sql"
GZIP_FILENAME="$FILENAME.gz"

echo "📦 Dump depuis ${FROM_HOST:-localhost} (container: $FROM_CONTAINER)..."

run_cmd "$FROM_SSH_USER" "$FROM_HOST" \
  "docker exec $FROM_CONTAINER mysqldump -h$FROM_DB_HOST -u$FROM_DB_USER -p$FROM_DB_PASSWORD $FROM_DB_NAME > $FILENAME"
run_cmd "$FROM_SSH_USER" "$FROM_HOST" \
  "rm -f $GZIP_FILENAME"
run_cmd "$FROM_SSH_USER" "$FROM_HOST" \
  "gzip $FILENAME"

if [[ "$FROM_HOST" != "$TO_HOST" ]]; then
  rm -f "$GZIP_FILENAME"
  $SCP_CMD "$FROM_SSH_USER@$FROM_HOST:$GZIP_FILENAME" "$GZIP_FILENAME"
  run_cmd "$FROM_SSH_USER" "$FROM_HOST" \
    "rm -f $GZIP_FILENAME"
fi

# Envoi du dump
if [[ "$FROM_HOST" != "$TO_HOST" ]]; then
  if [[ -n "$TO_HOST" && -n "$TO_SSH_USER" ]]; then
    echo "📤 Transfert du dump vers $TO_HOST..."
    $SCP_CMD "$GZIP_FILENAME" "$TO_SSH_USER@$TO_HOST:$GZIP_FILENAME"
    rm -f "$GZIP_FILENAME"
  fi
fi

# Recréation base de données
echo "🗑️ DROP + CREATE base '$TO_DB_NAME' sur ${TO_HOST:-localhost}..."
run_cmd "$TO_SSH_USER" "$TO_HOST" \
  "docker exec $TO_CONTAINER mysql -h$TO_DB_HOST -u$TO_DB_USER -p$TO_DB_PASSWORD -e 'DROP DATABASE IF EXISTS \`$TO_DB_NAME\`; CREATE DATABASE \`$TO_DB_NAME\`;'"

# Import du dump
echo "📥 Import dans la base '$TO_DB_NAME'..."
run_cmd "$TO_SSH_USER" "$TO_HOST" \
  "docker cp $GZIP_FILENAME $TO_CONTAINER:$GZIP_FILENAME"
run_cmd "$TO_SSH_USER" "$TO_HOST" \
  "docker exec $TO_CONTAINER bash -c 'zcat $GZIP_FILENAME | mysql -h$TO_DB_HOST -u$TO_DB_USER -p$TO_DB_PASSWORD $TO_DB_NAME'"

# Nettoyage
echo "🧹 Nettoyage..."
run_cmd "$TO_SSH_USER" "$TO_HOST" \
  "docker exec -i $TO_CONTAINER rm -f $GZIP_FILENAME"
[[ -z "$TO_HOST" || -z "$TO_SSH_USER" ]] && rm -f "$GZIP_FILENAME"
run_cmd "$FROM_SSH_USER" "$FROM_HOST" \
  "rm -f $GZIP_FILENAME"

echo "✅ Synchronisation terminée."
