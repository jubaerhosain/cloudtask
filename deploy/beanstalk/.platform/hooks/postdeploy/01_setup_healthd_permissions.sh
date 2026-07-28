#!/bin/bash
# Give the nginx user inside the proxy container ownership of the bind-mounted
# log directory, so it can write the healthd logs that Elastic Beanstalk's
# enhanced health agent reads.
#
# Adapted from the Docker Compose platform hook in the AWS Elastic Beanstalk
# developer guide. Without this, /var/log/nginx is owned by root on the host,
# nginx cannot write to it, and enhanced health reports no request metrics at
# all while the application itself works perfectly — a confusing combination.
set -euo pipefail

NGINX_CONTAINER=$(docker ps --filter "name=nginx-proxy" -q | head -n1)

if [ -z "$NGINX_CONTAINER" ]; then
    echo "Error: no nginx-proxy container is running" >&2
    exit 1
fi

NGINX_UID=$(docker exec "${NGINX_CONTAINER}" id -u nginx)
NGINX_GID=$(docker exec "${NGINX_CONTAINER}" id -g nginx)

mkdir -p /var/log/nginx/healthd
chown -R "${NGINX_UID}:${NGINX_GID}" /var/log/nginx

echo "healthd log directory owned by ${NGINX_UID}:${NGINX_GID}"
