/**
 * The presets are data: a wrong shape id or a link to a node that does not exist fails silently at
 * runtime (the shape falls back, the link disappears), so every template is built here once.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { graphFromBlueprint, lanesFromBlueprint } from './blueprint'
import { parseSequence, sequenceGraph } from './sequence'
import { SHAPES, STYLE_PALETTE } from './shapes'
import { DIAGRAM_TEMPLATES, templatesByCategory } from './templates'

const ICONS = resolve(__dirname, '../../../public/diagram-icons')
const shapeIds = new Set(SHAPES.map((shape) => shape.id))
const colors = new Set(STYLE_PALETTE.map((entry) => entry.id))

describe('diagram templates', () => {
  it('have unique ids, labels, descriptions and a category', () => {
    const ids = DIAGRAM_TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const template of DIAGRAM_TEMPLATES) {
      expect(template.label.trim(), template.id).not.toBe('')
      expect(template.description.trim(), template.id).not.toBe('')
      expect(template.category.trim(), template.id).not.toBe('')
      // Exactly one source: a blueprint or sequence text.
      expect(Number(!!template.blueprint) + Number(!!template.sequence), template.id).toBe(1)
    }
  })

  it('group every template exactly once', () => {
    const grouped = templatesByCategory().flatMap((group) => group.templates)
    expect(grouped).toHaveLength(DIAGRAM_TEMPLATES.length)
    expect(new Set(grouped.map((template) => template.id)).size).toBe(DIAGRAM_TEMPLATES.length)
  })

  describe.each(DIAGRAM_TEMPLATES.filter((template) => template.blueprint).map((template) => [template.id, template] as const))('%s', (_id, template) => {
    const blueprint = template.blueprint!

    it('uses shapes and colors that exist', () => {
      for (const node of blueprint.nodes) {
        expect(shapeIds.has(node.shape), `${node.key} → ${node.shape}`).toBe(true)
        if (node.color) expect(colors.has(node.color), `${node.key} → ${node.color}`).toBe(true)
      }
      for (const link of blueprint.links) if (link.color) expect(colors.has(link.color), `${link.from} → ${link.color}`).toBe(true)
    })

    it('uses icons that the library ships', () => {
      for (const node of blueprint.nodes) if (node.icon) expect(existsSync(resolve(ICONS, node.icon)), `${node.key} → ${node.icon}`).toBe(true)
    })

    it('links and parents point at declared nodes', () => {
      const keys = new Set(blueprint.nodes.map((node) => node.key))
      expect(keys.size, 'duplicate node key').toBe(blueprint.nodes.length)
      for (const node of blueprint.nodes) if (node.parent) expect(keys.has(node.parent), `${node.key} → ${node.parent}`).toBe(true)
      for (const link of blueprint.links) {
        expect(keys.has(link.from), `${link.from} → ${link.to}`).toBe(true)
        expect(keys.has(link.to), `${link.from} → ${link.to}`).toBe(true)
      }
    })

    it('keeps every node and link once built', () => {
      const graph = graphFromBlueprint(blueprint, 'orthogonal')
      expect(graph.nodes).toHaveLength(blueprint.nodes.length)
      expect(graph.edges).toHaveLength(blueprint.links.length)
    })

    it('fits every container around its children', () => {
      const graph = graphFromBlueprint(blueprint, 'orthogonal')
      for (const lane of graph.nodes.filter((node) => graph.nodes.some((child) => child.parentId === node.id))) {
        for (const child of graph.nodes.filter((node) => node.parentId === lane.id)) {
          expect(child.position.x + (child.width ?? 0), `${child.data.label} overflows ${lane.data.label}`).toBeLessThanOrEqual(lane.width ?? 0)
          expect(child.position.y + (child.height ?? 0), `${child.data.label} overflows ${lane.data.label}`).toBeLessThanOrEqual(lane.height ?? 0)
        }
      }
    })
  })

  describe.each(DIAGRAM_TEMPLATES.filter((template) => template.layout === 'lanes').map((template) => [template.id, template] as const))('%s (lanes)', (_id, template) => {
    it('places the lanes side by side in the declared order', () => {
      const graph = lanesFromBlueprint(template.blueprint!, 'orthogonal')
      const lanes = graph.nodes.filter((node) => !node.parentId)
      expect(lanes.length).toBeGreaterThan(1)
      for (let index = 1; index < lanes.length; index++) {
        const previous = lanes[index - 1]
        expect(lanes[index].position.x, `${lanes[index].data.label} overlaps ${previous.data.label}`).toBeGreaterThanOrEqual(previous.position.x + (previous.width ?? 0))
        expect(lanes[index].position.y).toBe(0)
      }
    })
  })

  describe.each(DIAGRAM_TEMPLATES.filter((template) => template.sequence).map((template) => [template.id, template] as const))('%s', (_id, template) => {
    const text = template.sequence!

    it('parses into declared participants and messages', () => {
      const spec = parseSequence(text)
      expect(spec.participants.length).toBeGreaterThan(1)
      const messages = spec.steps.filter((step) => step.type === 'message')
      expect(messages.length).toBeGreaterThan(2)
      for (const message of messages) {
        if (message.type !== 'message') continue
        expect(message.label.trim(), `${message.from} → ${message.to}`).not.toBe('')
        expect(spec.participants.some((participant) => participant.key === message.from)).toBe(true)
        expect(spec.participants.some((participant) => participant.key === message.to)).toBe(true)
      }
    })

    it('opens and closes every fragment and band', () => {
      const steps = parseSequence(text).steps
      let depth = 0
      for (const step of steps) {
        if (step.type === 'open' || step.type === 'rect') depth += 1
        if (step.type === 'end') depth -= 1
        expect(depth, 'end without an open block').toBeGreaterThanOrEqual(0)
      }
      expect(depth, 'a fragment or band is never closed').toBe(0)
    })

    it('builds a graph with one lifeline per participant', () => {
      const spec = parseSequence(text)
      const graph = sequenceGraph(spec)
      const lifelines = graph.nodes.filter((node) => node.data.shape === 'seq-lifeline' || node.data.shape === 'seq-actor')
      expect(lifelines).toHaveLength(spec.participants.length)
      expect(graph.edges).toHaveLength(spec.steps.filter((step) => step.type === 'message').length)
    })
  })
})
