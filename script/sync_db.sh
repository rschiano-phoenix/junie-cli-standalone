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
  local containers
  containers=$(run_cmd "$ssh_user" "$host" "docker ps --format '{{.Names}}'")
  
  # On cherche d'abord un match exact avec le préfixe du JSON
  local exact_match
  exact_match=$(echo "$containers" | grep -x "$prefix" | head -n 1)
  if [[ -n "$exact_match" ]]; then
    echo "$exact_match"
  else
    # Sinon on cherche un container qui commence par ce préfixe
    echo "$containers" | grep "^$prefix" | head -n 1
  fi
}

# Récupère les infos de DB depuis le .env du container
get_db_from_env() {
  local ssh_user="$1"
  local host="$2"
  local container="$3"

  # On récupère le contenu du .env ou les variables d'environnement
  local env_content
  # Tentative 1 : fichier .env
  env_content=$(run_cmd "$ssh_user" "$host" "docker exec $container cat .env" 2>/dev/null || echo "")

  # Tentative 2 : commande env si .env vide ou ne contient pas DB_
  if [[ -z "$env_content" || ! "$env_content" =~ "DB_" ]]; then
    env_content=$(run_cmd "$ssh_user" "$host" "docker exec $container env" 2>/dev/null || echo "")
  fi

  if [[ -z "$env_content" ]]; then
    return
  fi

  # Extraction des variables
  extract_var() {
    local content="$1"
    local pattern="$2"
    echo "$content" | grep -E "^\s*($pattern)\s*=" | head -n 1 | cut -d'=' -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" | tr -d '\r'
  }

  local db_host=$(extract_var "$env_content" "DB_HOST")
  local db_name=$(extract_var "$env_content" "DB_DATABASE|DB_NAME")
  local db_user=$(extract_var "$env_content" "DB_USERNAME|DB_USER")
  local db_pass=$(extract_var "$env_content" "DB_PASSWORD|DB_PASS")

  # Valeurs par défaut
  [[ -z "$db_host" ]] && db_host="localhost"

  # Si on n'a pas au moins le nom de la base et l'utilisateur, on considère que l'auto-détection a échoué
  if [[ -z "$db_name" || -z "$db_user" ]]; then
    return
  fi

  echo "$db_host|$db_name|$db_user|$db_pass"
}

echo "🔁 Copie de '$SOURCE_ENV' vers '$TARGET_ENV' pour le projet '$PROJECT_NAME'..."

# Récupération des informations (avec retry si le container n'est pas encore prêt)
MAX_TRIES=5
SLEEP_TIME=60

for ((i=1; i<=MAX_TRIES; i++)); do
  echo "🔍 [Tentative $i/$MAX_TRIES] Récupération des containers et de la configuration DB..."

  FROM_CONTAINER=$(get_container_name "$FROM_SSH_USER" "$FROM_HOST" "$FROM_PREFIX")
  TO_CONTAINER=$(get_container_name "$TO_SSH_USER" "$TO_HOST" "$TO_PREFIX")

  if [[ -n "$FROM_CONTAINER" && -n "$TO_CONTAINER" ]]; then
    # Récupération des infos de DB depuis les containers (.env)
    FROM_DB_INFO=$(get_db_from_env "$FROM_SSH_USER" "$FROM_HOST" "$FROM_CONTAINER")
    if [[ -n "$FROM_DB_INFO" ]]; then
      IFS='|' read -r FROM_DB_HOST FROM_DB_NAME FROM_DB_USER FROM_DB_PASSWORD <<< "$FROM_DB_INFO"
      echo "✅ Configuration DB source récupérée depuis le container"
    else
      FROM_DB_HOST="${FROM_DB_HOST_FALLBACK:-localhost}"
      FROM_DB_NAME="$FROM_DB_NAME_FALLBACK"
      FROM_DB_USER="$FROM_DB_USER_FALLBACK"
      FROM_DB_PASSWORD="$FROM_DB_PASSWORD_FALLBACK"
      echo "ℹ️ Auto-détection incomplète ou échouée, utilisation du fallback pour la DB source"
    fi

    TO_DB_INFO=$(get_db_from_env "$TO_SSH_USER" "$TO_HOST" "$TO_CONTAINER")
    if [[ -n "$TO_DB_INFO" ]]; then
      IFS='|' read -r TO_DB_HOST TO_DB_NAME TO_DB_USER TO_DB_PASSWORD <<< "$TO_DB_INFO"
      echo "✅ Configuration DB cible récupérée depuis le container"
    else
      TO_DB_HOST="${TO_DB_HOST_FALLBACK:-localhost}"
      TO_DB_NAME="$TO_DB_NAME_FALLBACK"
      TO_DB_USER="$TO_DB_USER_FALLBACK"
      TO_DB_PASSWORD="$TO_DB_PASSWORD_FALLBACK"
      echo "ℹ️ Auto-détection incomplète ou échouée, utilisation du fallback pour la DB cible"
    fi

    # Vérification si on a assez d'infos
    if [[ -n "$FROM_DB_NAME" && -n "$FROM_DB_USER" && -n "$TO_DB_NAME" && -n "$TO_DB_USER" ]]; then
      break
    fi
  fi

  if [[ $i -lt $MAX_TRIES ]]; then
    echo "⏳ Containers ou configuration incomplets. Nouvelle tentative dans ${SLEEP_TIME}s..."
    sleep $SLEEP_TIME
  else
    echo "❌ Échec après $MAX_TRIES tentatives."
    echo "ℹ️ Containers identifiés : Source=${FROM_CONTAINER:-NON TROUVÉ}, Cible=${TO_CONTAINER:-NON TROUVÉ}"
    echo "❌ Paramètres de base de données incomplets :"
    echo "   - Source (DB_Host: $FROM_DB_HOST, DB_Name: $FROM_DB_NAME, DB_User: $FROM_DB_USER)"
    echo "   - Cible  (DB_Host: $TO_DB_HOST, DB_Name: $TO_DB_NAME, DB_User: $TO_DB_USER)"
    exit 1
  fi
done

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
  "docker exec $TO_CONTAINER sh -c 'zcat $GZIP_FILENAME | mysql -h$TO_DB_HOST -u$TO_DB_USER -p$TO_DB_PASSWORD $TO_DB_NAME'"

# Nettoyage
echo "🧹 Nettoyage..."
run_cmd "$TO_SSH_USER" "$TO_HOST" \
  "docker exec -i $TO_CONTAINER rm -f $GZIP_FILENAME"
[[ -z "$TO_HOST" || -z "$TO_SSH_USER" ]] && rm -f "$GZIP_FILENAME"
run_cmd "$FROM_SSH_USER" "$FROM_HOST" \
  "rm -f $GZIP_FILENAME"

echo "✅ Synchronisation terminée."
