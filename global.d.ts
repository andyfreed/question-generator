declare module 'pdf-parse/lib/pdf-parse.js' {
	const parse: (buffer: Buffer) => Promise<{ text: string }>;
	export default parse;
}

