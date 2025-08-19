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

	function randomizeQuestionOptions(q: Question): Question {
		const opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
		while (opts.length < 4) opts.push('');
		const indices = [0, 1, 2, 3];
		for (let i = indices.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[indices[i], indices[j]] = [indices[j], indices[i]];
		}
		const shuffled = indices.map((k) => opts[k]);
		const newCorrectIndex = Math.max(0, indices.indexOf(q.correctIndex));
		return { ...q, options: shuffled, correctIndex: newCorrectIndex };
	}

	function toCsv(rows: Question[], cat: string): string {
		const header = ['ID', 'Title', 'Category', 'Type', 'Post Content', 'Status', 'Menu Order', 'Options', 'Answer'];
		const q = (s: string | number) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
		const lines: string[] = [header.map(q).join(',')];
		rows.forEach((row, idx) => {
			const options = [row.options?.[0] || '', row.options?.[1] || '', row.options?.[2] || '', row.options?.[3] || ''];
			const optionsPipe = options.join('|');
			const answerText = options[row.correctIndex] || '';
			lines.push([
				'',
				row.question || '',
				cat,
				'single-choice',
				row.question || '',
				'publish',
				idx + 1,
				optionsPipe,
				answerText
			].map(q).join(','));
		});
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
			const contentType = res.headers.get('content-type') || '';
			let data: any = null;
			if (contentType.includes('application/json')) {
				data = await res.json();
			} else {
				const text = await res.text();
				try { data = JSON.parse(text); } catch { throw new Error(text || 'Server error'); }
			}
			if (!res.ok) throw new Error(data?.error || 'Failed to generate');
			const normalized: Question[] = Array.isArray(data.questions) ? data.questions : [];
			setQuestions(normalized.map(randomizeQuestionOptions));
		} catch (err: any) {
			setError(err?.message || 'Something went wrong');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="container">
			<div className="card">
				<h1 className="title">AI Exam Generator</h1>
				<p className="subtext">Upload a .pdf or .docx, pick a model, set a category and number of questions, then generate and download a CSV.</p>
				<form onSubmit={handleSubmit} className="formGrid">
					<label className="label fullRow">
						<span>Course file</span>
						<input className="file" type="file" accept=".pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
					</label>
					<label className="label">
						<span>Model</span>
						<select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
							<option value="gpt-5-mini">gpt-5-mini</option>
							<option value="gpt-4o-mini">gpt-4o-mini</option>
							<option value="o4-mini">o4-mini</option>
						</select>
					</label>
					<label className="label">
						<span>Category</span>
						<input className="input" type="text" placeholder="e.g., Biology Unit 1" value={category} onChange={(e) => setCategory(e.target.value)} required />
					</label>
					<label className="label">
						<span>Number of questions</span>
						<input className="input" type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))} />
					</label>
					<div className="actions fullRow">
						<button type="submit" className="btn btnPrimary" disabled={loading}>{loading ? 'Generating…' : 'Generate'}</button>
						<button type="button" className="btn btnGhost" onClick={downloadCsv} disabled={!questions.length}>Download CSV</button>
					</div>
				</form>

				{error && <p className="error">{error}</p>}

				{questions.length > 0 && (
					<ol className="questionList">
						{questions.map((q, idx) => (
							<li key={idx}>
								<div style={{ fontWeight: 600 }}>{q.question}</div>
								<ol type="A" style={{ paddingLeft: 20 }}>
									{q.options.map((opt, i) => (
										<li key={i} style={{ margin: '4px 0' }}>
											{opt} {q.correctIndex === i && (<span className="correct">(correct)</span>)}
										</li>
									))}
								</ol>
							</li>
						))}
					</ol>
				)}
			</div>
		</div>
	);
}
