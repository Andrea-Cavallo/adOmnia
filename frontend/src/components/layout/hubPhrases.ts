import { loadRotatingCopy, type CopyPair } from '@/lib/rotatingCopy'

export type HubPhrase = CopyPair

/**
 * Rotating copy for the Hub hero. The title is the headline and the subtitle
 * replaces the lede, so the greeting changes on every visit without asking the
 * user to configure anything.
 */
export const HUB_PHRASES: readonly HubPhrase[] = [
  { title: 'A little time to create.', subtitle: 'Pick up where you left off.' },
  { title: 'Your toolbox.', subtitle: 'On your machine.' },
  { title: 'No cloud.', subtitle: 'Just you and your code.' },
  { title: 'Build something small today.', subtitle: 'It gets big tomorrow.' },
  { title: 'Every great tool', subtitle: 'starts as a small script.' },
  { title: 'All local.', subtitle: 'All under control.' },
  { title: 'The right tools.', subtitle: 'In the right place.' },
  { title: 'Your workbench is ready.', subtitle: 'Time to build.' },
  { title: 'Write, test, repeat.', subtitle: 'Same loop. Better every time.' },
  { title: 'Welcome back.', subtitle: 'Your tools kept your seat warm.' },
  { title: 'It worked five minutes ago.', subtitle: 'I swear.' },
  { title: 'Not a bug.', subtitle: 'An undocumented feature.' },
  { title: 'Tried turning it off and on again?', subtitle: 'Classic. Still works.' },
  { title: 'No data sent to the cloud.', subtitle: 'The cloud is disappointed.' },
  { title: 'Compiled on the first try?', subtitle: 'Suspicious.' },
  { title: 'One commit a day', subtitle: 'keeps the panic away.' },
  { title: 'Fewer meetings.', subtitle: 'More code.' },
  { title: 'Is the coffee ready?', subtitle: 'Then let’s go.' },
  { title: 'A well-formatted JSON', subtitle: 'is a small moment of peace.' },
  { title: 'Remember to git push.', subtitle: 'Really, remember.' },
  { title: 'Debugging:', subtitle: 'the art of blaming yesterday’s code.' },
  { title: 'Your future self', subtitle: 'thanks you for these comments.' },
  { title: 'Parse, format, convert.', subtitle: 'That’s it.' },
  { title: 'Base64, JWT, regex.', subtitle: 'One click away.' },
  { title: 'From string to result', subtitle: 'in a flash.' },
  { title: 'Small tools.', subtitle: 'Big time savings.' },
  { title: 'Written in Go.', subtitle: 'Light as a goroutine.' },
  { title: 'Zero tracking.', subtitle: 'Zero stress.' },
  { title: 'The developer’s Swiss Army knife.', subtitle: 'Always within reach.' },
  { title: 'Productivity is a habit, not a tool.', subtitle: 'But it helps.' },
]

/** Remembers the last phrase so the next visit cannot repeat it. */
export const HUB_PHRASE_KEY = 'adomnia.hubPhrase.v1'

export function loadHubPhrase(random: number = Math.random()): HubPhrase {
  return loadRotatingCopy(HUB_PHRASE_KEY, HUB_PHRASES, random)
}
