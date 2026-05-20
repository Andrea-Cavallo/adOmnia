import { useAppStore, type RailItem } from '@/stores/app'
import {
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
  imgSrc: string
  hoverGlow: string
  title: string
  desc: string
}

const TOOL_CARDS: ToolCard[] = [
  {
    id: 'collections',
    imgSrc: '/hubIcons/apiWorkspace.png',
    hoverGlow: '#7C3AED',
    title: 'API Workspace',
    desc: 'Design, test, and automate REST, HTTP, GraphQL APIs.',
  },
  {
    id: 'soap',
    imgSrc: '/hubIcons/soapstudio.png',
    hoverGlow: '#2563EB',
    title: 'SOAP Studio',
    desc: 'Build, test, and explore SOAP, WSDL, XML workflows.',
  },
  {
    id: 'broker',
    imgSrc: '/hubIcons/brokerStudio.png',
    hoverGlow: '#059669',
    title: 'Broker Studio',
    desc: 'Connect, transform, and route with message brokers.',
  },
  {
    id: 'mock',
    imgSrc: '/hubIcons/mockServer.png',
    hoverGlow: '#C2410C',
    title: 'Mock Server',
    desc: 'Simulate APIs and services with powerful mock servers.',
  },
  {
    id: 'proxy',
    imgSrc: '/hubIcons/proxyInterceptor.png',
    hoverGlow: '#A21CAF',
    title: 'Proxy Interceptor',
    desc: 'Intercept, inspect, and modify traffic in real time.',
  },
  {
    id: 'browser',
    imgSrc: '/hubIcons/browserStudio.png',
    hoverGlow: '#0284C7',
    title: 'Browser Debug',
    desc: 'Debug web apps with powerful network and DOM inspection.',
  },
  {
    id: 'database',
    imgSrc: '/hubIcons/databaseStudio.png',
    hoverGlow: '#4338CA',
    title: 'Database Studio',
    desc: 'Explore, query, and manage databases with ease.',
  },
  {
    id: 'plugins',
    imgSrc: '/hubIcons/customizationplugins.png',
    hoverGlow: '#6D28D9',
    title: 'Customization / Plugins',
    desc: 'Extend adOmnia with plugins, and custom integrations.',
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
          {TOOL_CARDS.map(({ id, imgSrc, hoverGlow, title, desc }) => (
            <button
              key={id}
              onClick={() => setActiveRail(id)}
              className="relative rounded-2xl overflow-hidden group transition-all duration-200"
              style={{
                background: 'rgba(11,13,20,0.9)',
                border: '1px solid rgba(255,255,255,0.06)',
                aspectRatio: '1 / 1',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.border = `1px solid ${hoverGlow}50`
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.border = '1px solid rgba(255,255,255,0.06)'
              }}
            >
              {/* Full-card icon */}
              <img
                src={imgSrc}
                alt={title}
                className="absolute inset-0 w-full h-full object-contain p-7 transition-transform duration-300 group-hover:scale-105"
                style={{ mixBlendMode: 'screen' }}
              />

              {/* Hover radial glow */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: `radial-gradient(circle at 50% 42%, ${hoverGlow}28, transparent 68%)` }}
              />

              {/* Bottom gradient overlay */}
              <div
                className="absolute bottom-0 left-0 right-0"
                style={{
                  height: '52%',
                  background: 'linear-gradient(to top, rgba(5,7,13,0.97) 0%, rgba(5,7,13,0.72) 50%, transparent 100%)',
                }}
              />

              {/* Text overlay */}
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 text-center">
                <p className="text-[13px] font-bold text-white leading-snug">{title}</p>
                <p className="text-[10.5px] leading-snug mt-1" style={{ color: 'rgba(255,255,255,0.48)' }}>{desc}</p>
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
