import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config();

// Ativa o plugin stealth
puppeteer.use(StealthPlugin());

/**
 * Função para aguardar um tempo específico
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Inicia o navegador e entra na reunião do Google Meet
 * @param {string} url - Link da reunião do Google Meet
 */
export async function launchBrowser(url) {
  console.log(`[Puppeteer] Iniciando Chromium no caminho: ${process.env.CHROMIUM_PATH || 'Padrão'}`);
  
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: false, // Roda com interface visível no display virtual (Xvfb)
    defaultViewport: { width: 1920, height: 1080 },
    ignoreDefaultArgs: ['--enable-automation'], // Remove o banner de controle automatizado do topo do Chrome
    args: [
      `--display=${process.env.DISPLAY || ':99'}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream', // Auto-permite câmera e microfone
      '--use-fake-device-for-media-stream', // Usa microfone/câmera falsos
      '--autoplay-policy=no-user-gesture-required',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--kiosk', // Roda no modo Kiosk (tela cheia, remove bordas, barras e abas do browser)
      '--start-fullscreen', // Inicia em tela cheia
      '--lang=pt-BR' // Força idioma para facilitar seletores
    ]
  });

  const page = await browser.newPage();
  
  // Define permissões explícitas para microfone e câmera
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://meet.google.com', ['microphone', 'camera']);

  console.log(`[Puppeteer] Navegando para: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  try {
    // 1. Desativar câmera e microfone logo no lobby
    console.log('[Puppeteer] Aguardando botões do lobby para desativar câmera e microfone...');
    await delay(5000); // Dá tempo para o lobby carregar os botões de áudio/vídeo

    // Executa clique direto nos botões do lobby se estiverem ativos
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[role="button"], button, div[role="button"]'));
      
      const micMuteLabels = ['desativar microfone', 'turn off microphone', 'mute microphone', 'desativar som', 'desativar o som'];
      const camMuteLabels = ['desativar câmera', 'turn off camera', 'desativar vídeo', 'camera off', 'desativar a câmera'];

      // Procura o botão de desativar microfone
      const micButton = elements.find(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        return micMuteLabels.some(phrase => label.includes(phrase));
      });
      if (micButton) {
        console.log('[Puppeteer] Desativando microfone via clique.');
        micButton.click();
      }

      // Procura o botão de desativar câmera
      const camButton = elements.find(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        return camMuteLabels.some(phrase => label.includes(phrase));
      });
      if (camButton) {
        console.log('[Puppeteer] Desativando câmera via clique.');
        camButton.click();
      }
    });

    await delay(1500);

    // 2. Localiza o input de nome de visitante
    console.log('[Puppeteer] Aguardando campo de nome...');
    const nameInputSelector = 'input[type="text"]';
    await page.waitForSelector(nameInputSelector, { timeout: 15000 });
    
    const botName = process.env.BOT_NAME || 'Notetaker Assistant';
    console.log(`[Puppeteer] Inserindo nome do bot: "${botName}"`);
    await page.type(nameInputSelector, botName, { delay: 100 });
    
    await delay(1000);

    // 3. Clica no botão de participar ("Pedir para participar" ou "Ask to join")
    console.log('[Puppeteer] Procurando botão de participar...');
    
    // Função robusta que avalia os botões na página
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const joinPhrases = [
        'pedir para participar', 
        'ask to join', 
        'participar', 
        'join', 
        'pedir'
      ];
      
      for (const button of buttons) {
        const text = (button.textContent || '').toLowerCase().trim();
        if (joinPhrases.some(phrase => text.includes(phrase))) {
          button.click();
          return true;
        }
      }
      return false;
    });

    if (clicked) {
      console.log('[Puppeteer] Botão de participar clicado com sucesso!');
    } else {
      console.log('[Puppeteer] AVISO: Botão de participar não foi encontrado por texto. Tentando clicar no primeiro botão disponível ao lado do input...');
      // Backup: Tenta clicar em um botão estrutural próximo ao input
      await page.keyboard.press('Enter');
    }

    console.log('[Puppeteer] Aguardando aprovação de entrada pelo anfitrião...');
    
    // Aguarda a entrada na reunião. Quando entra, o input de nome desaparece e a interface principal é carregada.
    var admitted = false;
    for (let i = 0; i < 60; i++) { // Espera até 5 minutos (60 * 5s)
      const inputExists = await page.evaluate((sel) => !!document.querySelector(sel), nameInputSelector);
      if (!inputExists) {
        admitted = true;
        console.log('[Puppeteer] Acesso concedido! Entrou na reunião.');
        
        // Injeta código na página para ocultar banners de suporte e aviso indesejados (ex: navegador desatualizado)
        try {
          await page.evaluate(() => {
            setInterval(() => {
              const elements = Array.from(document.querySelectorAll('div, span, p'));
              const badPhrases = [
                'não é mais compatível', 
                'no longer supported', 
                'navegador não suportado', 
                'browser is no longer'
              ];
              for (const el of elements) {
                const text = (el.textContent || '').toLowerCase();
                if (badPhrases.some(phrase => text.includes(phrase))) {
                  // Sobe na árvore DOM para ocultar apenas o container estreito (banner)
                  // Garantimos que nunca ocultamos contêineres grandes (altura > 150px) para não zerar a tela
                  let container = el;
                  while (container && container.tagName !== 'BODY') {
                    const height = container.offsetHeight;
                    if (height > 0 && height < 150) {
                      container.style.setProperty('display', 'none', 'important');
                      break;
                    }
                    container = container.parentElement;
                  }
                }
              }
            }, 2500);
          });
          console.log('[Puppeteer] Script de ocultação de banners ativado com sucesso.');
        } catch (e) {
          console.log('[Puppeteer] AVISO: Não foi possível injetar script de ocultação de banners:', e.message);
        }
        
        break;
      }
      await delay(5000);
      console.log('[Puppeteer] Ainda no lobby, aguardando admissão...');
    }

    if (!admitted) {
      console.log('[Puppeteer] AVISO: Tempo limite de admissão esgotado. Continuando gravação de qualquer forma...');
    }

  } catch (error) {
    console.error('[Puppeteer] Erro durante a navegação/entrada na reunião:', error.message);
    throw error;
  }

  return { browser, page, admitted };
}
