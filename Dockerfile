FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates xvfb openbox dbus-x11 tini \
    libgtk-3-0 libnss3 libnspr4 libatk-bridge2.0-0 libdrm2 libgbm1 libasound2 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libxss1 libxtst6 \
    libcups2 libxkbcommon0 fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && node node_modules/electron/install.js && chown root:root node_modules/electron/dist/chrome-sandbox \
    && chmod 755 node_modules/electron/dist/chrome-sandbox
COPY browser ./browser
COPY scripts/container-start.sh ./scripts/container-start.sh
RUN sed -i 's/\r$//' scripts/container-start.sh \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix && mkdir -p /data && chown node:node /data && chmod 700 /data \
    && chmod 755 scripts/container-start.sh
ENV NODE_ENV=production MULTIOLX_WEB=1 MULTIOLX_BROWSER_DATA_DIR=/data PORT=3000 DISPLAY=:99
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["/app/scripts/container-start.sh"]
