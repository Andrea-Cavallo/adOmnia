import React from 'react'
import { createRoot } from 'react-dom/client'
import { BugHuntOverlay } from './src/components/bughunt/BugHuntOverlay'
createRoot(document.getElementById('root')!).render(<BugHuntOverlay onClose={() => {}} />)
