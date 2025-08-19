import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Keep the same runtime/export shape so nothing breaks
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extractTextFromFile(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    // Import internal lib to avoid package index.js debug path that reads a test file
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default as unknown as (buf: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(buf);
    return (parsed.text || '').trim();
  }
  if (name.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return (value || '').trim();
  }
  throw new Error('Unsupported file type. Upload .pdf or .docx');
}

// --- New cleaning step (JS-compatible regex flags) ---
const BANNED_LINE_PATTERNS: RegExp[] = [
  /\b(cpe|ce|credit hours?|credits?)\b/i,
  /\b(course (id|number|code)|provider|nasba|approved by|sponsor)\b/i,
  /\b(table of contents|toc|index)\b/i,
  /\b(about (the )?author|author bio|acknowledg(e)?ments?)\b/i,
  /\b(release date|version|edition|rev(ision)?|last updated)\b/i,
  /\b(contact|support|email|phone|address|ordering|returns?)\b/i,
  /\b(copyright|©|all rights reserved|disclaimer)\b/i,
  /\b(page\s*\d+\s*(of\s*\d+)?)\b/i
];

function stripAdministrativeSections(src: string): string {
  // Drop obvious TOC lines: "Heading ........ 12"
  const noTocBlocks = src.replace(/(^|\n)[^\n]{0,80}\.{2,}\s*\d{1,4}(\n|$)/g, '\n');

  // Remove lines that match admin/meta patterns
  const filtered = noTocBlocks
    .split(/\r?\n/)
    .filter(line => !BANNED_LINE_PATTERNS.some(rx => rx.test(line)))
    .join('\n');

  // Collapse repeated header/footer lines (same short line appearing many times)
  const counts = new Map<string, number>();
  const kept: string[] = [];
  for (const line of filtered.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length <= 80) {
      const k = trimmed.toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
      if ((counts.get(k) || 0) > 10) continue; // drop very frequent header/footer
    }
    kept.push(line);
  }
  return kept.join('\n');
}

// --- Improved chunking (safe for Node) ---
// Prefer breaking at sentence/paragraph boundaries; include small overlap for context
function chunkText(src: string, maxChars = 6000, overlap = 100): string[] {
  const text = src.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  // Split between sentences like ". " followed by capital or "(" OR blank lines
  const parts = text.split(/(?:\.\s+(?=[A-Z(]))|(?:\n{2,})/g);
  const chunks: string[] = [];
  let cur = '';

  for (const p of parts) {
    const piece = p.trim();
    if (!piece) continue;
    if ((cur + ' ' + piece).length <= maxChars) {
      cur = cur ? cur + ' ' + piece : piece;
    } else {
      if (cur) {
        chunks.push(cur);
        const tail = cur.slice(-overlap);
        cur = (tail ? tail + ' ' : '') + piece;
      } else {
        // extremely long single piece—hard split
        for (let i = 0; i < piece.length; i += maxChars) {
          const slice = piece.slice(i, i + maxChars);
          if (chunks.length && overlap > 0) {
            const prevTail = chunks[chunks.length - 1].slice(-overlap);
            chunks.push((prevTail ? prevTail + ' ' : '') + slice);
          } else {
            chunks.push(slice);
          }
        }
        cur = '';
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function dedupeAndLimit(questions: any[], limit: number) {
  const map = new Map<string, any>();
  for (const q of questions) {
    const key = (q?.question || '').trim();
    if (key && !map.has(key)) map.set(key, q);
  }
  const unique = Array.from(map.values());
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, limit);
}

function parseJsonFromText(text: string): any | null {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {}

  // Try to extract from a ```json ... ``` fenced block
  const fencedMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {}
  }

  // Try to find the outermost JSON object by braces
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

// --- New admin question filter ---
const BANNED_TOKENS_IN_STEM = [
  'credit','credits','cpe','ce hours','course number','course id',
  'provider','nasba','approved','sponsor','author','contact','support'
];

function isAdminQuestion(q: any): boolean {
  const hay = ((q?.question || '') + ' ' + (q?.options || []).join(' ')).toLowerCase();
  return BANNED_TOKENS_IN_STEM.some(t => hay.includes(t));
}

// --- Small util for timeouts ---
async function withTimeout<T>(p: Promise<T>, ms: number, label='task'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const requestedCount = Number(form.get('count') || 10);
    const requestedModel = String(form.get('model') || '').trim();

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    if (!requestedCount || requestedCount < 1) {
      return NextResponse.json({ error: 'Invalid count' }, { status: 400 });
    }

    // Hard time budget to avoid Vercel timeout
    const TIME_BUDGET_MS = 50_000;
    const start = Date.now();
    const timeLeft = () => TIME_BUDGET_MS - (Date.now() - start);

    // Extract with a guard so we don't burn all time on parsing
    const rawText = await withTimeout(extractTextFromFile(file), 12_000, 'text extraction');
    if (!rawText) return NextResponse.json({ error: 'Empty document' }, { status: 400 });

    // Clean admin/meta before chunking
    const cleanedText = stripAdministrativeSections(rawText);

    // Cap total text so prompts stay small
    const MAX_TEXT = 300_000;
    const safeText = cleanedText.length > MAX_TEXT ? cleanedText.slice(0, MAX_TEXT) : cleanedText;

    const chunks = chunkText(safeText, 6000, 100);

    // Keep existing chunk limits to avoid runtime changes
    const defaultMaxChunks = process.env.VERCEL ? 1 : 3;
    const maxChunks = Math.max(1, Number(process.env.MAX_CHUNKS || defaultMaxChunks));
    const chunksToProcess = chunks.slice(0, maxChunks);

    // Bound total questions to keep latency low
    const QUESTION_CAP = Math.max(1, Number(process.env.QUESTION_CAP || 10));
    const desiredTotal = Math.min(requestedCount, QUESTION_CAP);
    const perChunk = Math.max(1, Math.ceil(desiredTotal / Math.max(1, chunksToProcess.length)));

    // Schema kept for documentation; output shape unchanged
    const schema = {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              options: {
                type: 'array',
                items: { type: 'string' },
                minItems: 4,
                maxItems: 4
              },
              correctIndex: { type: 'integer', minimum: 0, maximum: 3 }
            },
            required: ['question', 'options', 'correctIndex'],
            additionalProperties: false
          }
        }
      },
      required: ['questions'],
      additionalProperties: false
    };

    const allQuestions: any[] = [];

    // Same allowlist/default model behavior
    const allowedModels = new Set([
      'gpt-5-mini',
      'gpt-4o-mini',
      'o4-mini'
    ]);
    const defaultModel = 'gpt-4o-mini';
    let modelInUse = allowedModels.has(requestedModel) ? requestedModel : defaultModel;
    let fellBack = false;

    const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25_000);

    for (const chunk of chunksToProcess) {
      if (timeLeft() < 8_000) {
        // Not enough time to safely complete another LLM call
        break;
      }

      const prompt = `
You are an expert exam author. From the course **instructional content**, generate ${perChunk} multiple-choice questions.

Scope (what to ask):
- Concepts, definitions, principles, procedures/steps, formulas & calculations, applied scenarios, pitfalls, and comparisons found in the text.
Hard exclusions (never ask about):
- Administrative/metadata: course title/name/number, credit hours/CPE/CE, provider/sponsor/author bios, NASBA or approvals, release/edition/version, page/section numbers, headers/footers/TOC, contact/purchasing/support, file names, copyright/disclaimers.
- Any information not present in the instructional content of this chunk.
If this chunk contains only excluded/administrative material, return: {"questions": []}

Item format:
- Exactly 4 options with 1 correct answer.
- Plausible, mutually exclusive options grounded in the text.
- Avoid ambiguous wording and “all/none of the above.” Vary correct option positions.

Return ONLY this JSON (no extra text):
{"questions":[{"question":"string","options":["string","string","string","string"],"correctIndex":0}]}

Course content:
"""${chunk}"""
      `.trim();

      let response: any;
      try {
        response = await openai.responses.create({ model: modelInUse, input: prompt }, { timeout: OPENAI_TIMEOUT_MS });
      } catch (err: any) {
        const message = String(err?.message || err?.error?.message || '');
        const status = Number((err && (err.status || err.code)) || 0);
        if (!fellBack && status === 403 && /does not have access to model/i.test(message)) {
          // Fallback to a widely available model
          modelInUse = defaultModel;
          fellBack = true;
          response = await openai.responses.create({ model: modelInUse, input: prompt }, { timeout: OPENAI_TIMEOUT_MS });
        } else {
          throw err;
        }
      }

      const text = (response as any).output_text || '';
      const parsed = parseJsonFromText(text) ?? { questions: [] };
      if (Array.isArray(parsed?.questions)) allQuestions.push(...parsed.questions);
    }

    // Filter any residual admin-style questions, then dedupe and cap
    const filtered = allQuestions.filter(q => !isAdminQuestion(q));
    const finalQuestions = dedupeAndLimit(filtered, desiredTotal);
    return NextResponse.json({ modelUsed: modelInUse, questions: finalQuestions });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
