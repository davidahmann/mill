FROM node@sha256:78b162211207872503ea9245188122b815150b9b4380e47a7c4a447332c01660
LABEL dev.mill.purpose="attended-maintainer-bootstrap" dev.mill.source="ceaf76a0e4b8237d2dcb0d016ed84e3c9ba5cfb8"
COPY package.json package-lock.json /opt/mill-maintainer/
RUN cd /opt/mill-maintainer \
    && npm ci --ignore-scripts --cache /opt/npm-cache --no-audit --no-fund \
    && npm install --prefix /opt/runtime-install commander@15.0.0 yaml@2.9.0 zod@4.5.4 --cache /opt/npm-cache --ignore-scripts --no-audit --no-fund \
    && npm cache verify --cache /opt/npm-cache \
    && chmod -R a+rX /opt/mill-maintainer /opt/npm-cache \
    && test "$(node --version)" = v24.20.0 \
    && test "$(npm --version)" = 11.19.0 \
    && test -x /usr/bin/git
ENV npm_config_cache=/opt/npm-cache npm_config_offline=true npm_config_audit=false npm_config_fund=false
