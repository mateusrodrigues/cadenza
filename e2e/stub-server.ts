import { createServer, type Server } from 'node:http';

/**
 * A tiny OpenAI-compatible server that, like Ollama without OLLAMA_ORIGINS, refuses requests
 * whose Origin is a browser extension. It flags "tomorow" and "teh" in whatever it is sent.
 */
export interface StubServer {
  origins: (string | undefined)[];
  /** Authorization headers received. */
  auth: (string | undefined)[];
  /** The text of each paragraph sent to be checked, in the order the requests arrived. */
  checked: string[];
  close(): Promise<void>;
}

export async function startStubServer(port: number): Promise<StubServer> {
  const origins: (string | undefined)[] = [];
  const auth: (string | undefined)[] = [];
  const checked: string[] = [];
  const server: Server = createServer((req, res) => {
    const origin = req.headers.origin;
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    origins.push(`${req.method} ${req.url} ${origin ?? '-'}`);
    auth.push(req.headers.authorization);
    if (origin?.startsWith('chrome-extension://')) {
      res.writeHead(403, { ...cors, 'content-type': 'text/plain' }).end('origin not allowed');
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      if ((JSON.parse(body || '{}') as { model?: string }).model === 'auth-fail') {
        // Like OpenAI: an auth error that quotes part of the key.
        res.writeHead(401, { ...cors, 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: 'Incorrect API key provided: sk-te****-key.',
              type: 'invalid_request_error',
            },
          }),
        );
        return;
      }
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      if (req.url?.endsWith('/models')) {
        // Sized like llama.cpp reports it, under the small-model limit, so the warning shows.
        const model = { id: 'stub-model', object: 'model', meta: { n_params: 3_212_749_888 } };
        res.end(JSON.stringify({ object: 'list', data: [model] }));
        return;
      }
      const request = JSON.parse(body || '{}') as {
        model?: string;
        messages?: { role: string; content: string }[];
      };

      const user = request.messages?.find((m) => m.role === 'user')?.content ?? '{}';
      const { paragraphs = [] } = JSON.parse(user) as {
        paragraphs?: { pid: string; text: string }[];
      };
      checked.push(...paragraphs.map((p) => p.text));
      const fixes: Record<string, string> = { tomorow: 'tomorrow', teh: 'the' };
      const suggestions = paragraphs.flatMap((p) =>
        Object.entries(fixes)
          .filter(([wrong]) => p.text.includes(wrong))
          .map(([wrong, right]) => ({
            pid: p.pid,
            original: wrong,
            replacement: right,
            category: 'correctness',
            occurrence: 1,
            subtype: 'spelling',
            explanation: null,
          })),
      );
      // "slow-model" answers after 4 s, like a local model on a CPU.
      const delay = request.model === 'slow-model' ? 4000 : 0;
      const reply = () =>
        res.end(
          JSON.stringify({
            id: 'c',
            object: 'chat.completion',
            created: 0,
            model: 'stub-model',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: JSON.stringify({ suggestions }) },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
        );
      setTimeout(reply, delay);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    origins,
    auth,
    checked,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
