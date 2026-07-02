# syntax=docker/dockerfile:1
# openldr-gateway — nginx reverse proxy with the OpenLDR routing baked in.
# The official nginx entrypoint runs envsubst on /etc/nginx/templates/*.template at start,
# so ${SERVER_NAME} is still substituted at runtime. TLS certs stay mounted (host-specific).
FROM nginx:1.27-alpine
COPY openldr.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80 443
