FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        bzip2 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L \
        https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh \
        -o /tmp/miniforge.sh \
    && bash /tmp/miniforge.sh -b -p /opt/conda \
    && rm /tmp/miniforge.sh

RUN /opt/conda/bin/conda install -y \
        -c conda-forge \
        ifcopenshell \
    && /opt/conda/bin/conda clean -afy

ENV PATH="/opt/conda/bin:${PATH}"

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev

COPY . .

ENV PORT=3001
ENV MODEL_STORAGE_DIR=/data/models
ENV IFC_CONVERT_PATH=/opt/conda/bin/IfcConvert

VOLUME ["/data"]

EXPOSE 3001

CMD ["node", "index.js"]
