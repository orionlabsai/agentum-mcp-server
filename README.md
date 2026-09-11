# @agentum/mcp-server

Servidor MCP (Model Context Protocol) que expõe as APIs reais da AGENTUM
(dados brasileiros e globais: CNPJ, CEP, taxas oficiais, CPF, inteligência
empresarial, LEI, VAT europeu, câmbio, indicadores econômicos) como
ferramentas que qualquer agente de IA com suporte a MCP (Claude Desktop,
Claude Code, Cursor, etc.) pode chamar diretamente — pagando por uso, em
USDC real, via protocolo [x402](https://x402.org).

Sem chave de API, sem cadastro, sem assinatura mensal. Cada chamada é um
pagamento on-chain (Base mainnet) na hora, direto do pacote publicado no
npm — não precisa clonar este repositório pra usar.

## Quick Start (menos de 5 minutos)

Você precisa de duas coisas: uma carteira Ethereum dedicada com um pouco
de **USDC na rede Base** (mainnet, `eip155:8453` — poucos centavos já
bastam pra testar; o facilitador de pagamento patrocina o gás, só precisa
de USDC mesmo), e um cliente com suporte a MCP. Escolha o seu:

> ⚠️ **Em toda opção abaixo, a chave fica em texto puro** no arquivo de
> config ou no comando. Nunca coloque esse arquivo (nem um comando com a
> chave escrita nele) num repositório git ou num histórico de shell
> compartilhado/sincronizado — uma chave vazada dá acesso direto à sua
> carteira, sem precisar do servidor MCP pra nada.

<details>
<summary><strong>Claude Desktop</strong></summary>

Edite (ou crie) `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentum": {
      "command": "npx",
      "args": ["-y", "@agentum/mcp-server"],
      "env": {
        "AGENTUM_MCP_WALLET_KEY": "0xSUACHAVEPRIVADAAQUI"
      }
    }
  }
}
```

Reinicie o Claude Desktop. Pronto — pergunte algo como "verifica o CNPJ
68964713000109" e o Claude vai chamar a ferramenta sozinho.
</details>

<details>
<summary><strong>Claude Code (CLI)</strong></summary>

Digitar a chave direto no comando grava ela em texto puro no seu
`~/.zsh_history`/`~/.bash_history` (arquivo que muitos setups de dotfiles
sincronizam ou versionam sem perceber). Use `read -s` — ele não ecoa o que
você digita/cola, e o shell grava no histórico o comando **como digitado**
(com `$AGENTUM_MCP_WALLET_KEY` literal), não o valor já substituído:

```bash
read -s -p "Cole sua chave privada (0x...): " AGENTUM_MCP_WALLET_KEY && echo
export AGENTUM_MCP_WALLET_KEY
claude mcp add agentum -e AGENTUM_MCP_WALLET_KEY=$AGENTUM_MCP_WALLET_KEY -- npx -y @agentum/mcp-server
```

(`-e`/`--env` vem antes do `--`; tudo depois do `--` é passado intacto pro
servidor.)
</details>

<details>
<summary><strong>Cursor</strong></summary>

Prefira `~/.cursor/mcp.json` (vale pra todos os projetos e não fica dentro
de um repositório git). Só use a versão no projeto (`.cursor/mcp.json`)
se você **garantir `.cursor/` no `.gitignore` antes do primeiro commit** —
uma vez que a chave entra no histórico do git, remover o arquivo depois
não resolve (fica no histórico; precisaria reescrever com `git filter-repo`
ou equivalente).

```json
{
  "mcpServers": {
    "agentum": {
      "command": "npx",
      "args": ["-y", "@agentum/mcp-server"],
      "env": {
        "AGENTUM_MCP_WALLET_KEY": "0xSUACHAVEPRIVADAAQUI"
      }
    }
  }
}
```
</details>

**Nunca use uma carteira que também guarda fundos importantes** — use uma
dedicada, só com o USDC necessário pro uso que você pretende fazer.

### Exemplo real de ponta a ponta

Prompt pro agente: *"verifica o CNPJ 68964713000109"*

O agente decide sozinho chamar `verificar_cnpj({ cnpj: "68964713000109" })`
— o servidor assina um pagamento real de $0.02 USDC na Base, a AGENTUM
processa e devolve, e o agente recebe de volta (dado real, de produção):

```json
{
  "cnpj": "68.964.713/0001-09",
  "razao_social": "AGENTUM LTDA",
  "situacao": "ATIVA",
  "data_situacao": "03/09/2026",
  "abertura": "03/09/2026",
  "natureza_juridica": "206-2 - Sociedade Empresária Limitada",
  "uf": "SP",
  "municipio": "SERTAOZINHO",
  "atividade_principal": "Desenvolvimento e licenciamento de programas de computador customizáveis",
  "fonte": "receitaws"
}
```

Nenhum código de pagamento escrito por você — o servidor cuida do desafio
x402, da assinatura e da checagem de segurança (ver seção "Segurança"
abaixo) sozinho.

## Ferramentas disponíveis

| Ferramenta | Preço | Descrição |
|---|---|---|
| `verificar_cnpj` | $0.02 | Situação cadastral, Simples Nacional, endereço |
| `taxas_brasil` | $0.01 | Selic, CDI, dólar comercial (Banco Central) |
| `verificar_cep` | $0.01 | Endereço completo a partir do CEP |
| `validar_cpf` | $0.01 | Confere dígito verificador (não consulta dado pessoal) |
| `business_intelligence` | $0.05 | CNPJ completo + sócios + resumo gerado por IA |
| `fx_rates` | $0.01 | Câmbio oficial (Banco Central Europeu), qualquer par de moedas |
| `economic_data` | $0.01 | PIB, inflação, desemprego, população (Banco Mundial), qualquer país |
| `vat_validate` | $0.01 | Validação de VAT europeu em tempo real (VIES, oficial da UE) |
| `company_enrich` | $0.01 | Identificação global de empresa via LEI (GLEIF), qualquer país |
| `company_intelligence_br` | $0.02 | CNPJ + compliance (TCU, CNJ, CEIS, CNEP, CVM) — só fatos, sem score |

`company_intelligence_br` usa uma carteira de destino diferente das outras (sistema AGENTUM Business, processo/domínio separados de propósito) — o servidor já sabe disso e valida cada rota contra a carteira certa dela.

## Rodando a partir do código-fonte (desenvolvimento)

Se você clonou este repositório em vez de usar o pacote publicado (`npx`),
a configuração aponta pro arquivo local em vez de deixar o `npx` resolver:

```bash
npm install
read -s -p "Cole sua chave privada (0x...): " AGENTUM_MCP_WALLET_KEY && echo
export AGENTUM_MCP_WALLET_KEY
```

(`export VAR=0x...` digitado direto fica gravado em texto puro no seu
histórico de shell — `read -s` evita isso, ver aviso no Quick Start acima.)

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
