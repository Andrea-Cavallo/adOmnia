import { loadRotatingCopy, type CopyPair } from '@/lib/rotatingCopy'

export type ApiPhrase = CopyPair

/** Rotating copy for the empty response panel of the API client. */
export const API_PHRASES: readonly ApiPhrase[] = [
  { title: 'Every request starts a conversation.', subtitle: 'Send yours. The response appears here.' },
  { title: 'Knock, knock.', subtitle: 'Your API answers.' },
  { title: 'Send a request.', subtitle: 'Read the response.' },
  { title: 'Your endpoint is listening.', subtitle: 'Say something.' },
  { title: 'GET what you need.', subtitle: 'POST what you mean.' },
  { title: 'Headers, body, params.', subtitle: 'Everything in one place.' },
  { title: 'Test it here.', subtitle: 'Break it in dev, not in prod.' },
  { title: '200 OK.', subtitle: 'The two best words in tech.' },
  { title: '404: coffee not found.', subtitle: 'Check your URL and try again.' },
  { title: '500 Internal Server Error.', subtitle: 'Not your fault. Probably.' },
  { title: 'Hit send.', subtitle: 'See what comes back.' },
  { title: 'Curl is great.', subtitle: 'This is faster.' },
  { title: 'Ping. Pong.', subtitle: 'Your API is alive.' },
  { title: 'Request in.', subtitle: 'Response out.' },
  { title: 'No Postman needed.', subtitle: 'Your collections stay on your machine.' },
  { title: 'Authenticate.', subtitle: 'Then talk.' },
  { title: 'JSON in. JSON out.', subtitle: 'Pretty printed, of course.' },
  { title: 'Latency is a feeling.', subtitle: 'Here it’s a number.' },
  { title: 'Trust, but verify.', subtitle: 'Check every response.' },
  { title: 'It works on my machine.', subtitle: 'Now prove it with a request.' },
]

export const API_PHRASE_KEY = 'adomnia.apiPhrase.v1' // gitleaks:allow -- localStorage key name, not a credential

export function loadApiPhrase(random: number = Math.random()): ApiPhrase {
  return loadRotatingCopy(API_PHRASE_KEY, API_PHRASES, random)
}
