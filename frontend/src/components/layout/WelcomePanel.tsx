import { useAppStore, type RailItem } from '@/stores/app'
import {
  Send, Box, Network, Server, Eye, Bug, Database, Puzzle,
  Radio, Code2, Play, GitBranch, BarChart2, FlaskConical,
  Shield, Zap, Lock, ArrowRight,
} from 'lucide-react'

// ─── Feature pillars ──────────────────────────────────────────────────────────

const PILLARS = [
  { Icon: Shield, color: '#A855F7', title: 'Local-First',      desc: 'Your data stays local'         },
  { Icon: Zap,    color: '#2dd4bf', title: 'High Performance', desc: 'Built for speed & scale'       },
  { Icon: Lock,   color: '#818CF8', title: 'Enterprise Ready', desc: 'Secure, compliant, extensible' },
] as const

// ─── Main tool cards ──────────────────────────────────────────────────────────

type ToolCard = {
  id: RailItem
  Icon: React.ElementType
  from: string
  to: string
  iconColor: string
  title: string
  desc: string
}

const TOOL_CARDS: ToolCard[] = [
  {
    id: 'collections',
    Icon: Send,
    from: '#3B1F6E', to: '#7C3AED', iconColor: '#DDD6FE',
    title: 'API Workspace',
    desc: 'Design, test, and automate REST, HTTP, GraphQL APIs.',
  },
  {
    id: 'soap',
    Icon: Box,
    from: '#1E3A5F', to: '#2563EB', iconColor: '#BAE6FD',
    title: 'SOAP Studio',
    desc: 'Build, test, and explore SOAP, WSDL, XML workflows.',
  },
  {
    id: 'broker',
    Icon: Network,
    from: '#064E3B', to: '#059669', iconColor: '#6EE7B7',
    title: 'Broker Studio',
    desc: 'Connect, transform, and route with message brokers.',
  },
  {
    id: 'mock',
    Icon: Server,
    from: '#431407', to: '#C2410C', iconColor: '#FED7AA',
    title: 'Mock Server',
    desc: 'Simulate APIs and services with powerful mock servers.',
  },
  {
    id: 'proxy',
    Icon: Eye,
    from: '#4A044E', to: '#A21CAF', iconColor: '#F0ABFC',
    title: 'Proxy Interceptor',
    desc: 'Intercept, inspect, and modify HTTP/S traffic in real-time.',
  },
  {
    id: 'browser',
    Icon: Bug,
    from: '#0C4A6E', to: '#0284C7', iconColor: '#7DD3FC',
    title: 'Browser Debug',
    desc: 'Debug web apps with powerful devtools and network insight.',
  },
  {
    id: 'database',
    Icon: Database,
    from: '#1E1B4B', to: '#4338CA', iconColor: '#C7D2FE',
    title: 'Database Studio',
    desc: 'Explore, query, and manage databases with ease.',
  },
  {
    id: 'plugins',
    Icon: Puzzle,
    from: '#2D1A5E', to: '#6D28D9', iconColor: '#EDE9FE',
    title: 'Customization / Plugins',
    desc: 'Extend adOmnia with plugins, themes, and custom tooling.',
  },
]

// ─── Quick links ──────────────────────────────────────────────────────────────

type QuickLink = {
  id: RailItem
  Icon: React.ElementType
  color: string
  label: string
}

const QUICK_LINKS: QuickLink[] = [
  { id: 'websocket', Icon: Radio,        color: '#2dd4bf', label: 'WebSocket'        },
  { id: 'grpc',      Icon: Code2,        color: '#A855F7', label: 'gRPC'             },
  { id: 'runner',    Icon: Play,         color: '#4ade80', label: 'Runner'           },
  { id: 'flows',     Icon: GitBranch,    color: '#fb923c', label: 'Flows'            },
  { id: 'matrix',    Icon: BarChart2,    color: '#22d3ee', label: 'Env Matrix'       },
  { id: 'testdata',  Icon: FlaskConical, color: '#60a5fa', label: 'Test Data Studio' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function WelcomePanel() {
  const setActiveRail = useAppStore((s) => s.setActiveRail)

  return (
    <div className="flex-1 overflow-auto bg-[#05070D] relative select-none">

      {/* ── Background light beam effects ─────────────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">

        {/* Left beam — bright core line */}
        <div style={{
          position: 'absolute',
          bottom: '38%',
          left: '-80px',
          width: '620px',
          height: '1.5px',
          background: 'linear-gradient(90deg, transparent 0%, rgba(130,70,220,0.55) 25%, rgba(190,130,255,0.95) 55%, rgba(130,70,220,0.4) 80%, transparent 100%)',
          transform: 'rotate(-27deg)',
          transformOrigin: 'left center',
          boxShadow: '0 0 18px 5px rgba(110,50,200,0.38), 0 0 55px 14px rgba(90,40,180,0.16)',
          filter: 'blur(0.4px)',
        }} />
        {/* Left beam — wide glow area */}
        <div style={{
          position: 'absolute',
          bottom: '-5%',
          left: '-25%',
          width: '65%',
          height: '600px',
          background: 'linear-gradient(50deg, rgba(55,25,115,0.22) 0%, rgba(75,35,145,0.1) 35%, transparent 65%)',
          filter: 'blur(28px)',
          transformOrigin: 'left bottom',
        }} />

        {/* Right beam — bright core line */}
        <div style={{
          position: 'absolute',
          top: '12%',
          right: '-60px',
          width: '530px',
          height: '1.5px',
          background: 'linear-gradient(270deg, transparent 0%, rgba(130,70,220,0.55) 25%, rgba(190,130,255,0.95) 55%, rgba(130,70,220,0.4) 80%, transparent 100%)',
          transform: 'rotate(-22deg)',
          transformOrigin: 'right center',
          boxShadow: '0 0 18px 5px rgba(110,50,200,0.38), 0 0 55px 14px rgba(90,40,180,0.16)',
          filter: 'blur(0.4px)',
        }} />
        {/* Right beam — wide glow area */}
        <div style={{
          position: 'absolute',
          top: '-5%',
          right: '-25%',
          width: '60%',
          height: '550px',
          background: 'linear-gradient(230deg, rgba(55,25,115,0.22) 0%, rgba(75,35,145,0.1) 35%, transparent 65%)',
          filter: 'blur(28px)',
          transformOrigin: 'right top',
        }} />

        {/* Centre radial glow behind heading */}
        <div style={{
          position: 'absolute',
          top: '-40px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '780px',
          height: '380px',
          background: 'radial-gradient(ellipse at center top, rgba(88,38,175,0.13) 0%, rgba(60,28,120,0.07) 45%, transparent 72%)',
        }} />
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="relative z-10 max-w-[1160px] mx-auto px-10 py-8 flex flex-col gap-6">

        {/* Logo */}
        <div className="flex justify-center">
          <img
            src="/icon.png"
            alt="adOmnia"
            className="w-14 h-14 object-contain"
            style={{ filter: 'drop-shadow(0 0 12px rgba(168,85,247,0.7))' }}
          />
        </div>

        {/* Hero heading */}
        <div className="flex flex-col items-center gap-4 text-center">
          <h1
            className="font-black leading-[1.06] tracking-[-0.025em]"
            style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}
          >
            <span className="text-white">One toolbox. </span>
            <span style={{ color: '#A855F7' }}>Every workflow.</span>
          </h1>
          <p className="text-[14px] text-text-3 leading-relaxed max-w-[440px]">
            Local-first API development, streaming, debugging,<br />
            and enterprise-grade tools—built for how you work.
          </p>
        </div>

        {/* Feature pillars */}
        <div className="flex items-center justify-center gap-10">
          {PILLARS.map(({ Icon, color, title, desc }) => (
            <div key={title} className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background: `${color}18`,
                  border: `1px solid ${color}28`,
                }}
              >
                <Icon size={14} style={{ color }} strokeWidth={2} />
              </div>
              <div>
                <p className="text-[12px] font-semibold leading-snug" style={{ color }}>{title}</p>
                <p className="text-[11px] text-text-4 leading-snug">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 4 × 2 tool card grid */}
        <div className="grid grid-cols-4 gap-3">
          {TOOL_CARDS.map(({ id, Icon, from, to, iconColor, title, desc }) => (
            <button
              key={id}
              onClick={() => setActiveRail(id)}
              className="relative flex flex-col gap-4 p-5 rounded-2xl text-left group overflow-hidden transition-all duration-200"
              style={{
                background: 'rgba(11,13,20,0.9)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(14,17,26,0.95)'
                ;(e.currentTarget as HTMLElement).style.border = '1px solid rgba(255,255,255,0.11)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(11,13,20,0.9)'
                ;(e.currentTarget as HTMLElement).style.border = '1px solid rgba(255,255,255,0.06)'
              }}
            >
              {/* Hover inner glow */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl"
                style={{ background: `radial-gradient(circle at 25% 25%, ${from}20, transparent 55%)` }}
              />

              {/* Icon container */}
              <div
                className="w-[54px] h-[54px] rounded-[14px] flex items-center justify-center flex-shrink-0 relative z-10"
                style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
              >
                <Icon size={22} style={{ color: iconColor }} strokeWidth={1.6} />
              </div>

              <div className="flex-1 relative z-10 pb-4">
                <p className="text-[14px] font-bold text-white mb-2 leading-snug">{title}</p>
                <p className="text-[11.5px] text-text-3 leading-relaxed">{desc}</p>
              </div>

              {/* Arrow */}
              <div className="absolute bottom-4 right-4 opacity-20 group-hover:opacity-60 transition-opacity">
                <ArrowRight size={14} className="text-text-2" />
              </div>
            </button>
          ))}
        </div>

        {/* Quick link pills */}
        <div className="flex items-center gap-2.5 pb-2 flex-wrap">
          {QUICK_LINKS.map(({ id, Icon, color, label }) => (
            <button
              key={id}
              onClick={() => setActiveRail(id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all group whitespace-nowrap"
              style={{
                background: 'rgba(11,13,20,0.9)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(14,17,26,0.95)'
                ;(e.currentTarget as HTMLElement).style.border = '1px solid rgba(255,255,255,0.11)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(11,13,20,0.9)'
                ;(e.currentTarget as HTMLElement).style.border = '1px solid rgba(255,255,255,0.06)'
              }}
            >
              <Icon size={13} style={{ color }} strokeWidth={2} />
              <span className="text-[12.5px] font-medium text-text-2 group-hover:text-white transition-colors">{label}</span>
              <ArrowRight size={11} className="text-text-4 group-hover:text-text-2 transition-colors" />
            </button>
          ))}
        </div>

      </div>
    </div>
  )
}
