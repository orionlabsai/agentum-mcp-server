# @agentum/mcp-server

Servidor MCP (Model Context Protocol) que expõe as APIs reais da AGENTUM
(dados brasileiros: CNPJ, CEP, taxas oficiais, CPF, inteligência
empresarial) como ferramentas que qualquer agente de IA com suporte a MCP
(Claude Desktop, Claude Code, etc.) pode chamar diretamente — pagando por
uso, em USDC real, via protocolo [x402](https://x402.org).

Sem chave de API, sem cadastro, sem assinatura mensal. Cada chamada é um
pagamento on-chain (Base mainnet) na hora.

## Ferramentas disponíveis

| Ferramenta | Preço | Descrição |
|---|---|---|
| `verificar_cnpj` | $0.02 | Situação cadastral, Simples Nacional, endereço |
| `taxas_brasil` | $0.01 | Selic, CDI, dólar comercial (Banco Central) |
| `verificar_cep` | $0.01 | Endereço completo a partir do CEP |
| `validar_cpf` | $0.01 | Confere dígito verificador (não consulta dado pessoal) |
| `business_intelligence` | $0.05 | CNPJ completo + sócios + resumo gerado por IA |

## Pré-requisito: sua própria carteira

Você precisa de uma carteira Ethereum com um pouco de **USDC na rede Base**
(mainnet, `eip155:8453`). O facilitador de pagamento (PayAI) patrocina o
gás — a carteira só precisa de USDC, não precisa de ETH.

**Nunca use uma carteira que também guarda fundos importantes.** Use uma
carteira dedicada, com só o USDC necessário pros testes/uso que você
pretende fazer (poucos centavos por chamada).

## Instalação

```bash
npm install
```

## Configuração

Defina a variável de ambiente `AGENTUM_MCP_WALLET_KEY` com a chave privada
(formato `0x...`, 64 caracteres hex) da sua carteira:

```bash
export AGENTUM_MCP_WALLET_KEY=0xSUACHAVEPRIVADAAQUI
```

### Claude Desktop / Claude Code

Adicione ao `claude_desktop_config.json` (ou equivalente):

```json
{
  "mcpServers": {
    "agentum": {
      "command": "node",
      "args": ["/caminho/completo/pra/mcp-server/index.js"],
      "env": {
        "AGENTUM_MCP_WALLET_KEY": "0xSUACHAVEPRIVADAAQUI"
      }
    }
  }
}
```

## Segurança

Antes de assinar qualquer pagamento, o servidor confere que a cobrança
devolvida pela AGENTUM é **exatamente**: rede Base mainnet, ativo USDC,
destinatário a carteira oficial da AGENTUM, e valor dentro do teto
conhecido daquela rota específica. Qualquer coisa fora disso e a chamada é
abortada sem assinar nada — mesmo que o servidor da AGENTUM esteja
comprometido ou com bug, sua carteira nunca paga a outro destinatário nem
um valor fora do esperado.

Sua chave privada nunca sai da sua máquina/processo local — não é enviada
pra AGENTUM nem pra ninguém, só assina localmente as autorizações de
pagamento x402.

## Rodar standalone (debug)

```bash
node index.js
```

Fica esperando conexão MCP via stdio (é assim que um client MCP conecta).
