FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ifcopenshell && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3001 MODEL_STORAGE_DIR=/data/models
VOLUME ["/data"]
EXPOSE 3001
CMD ["node", "index.js"]
