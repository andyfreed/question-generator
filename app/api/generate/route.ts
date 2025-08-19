import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
// Use dynamic imports inside the handler to avoid build-time evaluation side effects

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
		const pdfParse = (await import('pdf-parse')).default;
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

function chunkText(src: string, maxChars = 8000): string[] {
	const normalized = src.replace(/\s+/g, ' ').trim();
	const chunks: string[] = [];
	for (let i = 0; i < normalized.length; i += maxChars) {
		chunks.push(normalized.slice(i, i + maxChars));
	}
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

		const rawText = await extractTextFromFile(file);
		if (!rawText) return NextResponse.json({ error: 'Empty document' }, { status: 400 });

		const chunks = chunkText(rawText, 8000);
		const perChunk = Math.max(1, Math.ceil(requestedCount / chunks.length));

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

		// Allow selecting among a safe list of models; default to gpt-5-mini
		const allowedModels = new Set([
			'gpt-5-mini',
			'gpt-4o-mini',
			'o4-mini'
		]);
		const model = allowedModels.has(requestedModel) ? requestedModel : 'gpt-5-mini';

		for (const chunk of chunks) {
			const prompt = `
You are an expert exam author. From the course content, generate ${perChunk} multiple-choice questions.
Rules:
- Exactly 4 options and 1 correct answer per question.
- Cover distinct concepts; avoid duplicates.
- Options must be plausible, mutually exclusive, and grounded in the content.
- No external trivia; avoid ambiguous wording.
Return ONLY a strict JSON object that matches this schema with no extra text:
{"questions":[{"question":"string","options":["string","string","string","string"],"correctIndex":0}]}

Course content:
"""${chunk}"""
			`.trim();

			const response = await openai.responses.create({
				model,
				input: prompt,
				temperature: 0.3
			});

			const text = response.output_text || '';
			const parsed = parseJsonFromText(text) ?? { questions: [] };
			if (Array.isArray(parsed?.questions)) allQuestions.push(...parsed.questions);
		}

		const finalQuestions = dedupeAndLimit(allQuestions, requestedCount);
		return NextResponse.json({ questions: finalQuestions });
	} catch (err: any) {
		console.error(err);
		return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
	}
}
