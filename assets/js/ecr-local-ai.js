/*
 * Risposta generata nel browser con WebLLM (@mlc-ai/web-llm 0.2.86, da CDN jsDelivr). La libreria e il
 * modello si caricano solo alla prima richiesta; domanda e brani restano sul dispositivo. Richiede WebGPU.
 */
(function () {
  'use strict';

  if (window.ecrLocalAi) return;

  var LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js';
  var MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
  var SYSTEM = 'Sei l\'assistente della guida ai registratori telematici EDIT. Rispondi in italiano, in modo breve '
    + 'e preciso, usando solo i brani forniti. Se i brani non contengono la risposta, dillo chiaramente e invita a '
    + 'consultare le sezioni indicate. Non inventare codici, numeri di funzione o procedure.';

  var engine = null;
  var loading = null;

  function supported() {
    return !!navigator.gpu;
  }

  function getEngine(onStatus) {
    if (engine) return Promise.resolve(engine);
    if (loading) return loading;
    loading = import(LIBRARY_URL).then(function (webllm) {
      return webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: function (r) {
          onStatus(r.text || 'Caricamento del modello in corso…');
        }
      }, { context_window_size: 4096 });
    }).then(function (e) {
      engine = e;
      return e;
    }, function (err) {
      loading = null;
      throw err;
    });
    return loading;
  }

  function ask(question, passages, onStatus) {
    if (!supported()) return Promise.reject(new Error('WebGPU non disponibile in questo browser'));
    return getEngine(onStatus).then(function (e) {
      onStatus('Genero la risposta…');
      var context = passages.map(function (p, i) {
        return '[' + (i + 1) + '] ' + p.title + (p.heading ? ' - ' + p.heading : '') + ': ' + p.text;
      }).join('\n\n');
      return e.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: 'Brani della guida:\n\n' + context + '\n\nDomanda: ' + question }
        ],
        temperature: 0.2,
        max_tokens: 350
      });
    }).then(function (r) {
      return r.choices[0].message.content.trim();
    });
  }

  window.ecrLocalAi = { ask: ask, supported: supported };
})();
