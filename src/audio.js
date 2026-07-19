import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Executa comandos shell retornando uma promise
 */
const execPromise = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

/**
 * Processa o áudio do vídeo gravado: extrai, acelera 1.5x, remove silêncios e divide em chunks de ~15 minutos.
 * @param {string} videoPath - Caminho do arquivo MP4 gravado.
 * @param {string} tempDir - Diretório temporário para processamento.
 * @returns {Promise<string[]>} - Lista de caminhos absolutos dos chunks de áudio gerados.
 */
export async function processAudioPipeline(videoPath, tempDir) {
  const processedAudioPath = path.join(tempDir, 'processed.mp3');
  const chunksDir = path.join(tempDir, 'chunks');

  // Garante que as pastas existem e limpa resíduos de execuções anteriores
  if (fs.existsSync(chunksDir)) {
    fs.rmSync(chunksDir, { recursive: true, force: true });
  }
  fs.mkdirSync(chunksDir, { recursive: true });

  console.log('[Audio] Iniciando pipeline de processamento do áudio...');

  // Passo 1: Extração + Remoção de Silêncio + Aceleração 1.5x
  // Filtro de silêncio: silenceremove=stop_periods=-1:stop_duration=2:stop_threshold=-45dB
  // Filtro de tempo: atempo=1.5 (mantém o tom natural)
  console.log('[Audio] Passo 1/2: Extraindo, removendo silêncio e acelerando áudio (1.5x)...');
  const processCmd = `ffmpeg -y -i "${videoPath}" -vn -filter:a "silenceremove=stop_periods=-1:stop_duration=2:stop_threshold=-45dB,atempo=1.5" -acodec libmp3lame -q:a 2 "${processedAudioPath}"`;
  
  await execPromise(processCmd);
  console.log('[Audio] Áudio processado com sucesso.');

  // Passo 2: Segmentação em pedaços de 15 minutos (~900 segundos) para a API do Groq
  console.log('[Audio] Passo 2/2: Fatiando áudio em pedaços de 15 minutos...');
  const chunksPattern = path.join(chunksDir, 'chunk_%03d.mp3');
  const segmentCmd = `ffmpeg -y -i "${processedAudioPath}" -f segment -segment_time 900 -c copy "${chunksPattern}"`;
  
  await execPromise(segmentCmd);
  
  // Lista todos os arquivos mp3 gerados na pasta de chunks
  const files = fs.readdirSync(chunksDir)
    .filter(file => file.endsWith('.mp3'))
    .map(file => path.join(chunksDir, file))
    .sort();

  console.log(`[Audio] Segmentação concluída. ${files.length} chunk(s) gerado(s).`);
  return files;
}
