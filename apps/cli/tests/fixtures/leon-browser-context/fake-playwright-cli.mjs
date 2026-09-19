const args = process.argv.slice(2).filter(argument => !argument.startsWith('-s='))
const command = args.find(argument => !argument.startsWith('-'))

if (command === 'list') {
  const browsers = process.env.BROWSER_CONTEXT_FIXTURE === 'missing'
    ? []
    : [{ name: 'leon', status: 'open', compatible: true, headed: true, persistent: true }]
  process.stdout.write(`${JSON.stringify({ browsers }, null, 2)}\n`)
} else if (command === 'eval') {
  process.stdout.write(`${JSON.stringify({
    url: 'https://example.test/dashboard?view=tasks#active',
    title: process.env.BROWSER_CONTEXT_PROBE_TOKEN === undefined ? 'Painel Leon' : 'credential leaked',
    readyState: 'complete',
  })}\n`)
} else if (command === 'tab-list') {
  process.stdout.write(`${JSON.stringify({
    result: '- 0: (current) [Painel Leon](https://example.test/dashboard?view=tasks#active)\n- 1: [Ajuda](https://example.test/help)',
  }, null, 2)}\n`)
} else if (command === 'snapshot') {
  process.stdout.write(`- heading "Painel" [level=1]\n- button "Nova tarefa" [ref=e2]\n${'x'.repeat(2_000)}\n`)
} else if (command === 'console') {
  process.stdout.write(`${JSON.stringify({ result: 'Total messages: 1 (Errors: 0, Warnings: 1)\n' }, null, 2)}\n`)
} else {
  process.stderr.write(`unsupported fixture command: ${String(command)}\n`)
  process.exitCode = 2
}
