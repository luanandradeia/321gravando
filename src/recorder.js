import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Inicia a gravação da tela virtual (Xvfb) e áudio virtual (PulseAudio) via FFmpeg
 * @param {string} outputPath - Caminho final do arquivo .mp4 a ser gerado
 * @returns {Promise<ChildProcess>} - Objeto do processo FFmpeg iniciado
 */
export function startRecording(outputPath) {
  return new Promise((resolve, reject) => {
    // Garante que o diretório de destino existe
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const display = process.env.DISPLAY || ':99';
    console.log(`[Recorder] Iniciando gravação do display ${display} e áudio virtual...`);

    // Comando FFmpeg configurado para Debian 13 (x11grab + pulse)
    const ffmpegArgs = [
      '-y',                         // Sobrescreve arquivo existente
      '-f', 'x11grab',              // Capturador de tela X11
      '-draw_mouse', '0',           // Oculta o cursor do mouse
      '-s', '1920x1080',            // Resolução da gravação
      '-r', '30',                   // 30 FPS
      '-i', `${display}.0`,         // Fonte da tela virtual
      '-f', 'pulse',                // Capturador de áudio PulseAudio
      '-i', 'virtual-sink.monitor', // Monitor do sink virtual
      '-c:v', 'libx264',            // Codec de vídeo H.264
      '-pix_fmt', 'yuv420p',        // Formato de pixel compatível com web players
      '-preset', 'veryfast',        // Preset de encode rápido para economizar CPU
      '-c:a', 'aac',                // Codec de áudio AAC
      '-b:a', '128k',               // Bitrate de áudio de 128kbps
      outputPath                    // Destino
    ];

    console.log(`[Recorder] Comando: ffmpeg ${ffmpegArgs.join(' ')}`);

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'] // Abre pipes para controle
    });

    // Monitora saída de erro padrão (onde o FFmpeg cospe logs normais)
    ffmpegProcess.stderr.on('data', (data) => {
      const log = data.toString();
      // Opcional: ativar debug para logs completos do FFmpeg
      if (log.includes('time=')) {
        // Exibe apenas a linha de progresso
        process.stdout.write(`\r[Recorder Status] ${log.trim().split('\n').pop()}`);
      }
    });

    ffmpegProcess.on('error', (err) => {
      console.error('\n[Recorder] Falha ao iniciar FFmpeg:', err);
      reject(err);
    });

    // Pequeno delay para garantir que o FFmpeg iniciou com sucesso antes de retornar
    setTimeout(() => {
      console.log('\n[Recorder] FFmpeg iniciado e gravando ativamente.');
      resolve(ffmpegProcess);
    }, 2000);
  });
}

/**
 * Encerra a gravação de forma limpa, escrevendo os metadados do MP4 corretamente
 * @param {ChildProcess} ffmpegProcess - O processo do FFmpeg retornado por startRecording
 * @returns {Promise<void>}
 */
export function stopRecording(ffmpegProcess) {
  return new Promise((resolve) => {
    if (!ffmpegProcess) {
      console.log('[Recorder] Nenhum processo de gravação ativo para parar.');
      return resolve();
    }

    console.log('\n[Recorder] Parando a gravação de forma limpa...');

    // Envia o caractere 'q' para a entrada padrão do FFmpeg (atalho nativo para encerramento gracioso)
    ffmpegProcess.stdin.write('q\n');

    const timeout = setTimeout(() => {
      console.log('[Recorder] FFmpeg demorou para responder. Forçando encerramento (SIGINT)...');
      ffmpegProcess.kill('SIGINT');
    }, 10000);

    ffmpegProcess.on('exit', (code, signal) => {
      clearTimeout(timeout);
      console.log(`[Recorder] FFmpeg finalizado. Código de saída: ${code}, Sinal: ${signal}`);
      resolve();
    });
  });
}
