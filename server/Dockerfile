FROM node:25-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        bzip2 \
        gosu \
    && rm -rf /var/lib/apt/lists/*

ARG MINIFORGE_VERSION=26.3.2-2
ARG MINIFORGE_SHA256=42260ffe3830fb953d5eee1bbb32229ff06aa7c3833c1ed7a9a0420a95685d94
RUN curl --fail --show-error --location \
        "https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VERSION}/Miniforge3-${MINIFORGE_VERSION}-Linux-x86_64.sh" \
        -o /tmp/miniforge.sh \
    && echo "${MINIFORGE_SHA256}  /tmp/miniforge.sh" | sha256sum -c - \
    && bash /tmp/miniforge.sh -b -p /opt/conda \
    && rm /tmp/miniforge.sh

RUN /opt/conda/bin/conda install -y \
        -c conda-forge \
        ifcopenshell=0.8.5 \
    && /opt/conda/bin/conda clean -afy

ENV PATH="/opt/conda/bin:${PATH}"

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY . .

ENV PORT=3001
ENV MODEL_STORAGE_DIR=/data/models
ENV IFC_CONVERT_PATH=/opt/conda/bin/IfcConvert
ENV TEMP_DIR=/data/tmp

RUN mkdir -p /data/models /data/tmp \
    && chown -R node:node /app /data \
    && chmod +x /app/docker-entrypoint.sh

VOLUME ["/data"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "index.js"]
