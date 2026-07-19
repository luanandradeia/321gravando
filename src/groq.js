import Groq from 'groq-sdk';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Transcreve chunks de áudio sequencialmente usando o Groq Whisper e gera um resumo inteligente.
 * @param {string[]} chunkPaths - Lista de caminhos dos arquivos mp3 a serem transcritos.
 * @returns {Promise<string>} - Ata de Reunião formatada em Markdown.
 */
export async function transcribeAndSummarize(chunkPaths) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'sua_chave_aqui') {
    throw new Error('Chave GROQ_API_KEY não foi configurada no arquivo .env.');
  }

  const groq = new Groq({ apiKey });
  let rawTranscriptions = [];

  console.log(`[Groq] Iniciando transcrição de ${chunkPaths.length} chunk(s) com Whisper-large-v3...`);

  for (let i = 0; i < chunkPaths.length; i++) {
    const chunkPath = chunkPaths[i];
    console.log(`[Groq] Transcrevendo chunk ${i + 1}/${chunkPaths.length} (${chunkPath})...`);
    
    try {
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(chunkPath),
        model: 'whisper-large-v3',
        language: 'pt',
        response_format: 'json'
      });
      
      if (transcription && transcription.text) {
        rawTranscriptions.push(transcription.text);
      }
    } catch (err) {
      console.error(`[Groq] Erro ao transcrever o chunk ${chunkPath}:`, err.message);
      // Adiciona aviso ao texto caso falhe para não quebrar o pipeline inteiro
      rawTranscriptions.push(`[ERRO NA TRANSCRIÇÃO DO CHUNK ${i + 1}]`);
    }
  }

  const completeRawTranscript = rawTranscriptions.join(' ');
  console.log('[Groq] Transcrição bruta concluída. Iniciando inteligência de resumo...');

  if (!completeRawTranscript.trim() || completeRawTranscript.startsWith('[ERRO')) {
    return '# Ata de Reunião\n\nNão foi possível obter áudio suficiente para transcrever.';
  }

  // Modelos recomendados do Groq para processamento de texto
  const modelToUse = 'llama-3.3-70b-specdec'; 
  
  try {
    console.log(`[Groq] Gerando ata estruturada com o modelo: ${modelToUse}...`);
    
    const chatCompletion = await groq.chat.completions.create({
      model: modelToUse,
      messages: [
        {
          role: 'system',
          content: `Você é um Notetaker profissional e redator de atas de reuniões corporativas de alto nível. 
Sua tarefa é ler a transcrição bruta (obtida de uma reunião gravada) e criar um documento em Markdown profissional, elegante, rico em detalhes e fácil de ler (em Português do Brasil).

Estruture o documento exatamente nas seguintes seções:
1. **Título da Reunião** (Use um nome contextual baseado no tema abordado)
2. **Data & Horário** (Se não for óbvio, coloque a data atual)
3. **Resumo Executivo** (Um parágrafo de síntese da reunião)
4. **Tópicos Abordados & Discussões** (Detalhamento dos assuntos conversados em tópicos, explicando quem disse o quê se identificável, ou detalhando as discussões técnicas de forma completa)
5. **Decisões Tomadas** (Lista de pontos acordados)
6. **Ações & Próximos Passos** (Lista de tarefas atribuídas, com responsáveis se houver)`
        },
        {
          role: 'user',
          content: `Transcrições brutas da reunião:\n\n${completeRawTranscript}`
        }
      ],
      temperature: 0.3
    });

    const structuredAta = chatCompletion.choices[0]?.message?.content || 'Erro ao gerar o resumo.';
    
    // Compila o arquivo final anexando a transcrição bruta no final para referência
    const finalMarkdown = `${structuredAta}\n\n---\n\n## Transcrição Bruta Completa\n\n${completeRawTranscript}`;
    
    console.log('[Groq] Ata de reunião e resumo gerados com sucesso!');
    return finalMarkdown;

  } catch (err) {
    console.error('[Groq] Erro ao gerar o resumo estruturado:', err.message);
    
    // Fallback caso a API do Llama falhe (salva a transcrição bruta)
    const fallbackMarkdown = `# Ata da Reunião (Apenas Transcrição)\n\n*Aviso: Ocorreu um erro ao gerar a ata resumida via LLM. Abaixo está a transcrição bruta do áudio.*\n\n## Transcrição\n\n${completeRawTranscript}`;
    return fallbackMarkdown;
  }
}
