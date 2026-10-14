// Wrapper da Web Speech API.
// continuous=false porque continuous=true repete resultados no Chrome Android;
// enquanto o estado for "gravando", a sessão é reiniciada em onend.
// Não abrimos o microfone com getUserMedia: no Android, dois acessos simultâneos
// podem derrubar o reconhecimento. A animação reage a onresult.

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export const suportado = !!SR;

/**
 * @param {object} cb
 * @param {(final: string, parcial: string) => void} cb.aoTexto  texto acumulado da gravação
 * @param {() => void} cb.aoResultado   a cada onresult (pulso do anel)
 * @param {(gravando: boolean) => void} cb.aoEstado
 * @param {(codigo: string) => void} cb.aoErro  'network' | 'not-allowed' | 'audio-capture' | outro
 */
export function criarDitado({ aoTexto, aoResultado, aoEstado, aoErro }) {
  if (!SR) return null;

  let rec = null;
  let gravando = false;
  let acumulado = '';   // finais das sessões anteriores desta gravação
  let sessaoFinal = ''; // finais da sessão atual (reconstruído a cada evento, nunca somado)
  let parcial = '';

  function emitir() {
    aoTexto(juntar(acumulado, sessaoFinal), parcial);
  }

  function novaSessao() {
    rec = new SR();
    rec.lang = 'pt-BR';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      // Reconstruir a partir de ev.results evita duplicar trechos quando o Chrome
      // reenvia resultados já finalizados.
      let fin = '';
      let par = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) fin = juntar(fin, r[0].transcript);
        else par = juntar(par, r[0].transcript);
      }
      sessaoFinal = fin;
      parcial = par;
      emitir();
      aoResultado();
    };

    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return; // onend reinicia
      gravando = false;
      aoErro(ev.error === 'service-not-allowed' ? 'not-allowed' : ev.error);
    };

    rec.onend = () => {
      acumulado = juntar(acumulado, sessaoFinal);
      sessaoFinal = '';
      parcial = '';
      if (gravando) {
        try {
          novaSessao();
          rec.start();
          return;
        } catch (err) {
          gravando = false;
        }
      }
      emitir();
      aoEstado(false);
    };
  }

  return {
    get gravando() { return gravando; },

    // `base` é o texto já presente no campo; o ditado continua a partir dele.
    iniciar(base = '') {
      if (gravando) return;
      acumulado = base.trim();
      sessaoFinal = '';
      parcial = '';
      gravando = true;
      novaSessao();
      try {
        rec.start();
      } catch (err) {
        gravando = false;
        aoErro('start');
        return;
      }
      aoEstado(true);
      emitir();
    },

    parar() {
      if (!gravando) return;
      gravando = false;
      // stop() entrega o último resultado e dispara onend, que finaliza o texto.
      try { rec.stop(); } catch (err) { /* já parado */ }
    }
  };
}

function juntar(a, b) {
  a = (a || '').trim();
  b = (b || '').trim();
  if (!a) return b;
  if (!b) return a;
  return a + ' ' + b;
}
