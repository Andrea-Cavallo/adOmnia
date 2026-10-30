export default function (pi: any) {
  pi.on('tool_call', async (event: any, ctx: any) => {
    const allowed = await ctx.ui.confirm('adOmnia tool permission', JSON.stringify({ tool: event.toolName, input: event.input }))
    if (!allowed) return { block: true, reason: 'Denied by adOmnia project policy or the user.' }
  })
}
