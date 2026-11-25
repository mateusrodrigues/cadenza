import { isLocalURL } from '@cadenza/providers';
import { browser } from 'wxt/browser';
import type { AllowOriginMessage, AllowOriginResponse, WorkerError } from './messages';

/** What went wrong reaching a provider, in words, and a fix Cadenza can apply if there is one. */
export interface Problem {
  message: string;
  fix?: {
    label: string;
    /** Must run from the click that asks for it (it may request a permission). Null on success. */
    run(): Promise<string | null>;
  };
}

export function explainError(error: WorkerError, baseURL: string): Problem {
  const local = isLocalURL(baseURL);
  let origin: string | null = null;
  try {
    origin = new URL(baseURL).origin;
  } catch {}

  const refusedOrigin = local && error.status === 403;
  const unreachable = error.kind === 'network';
  if (origin && (refusedOrigin || unreachable)) {
    const o = origin;
    return {
      message: refusedOrigin
        ? 'The server refused the connection because it doesn’t accept requests from browser extensions.'
        : `Could not reach ${origin}. If the server is running, it may be blocking browser requests.`,
      fix: {
        label: 'Allow connection',
        async run() {
          const granted = await browser.permissions.request({ origins: [`${o}/*`] });
          if (!granted) return 'Cadenza was not allowed to connect.';
          if (local) {
            const message: AllowOriginMessage = { type: 'cadenza/allow-origin', origin: o };
            const res = (await browser.runtime.sendMessage(message)) as AllowOriginResponse;
            if (!res.ok) return res.error.message;
          }
          return null;
        },
      },
    };
  }
  return { message: describe(error) };
}

export function describe(error: WorkerError): string {
  switch (error.kind) {
    case 'auth':
      return 'The API key was rejected.';
    case 'not_found':
      return 'The endpoint or model was not found. Check the URL and model.';
    case 'rate_limited':
      return 'The provider is limiting requests. Try again in a moment.';
    case 'refused':
      return 'The model declined the request.';
    case 'bad_output':
      return `The model’s reply couldn’t be used: ${error.message}`;
    case 'unavailable':
      return 'The provider is having problems. Try again later.';
    default:
      return error.message;
  }
}
