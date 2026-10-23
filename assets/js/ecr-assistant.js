/*
 * Assistente della guida: cerca nei paragrafi di assistant-index.js (generato da build_assistant.py).
 * Il pulsante "Rispondi con AI" compare se localAi è attivo (modello nel browser, ecr-local-ai.js) oppure se
 * llmUrl è valorizzato (endpoint proprio, che custodisce la chiave API lato server: la chiave non va qui).
 */
(function () {
  'use strict';

  if (window.__ecraAssistant) return;
  window.__ecraAssistant = true;

  var CONFIG = Object.assign({ llmUrl: '', localAi: false }, window.ECR_ASSISTANT_CONFIG || {});
  var MAX_RESULTS = 4;
  var STOP = new Set(['il', 'lo', 'la', 'le', 'gli', 'i', 'un', 'una', 'uno', 'di', 'da', 'del', 'della', 'dei', 'delle',
    'degli', 'e', 'o', 'per', 'con', 'che', 'come', 'in', 'a', 'su', 'al', 'alla', 'ai', 'nel', 'nella', 'sono', 'quale',
    'quali', 'quando', 'dove', 'cosa', 'si', 'mi', 'ti', 'ci', 'posso', 'devo', 'non', 'se', 'ho', 'ha', 'sul', 'sulla',
    'anche', 'dal', 'dalla', 'fra', 'tra', 'fare', 'faccio', 'quanti', 'quante', 'quanto', 'quanta', 'quali',
    'impostare', 'impostato', 'imposto', 'usare', 'serve', 'servono']);

  var index = [];
  var ui = {};
  var lastResult = null;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalize(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function words(s) {
    return normalize(s).match(/[a-z0-9]+/g) || [];
  }

  function stemOf(t) {
    return t.length >= 7 ? t.slice(0, -2) : t;
  }

  function termMatches(term, word) {
    if (/\d/.test(term)) return word === term;
    return word.indexOf(stemOf(term)) === 0;
  }

  function countIn(list, term) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (termMatches(term, list[i])) n++;
    }
    return n;
  }

  function prepare(c) {
    c._w = words(c.x);
    c._h = words(c.h);
    c._t = words(c.t);
    return c;
  }

  function queryTerms(q) {
    return words(q).filter(function (t) {
      return /\d/.test(t) || (t.length >= 3 && !STOP.has(t));
    });
  }

  function score(c, terms) {
    var total = 0;
    var matched = 0;
    terms.forEach(function (term) {
      var s = Math.min(countIn(c._w, term), 3)
        + (countIn(c._h, term) > 0 ? 4 : 0)
        + (countIn(c._t, term) > 0 ? 1 : 0);
      if (s > 0) {
        matched++;
        total += s;
      }
    });
    return matched ? total + matched * 2 : 0;
  }

  function search(q) {
    var terms = queryTerms(q);
    if (!terms.length) return { terms: terms, hits: [] };
    var scored = [];
    index.forEach(function (c) {
      var s = score(c, terms);
      if (s > 0) scored.push({ c: c, s: s });
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    var idf = {};
    terms.forEach(function (t) {
      var df = 0;
      index.forEach(function (c) {
        if (countIn(c._w, t) || countIn(c._h, t) || countIn(c._t, t)) df++;
      });
      idf[t] = Math.log(1 + index.length / (1 + df));
    });
    var seen = {};
    var hits = [];
    for (var i = 0; i < scored.length && hits.length < MAX_RESULTS; i++) {
      var c = scored[i].c;
      var key = c.p + '|' + c.h + '|' + c.a;
      if (seen[key]) continue;
      seen[key] = true;
      hits.push(c);
    }
    return { terms: terms, hits: hits, answer: answerOf(hits, terms, idf) };
  }

  function urlOf(c) {
    return (window.ECR_ASSISTANT_ROOT || '') + c.p + (c.a ? '#' + encodeURIComponent(c.a) : '');
  }

  function snippetOf(c, terms) {
    var lower = c.x.toLowerCase();
    var pos = -1;
    terms.forEach(function (t) {
      var i = lower.indexOf(stemOf(t));
      if (i >= 0 && (pos < 0 || i < pos)) pos = i;
    });
    var start = pos > 90 ? pos - 90 : 0;
    var end = Math.min(c.x.length, start + 260);
    return (start > 0 ? '…' : '') + c.x.slice(start, end) + (end < c.x.length ? '…' : '');
  }

  function sentencesOf(text) {
    return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Risposta estratta: le frasi dei passaggi trovati che contengono più termini della domanda.
  // Ogni termine pesa in base alla sua rarità (idf), così i termini generici contano meno.
  function answerOf(hits, terms, idf) {
    var cands = [];
    hits.forEach(function (c, rank) {
      var headHit = terms.some(function (t) { return countIn(c._h, t) > 0; });
      sentencesOf(c.x).forEach(function (s, order) {
        var w = words(s);
        var weight = 0;
        var matched = 0;
        terms.forEach(function (t) {
          if (countIn(w, t) > 0) {
            weight += idf[t];
            matched++;
          }
        });
        if (!matched) return;
        cands.push({
          text: s,
          score: weight + (headHit ? 0.5 : 0) + (rank === 0 ? 0.5 : 0),
          rank: rank,
          order: order,
          c: c
        });
      });
    });
    cands.sort(function (a, b) { return b.score - a.score || a.rank - b.rank || a.order - b.order; });
    var chosen = [];
    for (var i = 0; i < cands.length && chosen.length < 3; i++) {
      var dup = chosen.some(function (x) { return x.text === cands[i].text; });
      if (!dup) chosen.push(cands[i]);
    }
    if (!chosen.length) return null;
    chosen.sort(function (a, b) { return a.rank - b.rank || a.order - b.order; });
    return {
      text: chosen.map(function (x) { return x.text; }).join(' '),
      source: chosen[0].c
    };
  }

  function highlight(text, terms) {
    if (!terms.length) return esc(text);
    var re = new RegExp('(' + terms.map(function (t) { return escRe(stemOf(t)) + '\\p{L}*'; }).join('|') + ')', 'giu');
    var out = '';
    var pos = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      out += esc(text.slice(pos, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      pos = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    return out + esc(text.slice(pos));
  }

  function renderResults(q, res) {
    if (!res.terms.length) {
      ui.results.innerHTML = '<p class="ecra-empty">Scrivi una domanda con almeno una parola significativa.</p>';
      return;
    }
    if (!res.hits.length) {
      ui.results.innerHTML = '<p class="ecra-empty">Nessun risultato per «' + esc(q) + '». Prova con altre parole, '
        + 'per esempio il nome del menu o della funzione.</p>';
      return;
    }
    var answer = res.answer
      ? '<div class="ecra-answer-box"><p class="ecra-answer-text">' + highlight(res.answer.text, res.terms) + '</p>'
        + '<a class="ecra-answer-link" href="' + esc(urlOf(res.answer.source)) + '">Vai alla sezione: '
        + esc(res.answer.source.h || res.answer.source.t) + '</a></div>'
      : '<p class="ecra-empty">Nella guida non trovo una risposta diretta. Controlla le sezioni qui sotto.</p>';
    var sources = '<p class="ecra-sources-title">Sezioni collegate</p>';
    ui.results.innerHTML = answer + sources + res.hits.map(function (c) {
      return '<a class="ecra-hit" href="' + esc(urlOf(c)) + '">'
        + '<span class="ecra-hit-title">' + esc(c.h || c.t) + '</span>'
        + (c.h && c.t ? '<span class="ecra-hit-page">' + esc(c.t) + '</span>' : '')
        + '<span class="ecra-snip">' + highlight(snippetOf(c, res.terms), res.terms) + '</span></a>';
    }).join('');
  }

  function ask() {
    var q = ui.input.value.trim();
    lastResult = search(q);
    lastResult.q = q;
    renderResults(q, lastResult);
    ui.llm.hidden = !(aiEnabled() && lastResult.hits.length);
    ui.answer.textContent = '';
  }

  function aiEnabled() {
    return !!CONFIG.llmUrl || (CONFIG.localAi && !!window.ecrLocalAi);
  }

  function showAi(text, note) {
    ui.answer.textContent = '';
    var p = document.createElement('p');
    p.className = 'ecra-ai-text';
    p.textContent = text;
    ui.answer.appendChild(p);
    if (note) {
      var n = document.createElement('p');
      n.className = 'ecra-ai-note';
      n.textContent = note;
      ui.answer.appendChild(n);
    }
  }

  function passagesOf(res) {
    return res.hits.map(function (c) {
      return { title: c.t, heading: c.h, text: c.x, url: new URL(urlOf(c), location.href).href };
    });
  }

  function askAi() {
    if (!aiEnabled() || !lastResult || !lastResult.hits.length) return;
    if (CONFIG.llmUrl) askRemote(passagesOf(lastResult));
    else askLocal(passagesOf(lastResult));
  }

  function askLocal(passages) {
    var ai = window.ecrLocalAi;
    if (!ai.supported()) {
      showAi('Questo browser non supporta l\'AI nel browser (serve WebGPU). Usa la risposta estratta sopra.');
      return;
    }
    ui.ai.disabled = true;
    showAi('Preparazione…');
    ai.ask(lastResult.q, passages, function (msg) { showAi(msg); }).then(function (text) {
      showAi(text || 'Nessuna risposta disponibile.',
        'Risposta generata nel browser: verificala nelle sezioni indicate sopra.');
    }).catch(function (err) {
      showAi('Risposta AI non disponibile (' + (err && err.message ? err.message : 'errore')
        + '). Usa la risposta estratta sopra.');
    }).finally(function () {
      ui.ai.disabled = false;
    });
  }

  function askRemote(passages) {
    showAi('Elaborazione in corso…');
    fetch(CONFIG.llmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: lastResult.q, passages: passages })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      showAi(d.answer || 'Nessuna risposta disponibile.');
    }).catch(function () {
      showAi('Risposta AI non disponibile. Usa i risultati qui sopra.');
    });
  }

  function setOpen(open) {
    ui.panel.hidden = !open;
    ui.fab.setAttribute('aria-expanded', String(open));
    if (open) ui.input.focus();
  }

  function build() {
    var root = document.createElement('div');
    root.className = 'ecra-root';
    root.innerHTML =
      '<button type="button" class="ecra-fab" aria-expanded="false" aria-controls="ecra-panel">Chiedi alla guida</button>'
      + '<section id="ecra-panel" class="ecra-panel" hidden aria-label="Assistente della guida">'
      + '<header class="ecra-head"><strong>Assistente della guida</strong>'
      + '<button type="button" class="ecra-close" aria-label="Chiudi">&times;</button></header>'
      + '<form class="ecra-form"><input type="search" class="ecra-input" aria-label="Domanda" '
      + 'placeholder="Es.: come si fa un annullo?"><button type="submit" class="ecra-send">Cerca</button></form>'
      + '<div class="ecra-results" aria-live="polite"><p class="ecra-empty">Scrivi una domanda: l\'assistente '
      + 'risponde con le frasi della guida e indica le sezioni da cui le ricava.</p></div>'
      + '<div class="ecra-llm" hidden><button type="button" class="ecra-ai">Risposta completa con AI</button>'
      + '<p class="ecra-ai-hint" hidden>Al primo uso scarica un modello di circa 0,7 GB, poi lo tiene nel browser. '
      + 'Domanda e brani restano sul dispositivo.</p>'
      + '<div class="ecra-answer" aria-live="polite"></div></div>'
      + '<p class="ecra-foot">Risposte ricavate dai testi della guida, in aggiornamento continuo.</p>'
      + '</section>';
    document.body.appendChild(root);

    ui.fab = root.querySelector('.ecra-fab');
    ui.panel = root.querySelector('.ecra-panel');
    ui.input = root.querySelector('.ecra-input');
    ui.results = root.querySelector('.ecra-results');
    ui.llm = root.querySelector('.ecra-llm');
    ui.answer = root.querySelector('.ecra-answer');
    ui.ai = root.querySelector('.ecra-ai');
    ui.hint = root.querySelector('.ecra-ai-hint');

    ui.fab.addEventListener('click', function () { setOpen(ui.panel.hidden); });
    root.querySelector('.ecra-close').addEventListener('click', function () { setOpen(false); });
    root.querySelector('.ecra-form').addEventListener('submit', function (e) {
      e.preventDefault();
      ask();
    });
    root.querySelector('.ecra-ai').addEventListener('click', askAi);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !ui.panel.hidden) setOpen(false);
    });
    ui.llm.hidden = !aiEnabled();
    if (CONFIG.localAi && !CONFIG.llmUrl) {
      ui.ai.textContent = 'Rispondi con AI';
      ui.hint.hidden = false;
    }
  }

  function init() {
    index = (window.ECR_ASSISTANT_INDEX || []).map(prepare);
    if (index.length) build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
