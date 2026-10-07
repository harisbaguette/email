// Synthetic fixtures only. One paid API request per fixture, using your existing key.
import { readFile } from 'node:fs/promises';
import { sortingRequest, sortingDecision } from '../worker/sorting-policy.ts';

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error('Set TYPESAFE_API_KEY before running this evaluation.');
const cases = JSON.parse(await readFile(new URL('../test/sorting-cases.json', import.meta.url), 'utf8'));
let failures = 0, tokens = 0;
for (let offset = 0; offset < cases.length; offset += 4) {
  await Promise.all(cases.slice(offset, offset + 4).map(async item => {
    const start = performance.now();
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sortingRequest(item.subject, item.body)),
    });
    if (!response.ok) throw new Error(`API HTTP ${response.status}`);
    const data = await response.json();
    const decision = sortingDecision(data);
    tokens += data.usage?.input_tokens || 0;
    const pass = decision.category === item.expected;
    if (!pass) failures++;
    console.log(JSON.stringify({ id: item.id, pass, expected: item.expected, ...decision, ms: Math.round(performance.now() - start) }));
  }));
}
console.log(JSON.stringify({ cases: cases.length, failures, inputTokens: tokens }));
process.exitCode = failures ? 1 : 0;
