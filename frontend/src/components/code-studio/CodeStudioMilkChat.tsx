import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useMilkStore } from '@/stores/milk'
import { CodeStudioAgentChat, type ChatAgent } from './CodeStudioAgentChat'
import { MilkLogo } from './CodeStudioMilkDialog'
import { getMilkSessionControls, setMilkSessionControl } from '@/lib/milk-api'

const MILK: ChatAgent = {
  sessionControls: getMilkSessionControls,
  setSessionControl: setMilkSessionControl,
  tool: 'milk',
  name: 'milk',
  store: useMilkStore,
  Logo: MilkLogo,
  suggestions: ['What does this project do?', 'Find possible bugs in the open file', '/agent list'],
  intro: 'A cheap agent answers first; milk hands the hard questions to the deep one. Both work in this folder.',
  setupHint: 'Enable milk in its settings to chat with your agents about this project.',
  setupTitle: (status) => status?.state === 'installing' ? 'Installing milk…'
    : status?.state === 'outdated' ? 'This milk is too old for Code Studio'
      : status?.state === 'not-installed' ? 'milk is not installed yet'
        : 'milk is not running',
  setupAction: (status) => status?.state === 'not-installed' ? 'Install milk' : status?.state === 'outdated' ? 'Update milk' : 'Open milk settings',
}

export function CodeStudioMilkChat(props: { session: GoIDESession; document?: GoIDEEditorDocument | null }) {
  return <CodeStudioAgentChat agent={MILK} {...props} />
}
