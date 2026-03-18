#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ROOT_DIR}/.local/stack"
PID_DIR="${STATE_DIR}/pids"
LOG_DIR="${STATE_DIR}/logs"
LEGACY_LOG_DIR="${LEGACY_LOG_DIR:-/tmp/gateway-logs}"
ENV_FILE="${ROOT_DIR}/.env.local"

REALTIME_PORT="${REALTIME_PORT:-8789}"
API_PORT="${API_PORT:-8790}"
WORKERS_PORT="${WORKERS_PORT:-8791}"
ELECTRIC_PORT="${ELECTRIC_PORT:-3000}"
ELECTRIC_CONTAINER_NAME="${ELECTRIC_CONTAINER_NAME:-gateway-electric}"
ELECTRIC_IMAGE="${ELECTRIC_IMAGE:-electricsql/electric:latest}"
ELECTRIC_INSECURE="${ELECTRIC_INSECURE:-true}"

mkdir -p "${PID_DIR}" "${LOG_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

pid_file() {
  local service="$1"
  echo "${PID_DIR}/${service}.pid"
}

log_file() {
  local service="$1"
  echo "${LOG_DIR}/${service}.log"
}

legacy_log_file() {
  local service="$1"
  echo "${LEGACY_LOG_DIR}/${service}.log"
}

file_mtime() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    echo 0
    return
  fi
  stat -f "%m" "${file}" 2>/dev/null || echo 0
}

resolve_log_file() {
  local service="$1"
  local primary
  primary="$(log_file "${service}")"
  local legacy
  legacy="$(legacy_log_file "${service}")"

  if [[ -f "${primary}" ]]; then
    echo "${primary}"
    return 0
  fi

  if [[ -f "${legacy}" ]]; then
    echo "${legacy}"
    return 0
  fi

  echo "${primary}"
}

is_pid_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

read_pid() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    cat "${file}" 2>/dev/null || true
  fi
}

port_has_listener() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

pid_on_port() {
  local port="$1"
  lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

wait_for_port() {
  local port="$1"
  local retries=40
  local i=0
  until port_has_listener "${port}"; do
    i=$((i + 1))
    if [[ "${i}" -ge "${retries}" ]]; then
      return 1
    fi
    sleep 0.25
  done
}

wait_for_http() {
  local url="$1"
  local retries=40
  local i=0
  until curl -fsS "${url}" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "${i}" -ge "${retries}" ]]; then
      return 1
    fi
    sleep 0.25
  done
}

docker_available() {
  command -v docker >/dev/null 2>&1
}

electric_container_id() {
  if ! docker_available; then
    return 0
  fi
  docker ps -aq -f "name=^/${ELECTRIC_CONTAINER_NAME}$" 2>/dev/null | head -n 1 || true
}

electric_container_running() {
  local container_id
  container_id="$(electric_container_id)"
  if [[ -z "${container_id}" ]]; then
    return 1
  fi
  [[ "$(docker inspect -f '{{.State.Running}}' "${container_id}" 2>/dev/null || true)" == "true" ]]
}

resolve_electric_database_url() {
  local raw_url="${ELECTRIC_DATABASE_URL:-${PG_URL:-}}"
  if [[ -z "${raw_url}" ]]; then
    return 1
  fi

  node -e '
    const raw = process.argv[1];
    const url = new URL(raw);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      url.hostname = "host.docker.internal";
    }
    let auth = "";
    if (url.username) {
      auth = `${url.username}:${url.password || ""}@`;
    } else if (url.password) {
      auth = `:${url.password}@`;
    }
    console.log(`${url.protocol}//${auth}${url.host}${url.pathname}${url.search}${url.hash}`);
  ' "${raw_url}"
}

start_electric() {
  if ! docker_available; then
    echo "[stack] docker is required to run Electric locally"
    return 1
  fi

  if electric_container_running; then
    echo "[stack] electric already running (container ${ELECTRIC_CONTAINER_NAME})"
    return 0
  fi

  local external_pid
  external_pid="$(pid_on_port "${ELECTRIC_PORT}")"
  if [[ -n "${external_pid}" ]]; then
    echo "[stack] electric port ${ELECTRIC_PORT} already in use by pid ${external_pid} (unmanaged)"
    return 1
  fi

  local db_url
  if ! db_url="$(resolve_electric_database_url)"; then
    echo "[stack] unable to resolve DATABASE_URL for Electric (set ELECTRIC_DATABASE_URL or PG_URL)"
    return 1
  fi

  local existing_id
  existing_id="$(electric_container_id)"
  if [[ -n "${existing_id}" ]]; then
    docker rm -f "${ELECTRIC_CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi

  docker run -d \
    --name "${ELECTRIC_CONTAINER_NAME}" \
    -e DATABASE_URL="${db_url}" \
    -e ELECTRIC_INSECURE="${ELECTRIC_INSECURE}" \
    -p "${ELECTRIC_PORT}:3000" \
    "${ELECTRIC_IMAGE}" >/dev/null

  if wait_for_http "http://127.0.0.1:${ELECTRIC_PORT}/v1/health"; then
    echo "[stack] started electric container=${ELECTRIC_CONTAINER_NAME} port=${ELECTRIC_PORT}"
  else
    echo "[stack] failed to start electric; see: docker logs ${ELECTRIC_CONTAINER_NAME}"
    docker logs --tail 80 "${ELECTRIC_CONTAINER_NAME}" 2>&1 || true
    return 1
  fi
}

stop_electric() {
  if ! docker_available; then
    echo "[stack] electric is not running"
    return 0
  fi

  local container_id
  container_id="$(electric_container_id)"
  if [[ -n "${container_id}" ]]; then
    docker rm -f "${ELECTRIC_CONTAINER_NAME}" >/dev/null 2>&1 || true
    echo "[stack] stopped electric"
    return 0
  fi

  echo "[stack] electric is not running"
}

status_electric() {
  if electric_container_running; then
    echo "[stack] electric: running container=${ELECTRIC_CONTAINER_NAME} port=${ELECTRIC_PORT}"
    return 0
  fi

  local container_id
  container_id="$(electric_container_id)"
  if [[ -n "${container_id}" ]]; then
    echo "[stack] electric: stopped container=${ELECTRIC_CONTAINER_NAME} port=${ELECTRIC_PORT}"
    return 0
  fi

  local external_pid
  external_pid="$(pid_on_port "${ELECTRIC_PORT}")"
  if [[ -n "${external_pid}" ]]; then
    echo "[stack] electric: running unmanaged pid=${external_pid} port=${ELECTRIC_PORT}"
    return 0
  fi

  echo "[stack] electric: stopped port=${ELECTRIC_PORT}"
}

start_service() {
  local service="$1"
  local npm_script="$2"
  local port="$3"
  local pid_path
  pid_path="$(pid_file "${service}")"
  local log_path
  log_path="$(log_file "${service}")"
  local existing_pid
  existing_pid="$(read_pid "${pid_path}")"

  if is_pid_running "${existing_pid}"; then
    echo "[stack] ${service} already running (pid ${existing_pid})"
    return 0
  fi

  local external_pid
  external_pid="$(pid_on_port "${port}")"
  if [[ -n "${external_pid}" ]]; then
    echo "[stack] ${service} port ${port} already in use by pid ${external_pid} (unmanaged)"
    return 1
  fi

  rm -f "${pid_path}"
  : > "${log_path}"

  (
    cd "${ROOT_DIR}"
    nohup env PORT="${port}" SERVICE_NAME="${service}" npm run "${npm_script}" >>"${log_path}" 2>&1 < /dev/null &
    echo "$!" > "${pid_path}"
  )

  local pid
  pid="$(read_pid "${pid_path}")"

  if wait_for_port "${port}"; then
    echo "[stack] started ${service} pid=${pid} port=${port}"
  else
    echo "[stack] failed to start ${service}; see $(log_file "${service}")"
    tail -n 80 "${log_path}" || true
    return 1
  fi
}

stop_service() {
  local service="$1"
  local port="$2"
  local pid_path
  pid_path="$(pid_file "${service}")"
  local pid
  pid="$(read_pid "${pid_path}")"

  if is_pid_running "${pid}"; then
    if ! kill "${pid}" 2>/dev/null; then
      echo "[stack] failed to stop ${service} pid=${pid} (permission denied?)"
      return 1
    fi

    local retries=40
    local i=0
    while is_pid_running "${pid}"; do
      i=$((i + 1))
      if [[ "${i}" -ge "${retries}" ]]; then
        if ! kill -9 "${pid}" 2>/dev/null; then
          echo "[stack] failed to force-stop ${service} pid=${pid}"
          return 1
        fi
        break
      fi
      sleep 0.25
    done

    rm -f "${pid_path}"
    echo "[stack] stopped ${service}"
    return 0
  fi

  rm -f "${pid_path}"
  local external_pid
  external_pid="$(pid_on_port "${port}")"
  if [[ -n "${external_pid}" ]]; then
    if ! kill "${external_pid}" 2>/dev/null; then
      echo "[stack] failed to stop ${service} unmanaged pid=${external_pid} (permission denied?)"
      return 1
    fi
    local retries=40
    local i=0
    while is_pid_running "${external_pid}"; do
      i=$((i + 1))
      if [[ "${i}" -ge "${retries}" ]]; then
        if ! kill -9 "${external_pid}" 2>/dev/null; then
          echo "[stack] failed to force-stop ${service} unmanaged pid=${external_pid}"
          return 1
        fi
        break
      fi
      sleep 0.25
    done
    echo "[stack] stopped ${service} unmanaged pid=${external_pid}"
    return 0
  fi

  echo "[stack] ${service} is not running"
}

status_service() {
  local service="$1"
  local port="$2"
  local pid
  pid="$(read_pid "$(pid_file "${service}")")"
  if is_pid_running "${pid}"; then
    echo "[stack] ${service}: running pid=${pid} port=${port}"
    return 0
  fi
  local external_pid
  external_pid="$(pid_on_port "${port}")"
  if [[ -n "${external_pid}" ]]; then
    echo "[stack] ${service}: running unmanaged pid=${external_pid} port=${port}"
    return 0
  else
    echo "[stack] ${service}: stopped port=${port}"
  fi
}

cmd_start() {
  start_electric
  start_service "gateway-realtime" "dev:realtime" "${REALTIME_PORT}"
  start_service "gateway-api" "dev:api" "${API_PORT}"
  start_service "gateway-workers" "dev:workers" "${WORKERS_PORT}"
  echo "[stack] logs: ${LOG_DIR}"
}

cmd_stop() {
  stop_service "gateway-workers" "${WORKERS_PORT}"
  stop_service "gateway-api" "${API_PORT}"
  stop_service "gateway-realtime" "${REALTIME_PORT}"
  stop_electric
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  status_electric
  status_service "gateway-realtime" "${REALTIME_PORT}"
  status_service "gateway-api" "${API_PORT}"
  status_service "gateway-workers" "${WORKERS_PORT}"
}

cmd_logs() {
  local service="all"
  local follow=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -f|--follow)
        follow=1
        ;;
      all|electric|gateway-realtime|gateway-api|gateway-workers)
        service="$1"
        ;;
      *)
        echo "[stack] unknown logs argument: $1"
        usage
        return 1
        ;;
    esac
    shift
  done

  if [[ "${follow}" -eq 0 ]]; then
    if [[ "${service}" == "all" ]]; then
      local realtime_file api_file workers_file
      realtime_file="$(resolve_log_file "gateway-realtime")"
      api_file="$(resolve_log_file "gateway-api")"
      workers_file="$(resolve_log_file "gateway-workers")"
      tail -n 120 \
        "${realtime_file}" \
        "${api_file}" \
        "${workers_file}"
      if docker_available && [[ -n "$(electric_container_id)" ]]; then
        echo "==> electric <=="
        docker logs --tail 120 "${ELECTRIC_CONTAINER_NAME}" 2>&1 || true
      fi
      return 0
    fi
    if [[ "${service}" == "electric" ]]; then
      if docker_available && [[ -n "$(electric_container_id)" ]]; then
        docker logs --tail 120 "${ELECTRIC_CONTAINER_NAME}" 2>&1
      else
        echo "[stack] electric is not running"
      fi
      return 0
    fi
    tail -n 120 "$(resolve_log_file "${service}")"
    return 0
  fi

  local reset color_electric color_realtime color_api color_workers
  reset="$(printf '\033[0m')"
  color_electric="$(printf '\033[38;5;45m')"
  color_realtime="$(printf '\033[38;5;81m')"
  color_api="$(printf '\033[38;5;214m')"
  color_workers="$(printf '\033[38;5;171m')"

  local pids=()

  stream_service() {
    local svc="$1"
    local color="$2"
    local file
    file="$(resolve_log_file "${svc}")"
    touch "${file}"
    echo "[stack] following ${svc} from ${file}"
    tail -n 120 -F "${file}" 2>&1 | awk -v tag="${svc}" -v c="${color}" -v r="${reset}" '
      {
        printf "%s[%s]%s %s\n", c, tag, r, $0;
        fflush();
      }
    ' &
    pids+=("$!")
  }

  stream_electric() {
    if ! docker_available || [[ -z "$(electric_container_id)" ]]; then
      echo "[stack] electric is not running"
      return 0
    fi
    echo "[stack] following electric from docker logs"
    docker logs --tail 120 -f "${ELECTRIC_CONTAINER_NAME}" 2>&1 | awk -v tag="electric" -v c="${color_electric}" -v r="${reset}" '
      {
        printf "%s[%s]%s %s\n", c, tag, r, $0;
        fflush();
      }
    ' &
    pids+=("$!")
  }

  cleanup_logs() {
    local pid
    for pid in "${pids[@]}"; do
      kill "${pid}" 2>/dev/null || true
    done
  }

  trap cleanup_logs INT TERM EXIT

  if [[ "${service}" == "all" ]]; then
    stream_electric
    stream_service "gateway-realtime" "${color_realtime}"
    stream_service "gateway-api" "${color_api}"
    stream_service "gateway-workers" "${color_workers}"
  else
    if [[ "${service}" == "electric" ]]; then
      stream_electric
      wait
      return 0
    fi
    local service_color="${color_realtime}"
    if [[ "${service}" == "gateway-api" ]]; then
      service_color="${color_api}"
    elif [[ "${service}" == "gateway-workers" ]]; then
      service_color="${color_workers}"
    fi
    stream_service "${service}" "${service_color}"
  fi

  wait
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|stop|restart|status|logs> [service]

Services:
  electric
  gateway-realtime
  gateway-api
  gateway-workers

Examples:
  $(basename "$0") start
  $(basename "$0") restart
  $(basename "$0") status
  $(basename "$0") logs gateway-realtime
  $(basename "$0") logs --follow
  $(basename "$0") logs gateway-api --follow
EOF
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    start) cmd_start ;;
    stop) cmd_stop ;;
    restart) cmd_restart ;;
    status) cmd_status ;;
    logs) shift || true; cmd_logs "$@" ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
