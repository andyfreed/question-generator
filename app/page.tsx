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
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [questions, setQuestions] = useState<Question[]>([]);

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
