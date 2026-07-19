FROM node:20-bullseye-slim

# Evita prompts interativos durante a instalação de pacotes
ENV DEBIAN_FRONTEND=noninteractive

# Instala dependências do sistema: Chromium, FFmpeg, Xvfb, PulseAudio e fontes de texto
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    pulseaudio \
    pulseaudio-utils \
    ffmpeg \
    chromium \
    fonts-freefont-ttf \
    fonts-liberation \
    fonts-kacst \
    fonts-thai-tlwg \
    fonts-wqy-zenhei \
    libasound2 \
    dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# Configurações do Puppeteer para usar o Chromium do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV DISPLAY=:99

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala as dependências do Node.js
RUN npm install

# Copia o código fonte da aplicação
COPY . .

# Garante que o script de entrypoint tem permissão de execução
RUN chmod +x entrypoint.sh

# Porta exposta do Dashboard
EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
