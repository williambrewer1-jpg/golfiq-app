// AI coach: ready-made requests built from your stats, sent to the AI you choose –
// copy & paste (no keys, free) or directly with your own API key (kept only on this phone).
let fetchFn = (...a) => fetch(...a);
export const setFetch = (f) => { fetchFn = f; };

export const PROVIDERS = {
  claude: { name: 'Claude', open: 'https://claude.ai/new', model: 'claude-sonnet-5-5', keyHint: 'sk-ant-…  (console.anthropic.com → API keys)' },
  openai: { name: 'ChatGPT', open: 'https://chatgpt.com/', model: 'gpt-5', keyHint: 'sk-…  (platform.openai.com → API keys)' },
  gemini: { name: 'Gemini', open: 'https://gemini.google.com/app', model: 'gemini-2.5-flash', keyHint: 'AIza…  (aistudio.google.com → Get API key)' },
};

// needs: what the request asks you to pick first
export const TEMPLATES = [
  { id: 'leak', title: 'Fix my biggest leak', desc: 'The one change worth most strokes, with feels, drills and how to measure it.', needs: null,
    ask: () => 'Look at where I lose strokes and pick the ONE fix that is worth the most. Explain the likely cause from my numbers, give 2–4 feels and 2–3 drills, and say which of my practice games to use to measure progress, with a target score.' },
  { id: 'week', title: 'Plan my practice week', desc: 'A day-by-day plan from your weaknesses and the time you have.', needs: 'time',
    ask: (p) => `Plan my practice for the next 7 days. I have ${p.sessions || 3} sessions of about ${p.minutes || 60} minutes${p.where ? ` (${p.where})` : ''}. Split the time by where I lose strokes, use my practice games with target scores, and keep it realistic.` },
  { id: 'preround', title: 'Pre-round brief', desc: 'A game plan for a course: targets, clubs off the tee, holes to respect.', needs: 'course',
    ask: (p) => `I'm playing ${p.courseName || 'a course'} soon. Using my history there (below) and my game, give me a simple game plan: a scoring target, which holes to attack and which to treat as bogey holes, tee club per tricky hole, where to miss, and two swing thoughts for the day.` },
  { id: 'postround', title: 'Post-round debrief', desc: 'What cost shots in a round and what to practise next.', needs: 'round',
    ask: (p) => `Debrief my round at ${p.roundLabel || 'the course'} (details below). What cost me the most shots, what was decision-making versus execution, what went well, and the 1–2 things to practise this week.` },
  { id: 'miss', title: 'Drills for my miss', desc: 'Your shot pattern with a club: likely causes and drills.', needs: 'club',
    ask: (p) => `Here is my shot pattern with ${p.clubName || 'one club'} (below). Explain what it suggests about my swing or set-up (I know you can't see me swing – give the most likely causes and how I'd tell them apart), then give feels and drills to tighten it.` },
  { id: 'gapping', title: 'Club gapping review', desc: 'Gaps and overlaps in your bag, and what to change.', needs: null,
    ask: () => 'Review my club distances and wedge matrix. Point out gaps and overlaps, clubs that are unreliable (high spread or mishit rate), and suggest changes to my set-up or which club to practise. Keep it practical for the course.' },
  { id: 'short', title: 'Short game plan', desc: 'Chipping and putting priorities from your stats.', needs: null,
    ask: () => 'Focus only on my short game and putting. From my numbers, what is costing most, which technique or decision changes would help, and which of my practice games should I use with what targets?' },
  { id: 'free', title: 'Ask anything', desc: 'Your own question, with all your stats attached.', needs: 'text', ask: (p) => p.text || 'Have a look at my game and tell me what you think.' },
];

export const NOTE_FORMAT = `{"golfiq_coach_note":1,"date":"YYYY-MM-DD","title":"short title","focus":"e.g. driver / wedges / putting","feedback":"what you saw and why it matters","feels":["feel 1","feel 2"],"drills":[{"name":"drill name","how":"how to do it","reps":"e.g. 3 x 10 balls"}],"assign":[{"game":"one of the game ids listed","target":6,"per_week":3}]}`;
export const SYSTEM = 'You are an experienced, encouraging golf coach working from the golfer\'s own tracked statistics. Be specific and practical, use their numbers, say when the data is thin, and never invent statistics.';

export function buildPrompt({ template, params = {}, briefing, extra = '', games = [], today }) {
  const t = TEMPLATES.find((x) => x.id === template) || TEMPLATES[0];
  return [
    `# Request: ${t.title}`, t.ask(params), params.note ? `\nAlso: ${params.note}` : '', extra ? `\n${extra}` : '', '', briefing, '',
    '## Practice games you can assign (use these ids in "assign")', ...games.map((g) => `- ${g.id}: ${g.name} – ${g.unit || ''}${g.better === 'lower' ? ' (lower is better)' : ''}`), '',
    '## How to reply',
    `Give your advice in plain language first. Then finish with ONE JSON object in a code block, exactly in this shape (date ${today}, 2–4 feels, 1–4 drills, 0–3 assignments using the game ids above with a realistic target score for this week):`,
    '', '```json', NOTE_FORMAT, '```',
  ].filter((x) => x !== null).join('\n');
}

// ---------------------------------------------------------------- direct API calls (your key, your account)
export async function ask({ provider, model, key, prompt, system = SYSTEM, maxTokens = 3000 }) {
  const P = PROVIDERS[provider]; if (!P) throw new Error('Choose an AI first');
  if (!key) throw new Error('No API key saved');
  const m = model || P.model;
  let r, j;
  if (provider === 'claude') {
    r = await fetchFn('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: m, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }) });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Claude: ${j?.error?.message || r.status}`);
    return (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
  }
  if (provider === 'openai') {
    r = await fetchFn('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: m, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }) });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`OpenAI: ${j?.error?.message || r.status}`);
    return j.choices?.[0]?.message?.content || '';
  }
  r = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] }) });
  j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini: ${j?.error?.message || r.status}`);
  return (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
}
// The advice part of a reply (everything before the JSON note), for showing on screen
export const adviceText = (reply) => String(reply || '').replace(/```(?:json)?[\s\S]*?```/g, '').trim();
