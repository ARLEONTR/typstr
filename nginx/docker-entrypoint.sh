#!/bin/sh
set -eu

BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
TEMPLATE="/etc/nginx/nginx.conf.template"
CONF="/etc/nginx/nginx.conf"

# Resolve all IPs Docker has registered for the backend service.
# With `--scale backend=N`, Docker DNS returns one A record per replica.
ips=$(getent ahostsv4 "${BACKEND_SERVICE}" 2>/dev/null | awk '$2 == "STREAM" {print $1}' | sort -u)
if [ -z "$ips" ]; then
  ips=$(getent hosts "${BACKEND_SERVICE}" 2>/dev/null | awk '{print $1}' | sort -u)
fi

if [ -z "$ips" ]; then
  echo "[nginx-entrypoint] WARNING: no IPs resolved for '${BACKEND_SERVICE}', falling back to service name"
  servers="    server ${BACKEND_SERVICE}:${BACKEND_PORT};"
else
  servers=""
  for ip in $ips; do
    case "$ip" in
      *:*) upstream_host="[${ip}]" ;;
      *) upstream_host="${ip}" ;;
    esac
    servers="${servers}    server ${upstream_host}:${BACKEND_PORT};
"
  done
  count=$(echo "$ips" | wc -l | tr -d ' ')
  echo "[nginx-entrypoint] resolved ${count} backend replica(s) for '${BACKEND_SERVICE}'"
fi

# Inject server lines into the template (replace %%BACKEND_SERVERS%%)
awk -v s="${servers}" '{
  idx = index($0, "%%BACKEND_SERVERS%%")
  if (idx > 0) printf "%s", s
  else print
}' "${TEMPLATE}" > "${CONF}"

exec nginx -g "daemon off;"
