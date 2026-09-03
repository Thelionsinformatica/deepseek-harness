# Estado do Sistema (Linha de Base)
Data: 03/09/2026

## Métricas
- **Testes Passando:** (Timeout de 120s atingido. Falhas conhecidas: 2 em `leon-windows-uia.spec.ts`)
- **Erros de Tipagem (Typecheck):** 91 erros (tsc)
- **Violações de Lint (Oxlint):** 1 erro, 5 avisos
- **Vulnerabilidades (pnpm audit):** 8 vulnerabilidades (2 moderate, 6 high)
- **Código Morto/Órfão (Knip):** 1 dica de configuração (`typescript-language-server`)

## O que falhou nos testes
- `leon-windows-uia.spec.ts`:
  - `fills and invokes an allowed test window, captures it, and audits each action`
  - `changes only the exact inspected window when two accessible windows look identical`
- Vazamento de EventListeners detectado no `process.on('exit')` (11 listeners).
- A suíte excede o tempo limite de 120000ms (OOM ou bloqueio assíncrono).