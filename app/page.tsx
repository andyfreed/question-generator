'use client';

import { useState } from 'react';

type Question = {
	question: string;
	options: string[];
	correctIndex: number;
};

export default function Home() {
	const [file, setFile] = useState<File | null>(null);
	const [count, setCount] = useState<number>(10);
	const [model, setModel] = useState<string>('gpt-5-mini');
	const [category, setCategory] = useState<string>('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [questions, setQuestions] = useState<Question[]>([]);

	function toCsv(rows: Question[], cat: string): string {
		const header = ['ID', 'Category', 'Question', 'A', 'B', 'C', 'D', 'Correct'];
		const q = (s: string) => '"' + (s || '').replace(/"/g, '""') + '"';
		const idxToLetter = (i: number) => (['A', 'B', 'C', 'D'][i] || '');
		const lines: string[] = [header.map(q).join(',')];
		for (const row of rows) {
			const [a, b, c, d] = [row.options?.[0] || '', row.options?.[1] || '', row.options?.[2] || '', row.options?.[3] || ''];
			lines.push([
				'',
				cat,
				row.question || '',
				a,
				b,
				c,
				d,
				idxToLetter(row.correctIndex)
			].map(q).join(','));
		}
		return lines.join('\r\n');
	}

	function downloadCsv() {
		if (!questions.length) return;
		const csv = toCsv(questions, category);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `questions${category ? '-' + category.replace(/[^a-z0-9_-]+/gi, '_') : ''}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setQuestions([]);
		if (!file) {
			setError('Please choose a .pdf or .docx file.');
			return;
		}
		const form = new FormData();
		form.append('file', file);
		form.append('count', String(count));
		form.append('model', model);

		setLoading(true);
		try {
			const res = await fetch('/api/generate', { method: 'POST', body: form });
			const data = await res.json();
			if (!res.ok) throw new Error(data?.error || 'Failed to generate');
			setQuestions(data.questions || []);
		} catch (err: any) {
			setError(err?.message || 'Something went wrong');
		} finally {
			setLoading(false);
		}
	}

	return (
		<main style={{ maxWidth: 800, margin: '40px auto', padding: 16 }}>
			<h1>AI Exam Generator</h1>
			<form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
				<input
					type="file"
					accept=".pdf,.docx"
					onChange={(e) => setFile(e.target.files?.[0] || null)}
				/>
				<label>
					Model:&nbsp;
					<select value={model} onChange={(e) => setModel(e.target.value)}>
						<option value="gpt-5-mini">gpt-5-mini</option>
						<option value="gpt-4o-mini">gpt-4o-mini</option>
						<option value="o4-mini">o4-mini</option>
					</select>
				</label>
				<label>
					Category:&nbsp;
					<input
						type="text"
						placeholder="e.g., Biology Unit 1"
						value={category}
						onChange={(e) => setCategory(e.target.value)}
						required
						style={{ width: 260 }}
					/>
				</label>
				<label>
					Number of questions:&nbsp;
					<input
						type="number"
						min={1}
						value={count}
						onChange={(e) => setCount(Number(e.target.value))}
						style={{ width: 100 }}
					/>
				</label>
				<button type="submit" disabled={loading}>
					{loading ? 'Generating…' : 'Generate'}
				</button>
			</form>

			{error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}

			{questions.length > 0 && (
				<section style={{ marginTop: 24 }}>
					<h2>Questions</h2>
					<div style={{ margin: '8px 0 16px' }}>
						<button onClick={downloadCsv}>Download CSV</button>
					</div>
					<ol style={{ paddingLeft: 20 }}>
						{questions.map((q, idx) => (
							<li key={idx} style={{ marginBottom: 16 }}>
								<div style={{ fontWeight: 600 }}>{q.question}</div>
								<ol type="A" style={{ paddingLeft: 20 }}>
									{q.options.map((opt, i) => (
										<li key={i} style={{ margin: '4px 0' }}>
											{opt}
											{' '}
											{q.correctIndex === i && (
												<span style={{ color: 'green' }}>(correct)</span>
											)}
										</li>
									))}
								</ol>
							</li>
						))}
					</ol>
				</section>
			)}
		</main>
	);
}
