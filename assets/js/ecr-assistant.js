/*
 * Assistente della guida: cerca nei paragrafi di assistant-index.js (generato da build_assistant.py).
 * Il pulsante "Risposta completa con AI" compare solo se llmUrl è valorizzato: è l'endpoint del Worker
 * (assistant/worker), che custodisce la chiave lato server. Senza llmUrl resta la sola ricerca.
 */
(function () {
  'use strict';

  if (window.__ecraAssistant) return;
  window.__ecraAssistant = true;

  var CONFIG = Object.assign({ llmUrl: '', site: '' }, window.ECR_ASSISTANT_CONFIG || {});
  var MAX_RESULTS = 4;
  // Brani inviati al modello AI: più di quelli mostrati, al massimo AI_PER_PAGE per pagina.
  var AI_PASSAGES = 6;
  var AI_PER_PAGE = 2;
  // Il sito in cui si trova l'utente ha precedenza, ma i risultati degli altri siti restano visibili.
  var SITE_BOOST = 1.5;
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

  // Un termine raro (per esempio "reparti") pesa più di uno generico (per esempio "programmazione").
  function score(c, terms, idf) {
    var total = 0;
    var matched = 0;
    terms.forEach(function (term) {
      var s = Math.min(countIn(c._w, term), 3)
        + (countIn(c._h, term) > 0 ? 4 : 0)
        + (countIn(c._t, term) > 0 ? 3 : 0);
      if (s > 0) {
        matched++;
        total += s * idf[term];
      }
    });
    return matched ? total + matched * 2 : 0;
  }

  function search(q) {
    var terms = queryTerms(q);
    if (!terms.length) return { terms: terms, hits: [] };
    var idf = {};
    terms.forEach(function (t) {
      var df = 0;
      index.forEach(function (c) {
        if (countIn(c._w, t) || countIn(c._h, t) || countIn(c._t, t)) df++;
      });
      idf[t] = Math.log(1 + index.length / (1 + df));
    });
    var scored = [];
    index.forEach(function (c) {
      var s = score(c, terms, idf);
      if (s > 0) scored.push({ c: c, s: c.s === CONFIG.site ? s * SITE_BOOST : s });
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    var hits = pick(scored, MAX_RESULTS, Infinity);
    // L'AI riceve i brani migliori di tutte le fonti, con la pagina aperta in testa: le risposte
    // possono così combinare la guida della cassa con quella dei software, separandole per fonte.
    return {
      terms: terms,
      hits: hits,
      aiHits: pick(scored, AI_PASSAGES, AI_PER_PAGE),
      answer: answerOf(hits, terms, idf)
    };
  }

  // Sceglie i primi risultati senza ripetere la stessa sezione e senza superare perPage brani per pagina.
  function pick(scored, limit, perPage) {
    var seen = {};
    var perUrl = {};
    var out = [];
    for (var i = 0; i < scored.length && out.length < limit; i++) {
      var c = scored[i].c;
      var key = c.p + '|' + c.h + '|' + c.a;
      if (seen[key] || (perUrl[c.p] || 0) >= perPage) continue;
      seen[key] = true;
      perUrl[c.p] = (perUrl[c.p] || 0) + 1;
      out.push(c);
    }
    return out;
  }

  function urlOf(c) {
    return c.p + (c.a ? '#' + encodeURIComponent(c.a) : '');
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
      var where = c.h ? [c.s, c.t].filter(Boolean).join(' · ') : (c.s || '');
      return '<a class="ecra-hit" href="' + esc(urlOf(c)) + '">'
        + '<span class="ecra-hit-title">' + esc(c.h || c.t) + '</span>'
        + (where ? '<span class="ecra-hit-page">' + esc(where) + '</span>' : '')
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
    return !!CONFIG.llmUrl;
  }

  function addInline(el, s) {
    s.split(/\*\*([^*]+)\*\*/).forEach(function (part, i) {
      if (!part) return;
      if (i % 2) {
        var b = document.createElement('strong');
        b.textContent = part;
        el.appendChild(b);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  function renderAi(text) {
    var box = document.createElement('div');
    box.className = 'ecra-ai-text';
    var list = null;
    String(text).split('\n').forEach(function (line) {
      var item = line.match(/^\s*[*-]\s+(.*)$/);
      if (item) {
        if (!list) {
          list = document.createElement('ul');
          box.appendChild(list);
        }
        var li = document.createElement('li');
        addInline(li, item[1]);
        list.appendChild(li);
        return;
      }
      list = null;
      if (!line.trim()) return;
      var p = document.createElement('p');
      addInline(p, line.trim());
      box.appendChild(p);
    });
    return box;
  }

  function showAi(text, note) {
    ui.answer.textContent = '';
    ui.answer.appendChild(renderAi(text));
    if (note) {
      var n = document.createElement('p');
      n.className = 'ecra-ai-note';
      n.textContent = note;
      ui.answer.appendChild(n);
    }
  }

  function passagesOf(res) {
    return res.aiHits.map(function (c) {
      return { title: (c.s ? c.s + ' - ' : '') + c.t, heading: c.h, text: c.x, url: new URL(urlOf(c), location.href).href };
    });
  }

  function askAi() {
    if (!aiEnabled()) return;
    if (!lastResult || lastResult.q !== ui.input.value.trim()) ask();
    if (!lastResult.hits.length) {
      showAi('Nessun brano trovato per questa domanda: prova con altre parole.');
      return;
    }
    askRemote(passagesOf(lastResult));
  }

  function askRemote(passages) {
    ui.ai.disabled = true;
    showAi('Elaborazione in corso…');
    fetch(CONFIG.llmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: lastResult.q, passages: passages })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      showAi(d.answer || 'Nessuna risposta disponibile.',
        'Risposta generata con AI: verificala nelle sezioni indicate sopra.');
    }).catch(function () {
      showAi('Risposta AI non disponibile. Usa i risultati qui sopra.');
    }).finally(function () {
      ui.ai.disabled = false;
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
      + '<p class="ecra-ai-hint">La domanda e i brani della guida vengono inviati a un servizio esterno '
      + 'per generare la risposta.</p>'
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
    ui.llm.hidden = true;
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
