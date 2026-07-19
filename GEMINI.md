# Regras do Projeto (Notetaker Local)

Este documento define as regras de desenvolvimento e comunicação para o projeto Notetaker Local.

## Regra de Comunicação Crítica (Idioma)
- **Idioma de Comunicação**: O assistente de IA (Antigravity) deve responder **apenas em Português do Brasil (PT-BR)** durante toda a colaboração neste projeto, tanto nas mensagens de chat quanto nos planos e relatórios gerados (exceto quando explicitamente solicitado o contrário ou para termos técnicos inerentes ao código).

## Regras de Desenvolvimento
1. **Ambiente de Destino**: O sistema será implantado em um servidor doméstico Debian 13. Todo código de automação, scripts Bash e comandos devem ser compatíveis com Debian 13.
2. **Qualidade Visual do Dashboard**: O dashboard web deve ter uma estética premium e moderna (Glassmorphism, Dark Mode, fontes modernas e transições suaves). Não utilizar placeholders ou designs excessivamente simples.
3. **Robustez na Captura de Sinais**: Garantir que o encerramento do script via `Ctrl+C` (sinal `SIGINT`) seja capturado graciosamente para que os streams do FFmpeg e Puppeteer sejam fechados de maneira limpa, sem corromper os arquivos MP4 gerados.
4. **Respeito aos Limites da API Groq**: Os chunks de áudio enviados para a API Groq Whisper devem ser sempre menores que 25MB (limite recomendado de 20MB para segurança).
5. **Preservação de Logs e Histórico**: Manter logs claros no terminal durante a gravação e o pós-processamento para facilitar o debug via SSH.
