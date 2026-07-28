# Reverse proxy for the CloudTask Elastic Beanstalk environment.
#
# Built on the instance by `docker compose build` during deployment, so it
# needs no ECR repository of its own.
FROM public.ecr.aws/nginx/nginx:1.27-alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY proxy_headers.conf /etc/nginx/proxy_headers.conf

# Elastic Beanstalk's health agent reads healthd logs from /var/log/nginx,
# which docker-compose.yml bind-mounts from the host.
RUN mkdir -p /var/log/nginx/healthd

EXPOSE 80
