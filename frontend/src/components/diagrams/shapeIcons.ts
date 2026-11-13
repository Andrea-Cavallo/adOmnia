/**
 * The icons a shape can carry, by name. A fixed list keeps the bundle small (no import of the whole
 * icon set) and keeps saved files portable: an unknown name simply draws no icon.
 */
import {
  Box, Cloud, Cpu, Database, FileText, Globe, Layers, Lock, Monitor, Network, Package, Puzzle, Radio, Repeat, Route,
  Server, Shield, User, Workflow, Zap, type LucideIcon,
} from 'lucide-react'

export const SHAPE_ICONS: Readonly<Record<string, LucideIcon>> = {
  server: Server, globe: Globe, database: Database, zap: Zap, layers: Layers, shield: Shield, network: Network,
  monitor: Monitor, cloud: Cloud, route: Route, workflow: Workflow, repeat: Repeat, puzzle: Puzzle, radio: Radio,
  file: FileText, package: Package, box: Box, cpu: Cpu, user: User, lock: Lock,
}

export const SHAPE_ICON_NAMES = Object.keys(SHAPE_ICONS)
