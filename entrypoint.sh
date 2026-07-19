#!/bin/bash
set -e

echo "[Docker Entrypoint] Limpando travas residuais de Xvfb..."
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

echo "[Docker Entrypoint] Iniciando servidor de áudio PulseAudio..."
# Permite rodar como root se necessário, embora avise nos logs.
pulseaudio --start --exit-idle-time=-1 --system=false || true

# Pequena pausa para garantir que o PulseAudio carregou
sleep 2

echo "[Docker Entrypoint] Configurando sink de áudio virtual..."
# Cria a saída de áudio virtual nula e a define como padrão
pactl load-module module-null-sink sink_name=virtual-sink sink_properties=device.description=Virtual-Sink || true
pactl set-default-sink virtual-sink || true

echo "[Docker Entrypoint] Iniciando monitor virtual Xvfb na tela :99..."
# Abre a tela virtual com profundidade de cor de 24 bits
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &

# Aguarda o Xvfb estar pronto
sleep 2

echo "[Docker Entrypoint] Configurações de ambiente prontas. Executando comando..."
# Executa o comando passado pelo Docker (npm run gravar ou npm run dashboard)
exec "$@"
