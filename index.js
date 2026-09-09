#!/usr/bin/env node
/**
 * Servidor MCP da AGENTUM — expõe as 5 rotas reais do Payment Agent
 * (https://agentum.lat) como ferramentas MCP, pra qualquer agente de IA
 * com suporte a Model Context Protocol (Claude Desktop, Claude Code, etc.)
 * chamar e pagar direto em USDC via x402, sem precisar conhecer o
 * protocolo x402 nem escrever código de pagamento.
 *
 * Quem instala este servidor fornece a PRÓPRIA carteira (variável de
 * ambiente AGENTUM_MCP_WALLET_KEY) — nunca a carteira da AGENTUM. Cada
 * chamada de ferramenta é um pagamento real, on-chain, na Base mainnet.
 *
 * Trava de segurança (independente do financial-policy/ do repo principal
 * de propósito — este pacote pode ser publicado sozinho no npm no futuro,
 * sem o resto do monorepo): antes de assinar qualquer pagamento, confere
 * que a exigência de fato assinada é EXATAMENTE rede Base mainnet + USDC +
 * carteira da AGENTUM + preço dentro do teto conhecido da rota.
 *
 * IMPORTANTE (achado real de auditoria, 2026-09-08): a validação precisa
 * rodar em cima do MESMO objeto que o SDK vai assinar, não de uma
 * requisição de pré-voo separada. `wrapFetchWithPayment` faz a PRÓPRIA
 * requisição HTTP e assina com base no 402 que ELA recebe — um pré-voo
 * manual anterior a isso é uma checagem TOCTOU (valida uma resposta, assina
 * outra: duas requisições diferentes podem receber exigências diferentes).
 * Por isso a trava aqui usa só mecanismos nativos do próprio `x402Client`,
 * aplicados no momento exato da assinatura: `register()` só na rede exata
 * (não wildcard) barra qualquer outra rede antes mesmo de existir um
 * requirement selecionável; `setSpendControls({ allowedAssets })` restringe
 * ativo+teto de preço na seleção do requirement; `onBeforePaymentCreation`
 * confere `payTo` no `context.selectedRequirements` — o requirement
 * exatamente já escolhido pra virar assinatura, sem intermediário.
 */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { wrapFetchWithPayment, x402HTTPClient } = require("@x402/fetch");
const { x402Client } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { privateKeyToAccount } = require("viem/accounts");
const { z } = require("zod");

const BASE_URL = "https://agentum.lat";
const BASE_MAINNET = "eip155:8453";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AGENTUM_WALLET = "0x1B3217B3F1110b879b687Cc8A23025D197F36dAB";

const WALLET_KEY_ENV = "AGENTUM_MCP_WALLET_KEY";

// preço máximo aceito por rota (em unidades atômicas de USDC, 6 casas
// decimais, string porque é isso que setSpendControls exige) — sempre um
// pouco acima do preço real declarado no server.js, só como cinto-de-
// segurança contra um servidor comprometido/errado pedindo mais do que
// deveria. Nunca confiar cegamente no valor que o 402 devolve. Rota sem
// entrada aqui é tratada como erro (nunca como "sem teto"), ver makeClient.
const PRICE_CAP_UNITS = {
  "verificar-cnpj": "30000", // preço real $0.02
  "taxas-brasil": "20000", // preço real $0.01
  "verificar-cep": "20000", // preço real $0.01
  "validar-cpf": "20000", // preço real $0.01
  "business-intelligence": "70000", // preço real $0.05
};

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

let _signer;
function readSigner() {
  if (_signer) return _signer;
  const key = process.env[WALLET_KEY_ENV];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `Variável de ambiente ${WALLET_KEY_ENV} ausente ou inválida. ` +
        `Configure com a chave privada (0x... 64 hex) de uma carteira Base com saldo em USDC. ` +
        `Nunca use uma carteira que também guarda outros fundos importantes.`
    );
  }
  _signer = privateKeyToAccount(key);
  return _signer;
}

/**
 * Monta um x402Client novo pra UMA rota específica, com a trava de
 * segurança presa no próprio fluxo de assinatura (ver comentário no topo
 * do arquivo pro porquê de não validar num pré-voo separado). Client novo
 * a cada chamada de propósito: o teto de preço é por rota, e
 * setSpendControls vale pro client inteiro.
 */
function makeClient(routeKey) {
  const cap = PRICE_CAP_UNITS[routeKey];
  if (!cap) {
    throw new Error(`Rota "${routeKey}" sem teto de preço configurado em PRICE_CAP_UNITS — abortando por segurança.`);
  }
  const signer = readSigner();
  const client = new x402Client();
  // só a rede exata (não "eip155:*") -- qualquer requirement de outra rede
  // não encontra scheme registrado e é descartado antes mesmo de chegar
  // nas outras checagens (ver selectPaymentRequirements no SDK).
  client.register(BASE_MAINNET, new ExactEvmScheme(signer));
  // só USDC-Base, com teto atômico da rota -- aplicado na SELEÇÃO do
  // requirement, ou seja, no mesmo objeto que depois vira assinatura.
  client.setSpendControls({
    allowedAssets: [{ network: BASE_MAINNET, asset: USDC_BASE, maxAmountPerPayment: cap }],
  });
  // payTo não é coberto por setSpendControls -- confere aqui, direto no
  // requirement já selecionado (context.selectedRequirements), imediatamente
  // antes da assinatura de verdade acontecer.
  client.onBeforePaymentCreation(async (ctx) => {
    const payTo = String(ctx.selectedRequirements?.payTo || "");
    if (payTo.toLowerCase() !== AGENTUM_WALLET.toLowerCase()) {
      return { abort: true, reason: `payTo inesperado (${payTo}) — só a carteira oficial da AGENTUM é permitida.` };
    }
    return void 0;
  });
  return client;
}

/**
 * Faz uma chamada paga de verdade (x402) numa rota do Payment Agent.
 * routeKey identifica o teto de preço (PRICE_CAP_UNITS); path/requestInit
 * definem a requisição HTTP real.
 */
async function payAndCall(routeKey, path, requestInit) {
  const url = BASE_URL + path;
  const client = makeClient(routeKey);
  const httpClient = new x402HTTPClient(client);
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const response = await fetchWithPayment(url, requestInit);
  const result = await httpClient.processResponse(response);

  if (result.paymentStatus !== "settled") {
    throw new Error(`Pagamento não liquidou (status: ${result.paymentStatus || "desconhecido"}, HTTP ${response.status}). Nenhum resultado confiável.`);
  }
  return result.body;
}

function jsonToolResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "agentum-mcp", version: "1.0.0" });

server.registerTool(
  "verificar_cnpj",
  {
    title: "Verificar CNPJ",
    description:
      "Verifica um CNPJ brasileiro em tempo real (situação cadastral, Simples Nacional, endereço). Pagamento real de $0.02 em USDC (Base mainnet).",
    inputSchema: { cnpj: z.string().describe("CNPJ brasileiro, 14 dígitos, com ou sem pontuação") },
  },
  async ({ cnpj }) => {
    const clean = onlyDigits(cnpj);
    if (clean.length !== 14) throw new Error('CNPJ inválido — precisa ter 14 dígitos numéricos.');
    const data = await payAndCall("verificar-cnpj", `/verificar-cnpj?cnpj=${clean}`, { method: "GET" });
    return jsonToolResult(data);
  }
);

server.registerTool(
  "taxas_brasil",
  {
    title: "Taxas oficiais do Brasil",
    description:
      "Consulta taxas oficiais brasileiras em tempo real (Selic, CDI, dólar comercial). Pagamento real de $0.01 em USDC (Base mainnet).",
    inputSchema: {},
  },
  async () => {
    const data = await payAndCall("taxas-brasil", "/taxas-brasil", { method: "GET" });
    return jsonToolResult(data);
  }
);

server.registerTool(
  "verificar_cep",
  {
    title: "Verificar CEP",
    description:
      "Valida um CEP/endereço brasileiro em tempo real. Pagamento real de $0.01 em USDC (Base mainnet).",
    inputSchema: { cep: z.string().describe("CEP brasileiro, 8 dígitos, com ou sem hífen") },
  },
  async ({ cep }) => {
    const clean = onlyDigits(cep);
    if (clean.length !== 8) throw new Error("CEP inválido — precisa ter 8 dígitos numéricos.");
    const data = await payAndCall("verificar-cep", `/verificar-cep?cep=${clean}`, { method: "GET" });
    return jsonToolResult(data);
  }
);

server.registerTool(
  "validar_cpf",
  {
    title: "Validar CPF",
    description:
      "Confirma se um CPF brasileiro é matematicamente válido (dígito verificador) — não consulta dado pessoal de ninguém. Pagamento real de $0.01 em USDC (Base mainnet).",
    inputSchema: { cpf: z.string().describe("CPF brasileiro, 11 dígitos, com ou sem pontuação") },
  },
  async ({ cpf }) => {
    const clean = onlyDigits(cpf);
    if (clean.length !== 11) throw new Error("CPF inválido — precisa ter 11 dígitos numéricos.");
    const data = await payAndCall("validar-cpf", `/validar-cpf?cpf=${clean}`, { method: "GET" });
    return jsonToolResult(data);
  }
);

server.registerTool(
  "business_intelligence",
  {
    title: "Inteligência empresarial (CNPJ completo)",
    description:
      "Inteligência empresarial brasileira completa: situação cadastral, endereço, atividades, sócios (CPF sempre mascarado pela própria Receita Federal) e resumo gerado por IA a partir só de dados oficiais. Pagamento real de $0.05 em USDC (Base mainnet).",
    inputSchema: { cnpj: z.string().describe("CNPJ brasileiro, 14 dígitos, com ou sem pontuação") },
  },
  async ({ cnpj }) => {
    const clean = onlyDigits(cnpj);
    if (clean.length !== 14) throw new Error("CNPJ inválido — precisa ter 14 dígitos numéricos.");
    const data = await payAndCall("business-intelligence", "/business-intelligence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cnpj: clean }),
    });
    return jsonToolResult(data);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Falha ao iniciar o servidor MCP da AGENTUM:", err.message);
  process.exit(1);
});
