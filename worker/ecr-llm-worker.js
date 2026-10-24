const MODEL = '@cf/meta/llama-3.2-3b-instruct';

const ALLOWED_ORIGINS = ['https://rdbecrsolutions.github.io'];

const MAX_QUESTION_CHARS = 500;
const MAX_PASSAGES = 8;
const MAX_PASSAGE_CHARS = 1500;
const MAX_ANSWER_TOKENS = 400;

const SYSTEM_PROMPT =
  'Sei l\'assistente di una guida online. Rispondi in italiano, in modo breve e chiaro. ' +
  'Usa solo i brani forniti dall\'utente. Se i brani non contengono la risposta, dillo chiaramente ' +
  'e suggerisci di consultare la guida o l\'assistenza. Non inventare codici, procedure o valori.';

const NOT_FOUND_ANSWER =
  'Non ho trovato una risposta sicura nei brani della guida. Prova a riformulare la domanda o consulta l\'assistenza.';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'origin_not_allowed' }, 403, {});
    }
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'invalid_json' }, 400, cors);
    }

    const question = String(body.question || '').trim().slice(0, MAX_QUESTION_CHARS);
    if (!question) {
      return json({ error: 'empty_question' }, 400, cors);
    }
    const passages = (Array.isArray(body.passages) ? body.passages : [])
      .slice(0, MAX_PASSAGES)
      .map((p) => {
        if (typeof p === 'string') return p.slice(0, MAX_PASSAGE_CHARS);
        const head = [p && p.title, p && p.heading].filter(Boolean).join(' - ');
        const text = String((p && p.text) || '');
        return ((head ? head + ': ' : '') + text).slice(0, MAX_PASSAGE_CHARS);
      });
    const context = passages.map((p, i) => '[' + (i + 1) + '] ' + p).join('\n\n');

    try {
      const result = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Brani:\n' + context + '\n\nDomanda: ' + question },
        ],
        max_tokens: MAX_ANSWER_TOKENS,
      });
      const answer = String((result && result.response) || '').trim();
      return json({ answer: answer || NOT_FOUND_ANSWER }, 200, cors);
    } catch (e) {
      return json({ error: 'ai_unavailable' }, 503, cors);
    }
  },
};
