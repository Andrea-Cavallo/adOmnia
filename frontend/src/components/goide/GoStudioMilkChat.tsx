import type { GoIDESession } from '@/lib/goide-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { useMilkStore } from '@/stores/milk'
import { GoStudioAgentChat, type ChatAgent } from './GoStudioAgentChat'
import { MilkLogo } from './GoStudioMilkDialog'

const MILK: ChatAgent = {
  tool: 'milk',
  name: 'milk',
  store: useMilkStore,
  Logo: MilkLogo,
  suggestions: ['What does this project do?', 'Find possible bugs in the open file', '/agent list'],
  intro: 'A cheap agent answers first; milk hands the hard questions to the deep one. Both work in this folder.',
  setupHint: 'Enable milk in its settings to chat with your agents about this project.',
  setupTitle: (status) => status?.state === 'installing' ? 'Installing milk…'
    : status?.state === 'outdated' ? 'This milk is too old for gO Studio'
      : status?.state === 'not-installed' ? 'milk is not installed yet'
        : 'milk is not running',
  setupAction: (status) => status?.state === 'not-installed' ? 'Install milk' : status?.state === 'outdated' ? 'Update milk' : 'Open milk settings',
}

export function GoStudioMilkChat(props: { session: GoIDESession; document?: GoIDEEditorDocument | null }) {
  return <GoStudioAgentChat agent={MILK} {...props} />
}
