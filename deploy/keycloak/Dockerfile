# OpenLDR CE Keycloak image: stock Keycloak 26 with the OpenLDR login theme baked in
# so it is on local disk (fast, cached by production `start` mode) rather than mounted
# at runtime. Build context is deploy/keycloak (see scripts/build-and-push.sh).
FROM quay.io/keycloak/keycloak:26.0
COPY themes/openldr /opt/keycloak/themes/openldr
