## AI Exam Question Generator (Next.js + TypeScript)

Generate multiple‑choice exam questions (4 options, 1 correct) from a `.pdf` or `.docx` course document using OpenAI `gpt-5-mini`.

### Features
- Upload `.pdf` or `.docx`
- Choose number of questions to generate
- Strict output shape: `{ question, options[4], correctIndex }`
- Chunking for long documents

### Stack
- Next.js (App Router) + TypeScript
- OpenAI SDK
- PDF parsing: `pdf-parse`
- DOCX parsing: `mammoth`

### Getting started
1) Install dependencies
```bash
npm install
```

2) Configure the API key (keep it private)
Create `.env.local` in the project root:
```bash
OPENAI_API_KEY=sk-...
```

3) Run locally
```bash
npm run dev
# http://localhost:3000
```

### Usage
1) Open `http://localhost:3000`
2) Upload a `.pdf` or `.docx`
3) Set the number of questions
4) Click Generate

### API
- Route: `POST /api/generate`
- Body: `multipart/form-data` with fields:
  - `file`: the uploaded `.pdf` or `.docx`
  - `count`: number of questions to generate
- Response:
```json
{
  "questions": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctIndex": 0
    }
  ]
}
```

### Changing the model
Default is `gpt-5-mini` in `app/api/generate/route.ts`. Update the `model` field there if needed.

### Deployment
- Vercel or any Node‑compatible host works
- Set `OPENAI_API_KEY` as a protected environment variable in your hosting provider

### Notes
- The route uses dynamic imports for `pdf-parse` and `mammoth` and is marked dynamic to avoid build‑time issues
- The server instructs the model to return strict JSON; a small parser attempts to recover JSON if the model adds extra text

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
