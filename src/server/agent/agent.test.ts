import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages/messages";
import {
  getAgentConfigStatus,
  getAIProviderMode,
  isAgentConfigured,
  isAIProviderConfigured,
} from "@/server/agent/config";
import {
  ANTHROPIC_AGENT_TOOLS,
  classifyAnthropicError,
  isSmallTalk,
  normalizeHistory,
  runAnthropicProvider,
  toolsForCapabilities,
  type AnthropicMessageCreator,
} from "@/server/agent/providers/anthropic";
import { OPENAI_AGENT_TOOLS } from "@/server/agent/providers/openai";
import { AgentRunError, agentErrorMessage, runAgent } from "@/server/agent/run";
import type { AgentToolContext } from "@/server/agent/tools";
import type { AgentRunParams } from "@/server/agent/types";
import { getWhatsappAgentFallbackReason } from "@/server/whatsapp/automation";
import { ingestWhatsappWebhookEvents } from "@/server/whatsapp/processing";
import type {
  ResolvedWhatsappIntegration,
  WhatsappInboundEvent,
} from "@/server/whatsapp/types";

function message(
  content: Array<Record<string, unknown>>,
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" = "end_turn"
): Message {
  return {
    id: `msg_${Math.random()}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    container: null,
    content,
    stop_reason: stopReason,
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 10 },
  } as unknown as Message;
}

function runParams(organizationId = "org-a"): AgentRunParams {
  return {
    ctx: {
      organizationId,
      conversationId: "conversation-a",
      userId: null,
      flags: { humanTakeover: false },
    },
    instructions: "Respondé usando solo las herramientas disponibles.",
    history: [{ role: "user", content: "Mensaje anterior" }],
    userMessage: "¿Qué productos tienen?",
  };
}

test("provider demo nunca ejecuta runners pagos", async () => {
  let calls = 0;
  await assert.rejects(
    runAgent(runParams(), {
      provider: "demo",
      configured: false,
      openaiRunner: async () => {
        calls += 1;
        return { reply: "no", humanTakeover: false };
      },
      anthropicRunner: async () => {
        calls += 1;
        return { reply: "no", humanTakeover: false };
      },
    }),
    (error: unknown) =>
      error instanceof AgentRunError && error.code === "not_configured"
  );
  assert.equal(calls, 0);
});

test("OpenAI existente conserva su selección y herramientas", async () => {
  let openaiCalls = 0;
  const result = await runAgent(runParams(), {
    provider: "openai",
    configured: true,
    openaiRunner: async () => {
      openaiCalls += 1;
      return { reply: "Respuesta OpenAI", humanTakeover: false };
    },
    anthropicRunner: async () => {
      throw new Error("runner_incorrecto");
    },
  });
  assert.equal(result.reply, "Respuesta OpenAI");
  assert.equal(openaiCalls, 1);
  assert.deepEqual(
    OPENAI_AGENT_TOOLS.map((tool) => tool.name),
    [
      "get_business_information",
      "search_products",
      "search_services",
      "search_faqs",
      "search_knowledge",
      "check_appointment_availability",
      "create_appointment",
      "reschedule_appointment",
      "cancel_appointment",
      "search_store_products",
      "get_store_order_status",
      "request_human_support",
    ]
  );
  assert.deepEqual(
    ANTHROPIC_AGENT_TOOLS.map((tool) => tool.name),
    OPENAI_AGENT_TOOLS.map((tool) => tool.name)
  );
});

test("Anthropic requiere clave y modelo sin caer a OpenAI", async () => {
  const env = {
    AI_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: "",
    OPENAI_API_KEY: "openai-no-debe-usarse",
  };
  assert.equal(getAIProviderMode(env), "anthropic");
  assert.equal(isAIProviderConfigured("anthropic", env), false);
  assert.equal(isAgentConfigured(env), false);
  assert.equal(
    isAgentConfigured({
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "anthropic-test-key",
      ANTHROPIC_MODEL: "claude-haiku-4-5-20251001",
    }),
    true
  );

  let openaiCalls = 0;
  await assert.rejects(
    runAgent(runParams(), {
      provider: "anthropic",
      configured: false,
      openaiRunner: async () => {
        openaiCalls += 1;
        return { reply: "no", humanTakeover: false };
      },
    }),
    (error: unknown) =>
      error instanceof AgentRunError && error.code === "not_configured"
  );
  assert.equal(openaiCalls, 0);
});

test("Anthropic devuelve una respuesta de texto", async () => {
  const result = await runAnthropicProvider(runParams(), {
    model: "claude-haiku-4-5-20251001",
    createMessage: async () =>
      message([{ type: "text", text: "Tenemos opciones disponibles." }]),
  });
  assert.equal(result.reply, "Tenemos opciones disponibles.");
  assert.equal(result.humanTakeover, false);
});

test("Anthropic ejecuta tool_use y envía tool_result inmediatamente", async () => {
  const requests: MessageCreateParamsNonStreaming[] = [];
  const toolCalls: Array<{ organizationId: string; name: string; input: unknown }> = [];
  const responses = [
    message(
      [
        {
          type: "tool_use",
          id: "toolu_products",
          name: "search_products",
          input: { query: "shampoo", category: null },
        },
      ],
      "tool_use"
    ),
    message([{ type: "text", text: "Encontré dos productos." }]),
  ];
  const createMessage: AnthropicMessageCreator = async (request) => {
    requests.push(request);
    return responses.shift() as Message;
  };

  const result = await runAnthropicProvider(runParams(), {
    model: "claude-haiku-4-5-20251001",
    createMessage,
    executeTool: async (ctx, name, input) => {
      toolCalls.push({ organizationId: ctx.organizationId, name, input });
      return JSON.stringify({ resultados: [{ nombre: "Shampoo" }] });
    },
  });

  assert.equal(result.reply, "Encontré dos productos.");
  assert.deepEqual(toolCalls, [
    {
      organizationId: "org-a",
      name: "search_products",
      input: { query: "shampoo", category: null },
    },
  ]);
  const followUp = requests[1]?.messages.slice(-2);
  assert.equal(followUp?.[0]?.role, "assistant");
  assert.equal(followUp?.[1]?.role, "user");
  assert.equal(
    Array.isArray(followUp?.[1]?.content)
      ? followUp[1].content[0]?.type
      : null,
    "tool_result"
  );
});

test("Anthropic soporta múltiples rondas de herramientas", async () => {
  const responses = [
    message(
      [
        {
          type: "tool_use",
          id: "toolu_business",
          name: "get_business_information",
          input: {},
        },
      ],
      "tool_use"
    ),
    message(
      [
        {
          type: "tool_use",
          id: "toolu_faq",
          name: "search_faqs",
          input: { query: "horarios" },
        },
      ],
      "tool_use"
    ),
    message([{ type: "text", text: "Abrimos de lunes a viernes." }]),
  ];
  const called: string[] = [];
  const result = await runAnthropicProvider(runParams(), {
    model: "claude-haiku-4-5-20251001",
    createMessage: async () => responses.shift() as Message,
    executeTool: async (_ctx, name) => {
      called.push(name);
      return JSON.stringify({ ok: true });
    },
  });
  assert.deepEqual(called, ["get_business_information", "search_faqs"]);
  assert.equal(result.reply, "Abrimos de lunes a viernes.");
});

test("request_human_support conserva la derivación humana", async () => {
  const params = runParams();
  const responses = [
    message(
      [
        {
          type: "tool_use",
          id: "toolu_handoff",
          name: "request_human_support",
          input: { reason: "reclamo", summary: "Cliente solicita ayuda" },
        },
      ],
      "tool_use"
    ),
    message([{ type: "text", text: "Una persona continuará la conversación." }]),
  ];
  const result = await runAnthropicProvider(params, {
    model: "claude-haiku-4-5-20251001",
    createMessage: async () => responses.shift() as Message,
    executeTool: async (ctx, name) => {
      assert.equal(name, "request_human_support");
      ctx.flags.humanTakeover = true;
      return JSON.stringify({ ok: true });
    },
  });
  assert.equal(result.humanTakeover, true);
});

test("timeout de Anthropic se convierte en error seguro", async () => {
  const timeout = new Error("mensaje con datos que no debe exponerse");
  timeout.name = "APIConnectionTimeoutError";
  await assert.rejects(
    runAgent(runParams(), {
      provider: "anthropic",
      configured: true,
      anthropicRunner: (params) =>
        runAnthropicProvider(params, {
          model: "claude-haiku-4-5-20251001",
          createMessage: async () => {
            throw timeout;
          },
        }),
    }),
    (error: unknown) =>
      error instanceof AgentRunError && error.code === "provider_error"
  );
});

test("error de Anthropic no activa fallback automático", async () => {
  let openaiCalls = 0;
  await assert.rejects(
    runAgent(runParams(), {
      provider: "anthropic",
      configured: true,
      anthropicRunner: async () => {
        const error = new Error("insufficient_credits");
        error.name = "RateLimitError";
        throw error;
      },
      openaiRunner: async () => {
        openaiCalls += 1;
        return { reply: "fallback prohibido", humanTakeover: false };
      },
    }),
    AgentRunError
  );
  assert.equal(openaiCalls, 0);
});

test("Anthropic mantiene aislamiento por organización", async () => {
  for (const toolName of ["search_products", "search_knowledge"]) {
    const properties = ANTHROPIC_AGENT_TOOLS.find(
      (tool) => tool.name === toolName
    )?.input_schema.properties;
    assert.equal(
      Boolean(
        properties &&
          typeof properties === "object" &&
          "organizationId" in properties
      ),
      false,
      `${toolName} no debe exponer organizationId`
    );
  }

  const responses = [
    message(
      [
        {
          type: "tool_use",
          id: "toolu_scope",
          name: "search_products",
          input: {
            query: "producto",
            category: null,
            organizationId: "org-atacante",
          },
        },
      ],
      "tool_use"
    ),
    message([{ type: "text", text: "Respuesta aislada." }]),
  ];
  let trustedOrganization = "";
  await runAnthropicProvider(runParams("org-confiable"), {
    model: "claude-haiku-4-5-20251001",
    createMessage: async () => responses.shift() as Message,
    executeTool: async (ctx: AgentToolContext) => {
      trustedOrganization = ctx.organizationId;
      return JSON.stringify({ resultados: [] });
    },
  });
  assert.equal(trustedOrganization, "org-confiable");
});

test("respuesta larga cortada por max_tokens se devuelve igual (no se descarta)", async () => {
  // Regresión: antes se exigía stop_reason end_turn/stop_sequence y una
  // respuesta larga (stop_reason=max_tokens) se tiraba como empty_response,
  // dejando al chat sin respuesta.
  const result = await runAnthropicProvider(runParams(), {
    model: "claude-haiku-4-5-20251001",
    createMessage: async () =>
      message(
        [{ type: "text", text: "Respuesta larga truncada pero útil." }],
        "max_tokens"
      ),
  });
  assert.equal(result.reply, "Respuesta larga truncada pero útil.");
});

test("respuesta realmente vacía sigue siendo empty_response", async () => {
  await assert.rejects(
    runAnthropicProvider(runParams(), {
      model: "claude-haiku-4-5-20251001",
      createMessage: async () => message([{ type: "text", text: "   " }], "max_tokens"),
    }),
    (error: unknown) =>
      error instanceof Error && error.message === "empty_response"
  );
});

test("al agotar rondas de herramientas fuerza una respuesta sin tools", async () => {
  const requests: Array<{ tools: unknown }> = [];
  const result = await runAnthropicProvider(runParams(), {
    model: "claude-haiku-4-5-20251001",
    createMessage: async (request) => {
      requests.push({ tools: request.tools });
      // El modelo insiste con herramientas en cada ronda permitida.
      if (Array.isArray(request.tools) && request.tools.length > 0) {
        return message(
          [
            {
              type: "tool_use",
              id: `toolu_${requests.length}`,
              name: "search_products",
              input: { query: "x", category: null },
            },
          ],
          "tool_use"
        );
      }
      return message([{ type: "text", text: "Con lo que tengo, te confirmo esto." }]);
    },
    executeTool: async () => JSON.stringify({ ok: true }),
  });
  assert.equal(result.reply, "Con lo que tengo, te confirmo esto.");
  // Tope duro: 2 rondas con tools + 1 llamada final sin tools.
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[requests.length - 1]?.tools, []);
});

test("normalizeHistory garantiza que el primer mensaje sea del usuario", () => {
  // La API rechaza con 400 cualquier conversación que arranque en assistant.
  assert.deepEqual(
    normalizeHistory([
      { role: "assistant", content: "respuesta del equipo" },
      { role: "user", content: "consulta" },
    ]),
    [{ role: "user", content: "consulta" }]
  );
  // Historial que ya empieza bien queda intacto.
  const ok = [
    { role: "user" as const, content: "a" },
    { role: "assistant" as const, content: "b" },
  ];
  assert.deepEqual(normalizeHistory(ok), ok);
  // Solo mensajes salientes: no hay nada rescatable como contexto.
  assert.deepEqual(
    normalizeHistory([{ role: "assistant", content: "solo salientes" }]),
    []
  );
  assert.deepEqual(normalizeHistory([]), []);
});

test("un historial que empieza en assistant no se manda tal cual a Anthropic", async () => {
  const enviados: Array<{ role: string }[]> = [];
  await runAnthropicProvider(
    {
      ...runParams(),
      // Pasa cuando el equipo respondió desde la bandeja (HUMAN -> assistant)
      // y la ventana de los últimos N arranca en esa respuesta.
      history: [
        { role: "assistant", content: "Te respondo yo del equipo" },
        { role: "user", content: "¿y los precios?" },
        { role: "assistant", content: "Ahí van" },
      ],
    },
    {
      model: "claude-haiku-4-5-20251001",
      createMessage: async (request) => {
        enviados.push(request.messages.map((m) => ({ role: m.role })));
        return message([{ type: "text", text: "ok" }]);
      },
    }
  );
  assert.equal(enviados[0]?.[0]?.role, "user");
  // Se descartó solo el saliente inicial, no el resto del contexto.
  assert.equal(enviados[0]?.length, 3);
});

test("un saludo se responde en una sola llamada y sin herramientas", async () => {
  const requests: Array<{ tools: unknown }> = [];
  const result = await runAnthropicProvider(
    { ...runParams(), userMessage: "Hola!" },
    {
      model: "claude-haiku-4-5-20251001",
      createMessage: async (request) => {
        requests.push({ tools: request.tools });
        return message([{ type: "text", text: "¡Hola! ¿En qué te ayudo?" }]);
      },
      executeTool: async () => {
        throw new Error("no debía usar herramientas para un saludo");
      },
    }
  );
  assert.equal(result.reply, "¡Hola! ¿En qué te ayudo?");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.tools, []);
});

test("isSmallTalk solo acepta el saludo puro, no una consulta real", () => {
  for (const simple of ["hola", "Hola!", "buenas tardes", "Gracias", "  chau  "]) {
    assert.equal(isSmallTalk(simple), true, simple);
  }
  for (const real of [
    "hola, ¿tienen turnos?",
    "gracias, ¿me reservás el martes?",
    "si",
    "dale",
    "¿cuánto sale el corte?",
  ]) {
    assert.equal(isSmallTalk(real), false, real);
  }
});

test("las tools se filtran según lo que la organización tiene activo", () => {
  const sinNada = toolsForCapabilities({ appointments: false, knowledge: false, commerce: false }).map(
    (tool) => tool.name
  );
  assert.equal(sinNada.includes("check_appointment_availability"), false);
  assert.equal(sinNada.includes("create_appointment"), false);
  assert.equal(sinNada.includes("search_knowledge"), false);
  assert.equal(sinNada.includes("search_store_products"), false);
  // Las de negocio siempre quedan disponibles.
  assert.equal(sinNada.includes("search_products"), true);
  assert.equal(sinNada.includes("request_human_support"), true);

  const conTodo = toolsForCapabilities({ appointments: true, knowledge: true, commerce: true }).map(
    (tool) => tool.name
  );
  assert.equal(conTodo.length, ANTHROPIC_AGENT_TOOLS.length);
});

test("sin agenda activa el modelo no recibe las herramientas de turnos", async () => {
  const offered: string[][] = [];
  await runAnthropicProvider(
    { ...runParams(), capabilities: { appointments: false, knowledge: false } },
    {
      model: "claude-haiku-4-5-20251001",
      createMessage: async (request) => {
        offered.push((request.tools ?? []).map((tool) => tool.name));
        return message([{ type: "text", text: "Listo." }]);
      },
    }
  );
  assert.equal(offered[0]?.includes("check_appointment_availability"), false);
  assert.equal(offered[0]?.includes("search_products"), true);
});

test("al agotarse el presupuesto corta con deadline_exceeded antes del timeout", async () => {
  let calls = 0;
  await assert.rejects(
    // Presupuesto chico (umbrales reducidos) para no esperar segundos reales.
    runAnthropicProvider(
      { ...runParams(), deadlineMs: 500 },
      {
        model: "claude-haiku-4-5-20251001",
        budgets: { minCallMs: 100, toolsMinMs: 200 },
        createMessage: async (request) => {
          calls += 1;
          // La primera llamada se come todo el presupuesto y pide otra ronda.
          await new Promise((resolve) => setTimeout(resolve, 600));
          const toolsOffered =
            Array.isArray(request.tools) && request.tools.length > 0;
          if (!toolsOffered) return message([{ type: "text", text: "listo" }]);
          return message(
            [
              {
                type: "tool_use",
                id: "toolu_lento",
                name: "search_products",
                input: { query: "x", category: null },
              },
            ],
            "tool_use"
          );
        },
        executeTool: async () => JSON.stringify({ ok: true }),
      }
    ),
    (error: unknown) =>
      error instanceof Error && error.message === "deadline_exceeded"
  );
  // Cortó al agotarse el presupuesto en vez de encadenar rondas hasta morir.
  assert.ok(calls >= 1 && calls <= 2, `llamadas=${calls}`);
});

test("sin presupuesto suficiente no se llama al proveedor en absoluto", async () => {
  let calls = 0;
  await assert.rejects(
    runAnthropicProvider(
      { ...runParams(), deadlineMs: 50 },
      {
        model: "claude-haiku-4-5-20251001",
        createMessage: async () => {
          calls += 1;
          return message([{ type: "text", text: "no debería llamarse" }]);
        },
      }
    ),
    (error: unknown) =>
      error instanceof Error && error.message === "deadline_exceeded"
  );
  assert.equal(calls, 0);
});

test("cada llamada recibe un timeout acotado al presupuesto restante", async () => {
  const timeouts: Array<number | undefined> = [];
  await runAnthropicProvider(
    { ...runParams(), deadlineMs: 5_000 },
    {
      model: "claude-haiku-4-5-20251001",
      createMessage: async (_request, options) => {
        timeouts.push(options?.timeout);
        return message([{ type: "text", text: "ok" }]);
      },
    }
  );
  assert.equal(timeouts.length, 1);
  assert.ok(timeouts[0] !== undefined && timeouts[0] <= 5_000);
});

test("las herramientas de una misma ronda se ejecutan en paralelo", async () => {
  let running = 0;
  let maxConcurrent = 0;
  const responses = [
    message(
      [
        {
          type: "tool_use",
          id: "toolu_a",
          name: "search_products",
          input: { query: "a", category: null },
        },
        {
          type: "tool_use",
          id: "toolu_b",
          name: "search_services",
          input: { query: "b", category: null },
        },
      ],
      "tool_use"
    ),
    message([{ type: "text", text: "Listo." }]),
  ];
  await runAnthropicProvider(runParams(), {
    model: "claude-haiku-4-5-20251001",
    createMessage: async () => responses.shift() as Message,
    executeTool: async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return JSON.stringify({ ok: true });
    },
  });
  assert.equal(maxConcurrent, 2);
});

test("classifyAnthropicError mapea estados a códigos seguros", () => {
  assert.equal(classifyAnthropicError({ status: 401 }), "auth_error");
  assert.equal(classifyAnthropicError({ status: 403 }), "auth_error");
  assert.equal(classifyAnthropicError({ status: 429 }), "rate_limited");
  assert.equal(classifyAnthropicError({ status: 400 }), "bad_request");
  assert.equal(classifyAnthropicError({ status: 529 }), "overloaded");
  const timeout = new Error("x");
  timeout.name = "APIConnectionTimeoutError";
  assert.equal(classifyAnthropicError(timeout), "timeout");
  const quota = new Error("x");
  quota.name = "InsufficientQuotaError";
  assert.equal(classifyAnthropicError(quota), "insufficient_quota");
  assert.equal(classifyAnthropicError(new Error("otra cosa")), "provider_error");
});

test("un error 401 del SDK llega como provider_error con código auth_error", async () => {
  await assert.rejects(
    runAgent(runParams(), {
      provider: "anthropic",
      configured: true,
      anthropicRunner: (params) =>
        runAnthropicProvider(params, {
          model: "claude-haiku-4-5-20251001",
          createMessage: async () => {
            throw { status: 401, message: "no debe verse" };
          },
        }),
    }),
    (error: unknown) =>
      error instanceof AgentRunError &&
      error.code === "provider_error" &&
      error.providerCode === "auth_error"
  );
});

test("getAgentConfigStatus distingue demo, mal configurado y listo", () => {
  assert.equal(getAgentConfigStatus({ AI_PROVIDER: "demo" }), "demo");
  assert.equal(
    getAgentConfigStatus({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }),
    "misconfigured"
  );
  assert.equal(
    getAgentConfigStatus({
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_MODEL: "claude-haiku-4-5-20251001",
    }),
    "ready"
  );
});

test("los mensajes de error del chat son claros y sin secretos", () => {
  for (const code of [
    "not_configured",
    "auth_error",
    "rate_limited",
    "insufficient_quota",
    "timeout",
    "overloaded",
    "empty_response",
    "provider_error",
  ] as const) {
    const text = agentErrorMessage(code);
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /key|token|status|\bsk-|api[_-]?key/i);
  }
});

test("WhatsApp no crea jobs de IA cuando handling_mode es humano", async () => {
  const integration: ResolvedWhatsappIntegration = {
    id: "integration-a",
    organizationId: "org-a",
    provider: "META_CLOUD",
    wabaId: "waba-a",
    phoneNumberId: "phone-a",
    providerPhoneNumber: null,
    displayPhoneNumber: "+5491100000000",
    encryptedAccessToken: "encrypted",
    status: "CONNECTED",
  };
  const event: WhatsappInboundEvent = {
    kind: "message",
    phoneNumberId: integration.phoneNumberId,
    externalMessageId: "wamid.human",
    from: "5491111111111",
    customerName: "Cliente",
    timestamp: "1700000000",
    messageType: "text",
    content: "Necesito ayuda",
    metadata: { source: "whatsapp" },
  };
  const jobs = await ingestWhatsappWebhookEvents([event], {
    resolveIntegration: async () => integration,
    persistIncoming: async () => ({
      duplicate: false,
      organizationId: integration.organizationId,
      integrationId: integration.id,
      conversationId: "conversation-human",
      messageId: "message-human",
      handlingMode: "HUMAN",
      content: event.content,
    }),
    audit: async () => undefined,
    touchIntegration: async () => undefined,
  });
  assert.equal(jobs.length, 0);
});

test("WhatsApp habilita Anthropic real y bloquea demo sin respuestas falsas", async () => {
  assert.equal(getWhatsappAgentFallbackReason("anthropic", true), null);
  assert.equal(
    getWhatsappAgentFallbackReason("anthropic", false),
    "agent_error"
  );
  assert.equal(getWhatsappAgentFallbackReason("demo", false), "demo");
});
