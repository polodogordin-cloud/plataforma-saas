/**
 * Modelo do onboarding — Etapa 21.
 *
 * Módulo **neutro** (sem React, sem `server-only`, sem Supabase) pelo mesmo
 * motivo de `theme-upload.ts` e `safe-html.ts`: as regras que decidem etapas,
 * segmentos e categorias sugeridas precisam ser testáveis em Node puro, e o
 * wizard inteiro depende delas. Se a regra morasse dentro de um componente, o
 * harness teria de montar React para responder "quanto falta?".
 *
 * ─── Duas listas que não são a mesma coisa ──────────────────────────────────
 *
 * Existem **oito etapas** no wizard e **sete itens** no checklist do dashboard.
 * Parece redundância, mas não é:
 *
 *   • etapa é o que o dono *faz* (escolher tema, gerar QR);
 *   • item é o que a casa *tem* (logo, mesas, WhatsApp).
 *
 * "Aparência" e "QR Code" são ações que produzem, respectivamente, tema e QR —
 * mas o checklist conta o dado resultante, não a visita à tela. Um dono que
 * pulou a etapa de aparência tem cardápio funcional com o tema padrão: o
 * checklist não pode marcá-lo como incompleto só porque ele pulou um passo.
 *
 * ─── Percentual ─────────────────────────────────────────────────────────────
 *
 * O progresso mostrado no dashboard é o **checklist**, não o wizard. É o número
 * que significa algo ("85% do essencial está feito") em vez de "passei por 6 de
 * 8 telas". Quando o wizard é concluído com itens faltando, o percentual não
 * vira 100% mentiroso — ele continua marcando o que falta.
 */

/* ========================================================================== */
/* 1. Segmentos                                                               */
/* ========================================================================== */

export type RestaurantSegment =
  | "restaurante"
  | "lanchonete"
  | "pizzaria"
  | "hamburgueria"
  | "bar"
  | "cafeteria"
  | "sorveteria"
  | "padaria"
  | "acai"
  | "delivery"
  | "outro";

export type SegmentOption = {
  id: RestaurantSegment;
  /** Rótulo curto para o card de escolha. */
  label: string;
  /** Emoji como ícone: custa 0 KB no bundle, funciona offline e não depende de CDN. */
  emoji: string;
  /** Uma linha explicando quando escolher — evita o dono de pizzaria escolher "restaurante". */
  hint: string;
};

/**
 * Ordem de exibição: as mais comuns primeiro.
 *
 * A ordem importa em celular. "Restaurante" é o termo genérico e serve de
 * padrão mental; em seguida vêm os três tipos que mais abrem conta no Brasil
 * (lanchonete/hamburgueria/pizzaria) e depois os especializados. "Outro" fica
 * por último, como saída — nunca como primeira opção.
 */
export const SEGMENTS: SegmentOption[] = [
  { id: "restaurante", label: "Restaurante", emoji: "🍽️", hint: "Almoço, jantar, comida a la carte" },
  { id: "lanchonete", label: "Lanchonete", emoji: "🥪", hint: "Salgados, sanduíches, refeições rápidas" },
  { id: "hamburgueria", label: "Hamburgueria", emoji: "🍔", hint: "Hambúrguer artesanal ou lanche" },
  { id: "pizzaria", label: "Pizzaria", emoji: "🍕", hint: "Pizza por sabor, tamanho ou rodízio" },
  { id: "bar", label: "Bar", emoji: "🍺", hint: "Petiscos, drinks e porções" },
  { id: "cafeteria", label: "Cafeteria", emoji: "☕", hint: "Cafés, doces e salgados" },
  { id: "sorveteria", label: "Sorveteria", emoji: "🍦", hint: "Sorvetes, açaí e sobremesas geladas" },
  { id: "padaria", label: "Padaria", emoji: "🥐", hint: "Pães, confeitaria e café da manhã" },
  { id: "acai", label: "Açaí", emoji: "🍧", hint: "Açaí, complementos e tigelas" },
  { id: "delivery", label: "Delivery", emoji: "🛵", hint: "Só entrega, sem salão" },
  { id: "outro", label: "Outro", emoji: "✨", hint: "Não se encaixa acima" },
];

export const SEGMENT_IDS = SEGMENTS.map((segment) => segment.id);

/** Rótulo para exibição; devolve `null` quando não escolhido. */
export function segmentLabel(segment: RestaurantSegment | null | undefined): string | null {
  if (!segment) return null;
  return SEGMENTS.find((option) => option.id === segment)?.label ?? null;
}

/** Normaliza texto vindo de formulário/URL. Devolve `null` para valor inválido. */
export function parseSegment(value: unknown): RestaurantSegment | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  // "Açaí" digitado à mão chega como "acai" ou "açaí": o `id` é a forma sem acento.
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  return SEGMENT_IDS.includes(normalized as RestaurantSegment)
    ? (normalized as RestaurantSegment)
    : null;
}

/* ========================================================================== */
/* 2. Modelos sugeridos por segmento                                          */
/* ========================================================================== */

/**
 * Categorias sugeridas por segmento.
 *
 * ─── Por que só categorias, e nunca produtos ────────────────────────────────
 *
 * O escopo é explícito: "Não inserir produtos fictícios como se fossem
 * produtos reais". Um produto de exemplo com preço (`X-Burger — R$ 24,90`)
 * aparece no cardápio público e o cliente tenta pedir. Categoria vazia não
 * engana ninguém: ela organiza o cadastro e desaparece da vitrine enquanto não
 * tiver produto.
 *
 * ─── Por que 5 a 6 nomes, e não 15 ──────────────────────────────────────────
 *
 * Lista longa vira decisão. O dono que confirma 15 categorias vai passar a
 * próxima hora renomeando e apagando. Cinco é o suficiente para o cardápio ter
 * forma e curto o bastante para caber numa tela de celular sem rolagem.
 *
 * `outro` não tem modelo: sugerir "Pratos" e "Bebidas" para quem escolheu
 * "outro" é chute. A tela oferece começar do zero — que é a resposta honesta.
 */
export const SEGMENT_CATEGORIES: Record<RestaurantSegment, string[]> = {
  restaurante: ["Entradas", "Pratos principais", "Acompanhamentos", "Bebidas", "Sobremesas"],
  lanchonete: ["Lanches", "Salgados", "Porções", "Bebidas", "Sobremesas"],
  hamburgueria: ["Hambúrgueres", "Combos", "Porções", "Bebidas", "Sobremesas"],
  pizzaria: ["Pizzas salgadas", "Pizzas doces", "Bordas", "Bebidas"],
  bar: ["Petiscos", "Porções", "Drinks", "Cervejas", "Sem álcool"],
  cafeteria: ["Cafés", "Bebidas geladas", "Doces", "Salgados", "Pães"],
  sorveteria: ["Sorvetes", "Açaí", "Milkshakes", "Complementos", "Sobremesas"],
  padaria: ["Pães", "Confeitaria", "Salgados", "Café da manhã", "Bebidas"],
  acai: ["Açaí", "Complementos", "Tigelas", "Bebidas", "Sobremesas"],
  delivery: ["Pratos", "Combos", "Acompanhamentos", "Bebidas", "Sobremesas"],
  outro: [],
};

/** Categorias sugeridas para um segmento. Vazio quando não há modelo. */
export function suggestedCategories(segment: RestaurantSegment | null | undefined): string[] {
  if (!segment) return [];
  return [...(SEGMENT_CATEGORIES[segment] ?? [])];
}

/**
 * Tema sugerido por segmento.
 *
 * Só sugere — nunca aplica sozinho. `custom_theme` é recurso de plano pago
 * (Etapa 11) e aplicar sem pedir seria cobrar por uma escolha que o dono não
 * fez. A etapa de aparência mostra a sugestão como pré-seleção visual.
 */
export const SEGMENT_THEME: Record<RestaurantSegment, string> = {
  restaurante: "elegante",
  lanchonete: "fastfood",
  hamburgueria: "fastfood",
  pizzaria: "moderno",
  bar: "dark",
  cafeteria: "elegante",
  sorveteria: "moderno",
  padaria: "minimalista",
  acai: "moderno",
  delivery: "fastfood",
  outro: "moderno",
};

/* ========================================================================== */
/* 3. As oito etapas do wizard                                               */
/* ========================================================================== */

export type OnboardingStepId =
  | "informacoes"
  | "aparencia"
  | "segmento"
  | "categorias"
  | "produtos"
  | "mesas"
  | "qrcode"
  | "whatsapp";

export type OnboardingStep = {
  id: OnboardingStepId;
  /** Rótulo curto do cabeçalho: "1/8 Informações". */
  label: string;
  title: string;
  description: string;
  /**
   * `true` quando a etapa pode ser pulada sem culpa. Informações é obrigatória:
   * sem nome e link não existe cardápio. O resto é opcional por natureza.
   */
  skippable: boolean;
  /** Rota da tela de edição correspondente, quando existe. */
  managementHref: string;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "informacoes",
    label: "Informações",
    title: "Como seu restaurante aparece",
    description: "Nome, logo e uma frase que o cliente lê no cardápio.",
    skippable: false,
    managementHref: "/app/configuracoes/restaurante",
  },
  {
    id: "aparencia",
    label: "Aparência",
    title: "A cara do seu cardápio",
    description: "Escolha um tema pronto. Você pode ajustar as cores depois.",
    skippable: true,
    managementHref: "/app/configuracoes/personalizacao",
  },
  {
    id: "segmento",
    label: "Segmento",
    title: "Que tipo de casa é a sua?",
    description: "Usamos isso para sugerir categorias e tema.",
    skippable: true,
    managementHref: "/app/configuracoes/restaurante",
  },
  {
    id: "categorias",
    label: "Categorias",
    title: "Organize o cardápio",
    description: "As seções que o cliente vê: entradas, pratos, bebidas.",
    skippable: true,
    managementHref: "/app/cardapio",
  },
  {
    id: "produtos",
    label: "Produtos",
    title: "Seus primeiros itens",
    description: "Nome e preço já bastam. Foto e descrição podem vir depois.",
    skippable: true,
    managementHref: "/app/cardapio/produtos",
  },
  {
    id: "mesas",
    label: "Mesas",
    title: "As mesas do salão",
    description: "Cada mesa ganha um QR Code próprio.",
    skippable: true,
    managementHref: "/app/mesas",
  },
  {
    id: "qrcode",
    label: "QR Code",
    title: "Imprima e cole na mesa",
    description: "Baixe, imprima ou mostre a tela para o cliente escanear.",
    skippable: true,
    managementHref: "/app/mesas",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    title: "Receba pedidos no WhatsApp",
    description: "Opcional. O botão aparece no cardápio quando você ativa.",
    skippable: true,
    managementHref: "/app/configuracoes/whatsapp",
  },
];

export const STEP_IDS = ONBOARDING_STEPS.map((step) => step.id);
export const TOTAL_STEPS = ONBOARDING_STEPS.length;

export function stepIndex(id: OnboardingStepId): number {
  return ONBOARDING_STEPS.findIndex((step) => step.id === id);
}

export function getStep(id: string | null | undefined): OnboardingStep | null {
  if (!id) return null;
  return ONBOARDING_STEPS.find((step) => step.id === id) ?? null;
}

/** Próxima etapa, ou `null` quando é a última. */
export function nextStep(id: OnboardingStepId): OnboardingStep | null {
  const index = stepIndex(id);
  return index < 0 || index + 1 >= TOTAL_STEPS ? null : ONBOARDING_STEPS[index + 1]!;
}

/** Etapa anterior, ou `null` na primeira. */
export function previousStep(id: OnboardingStepId): OnboardingStep | null {
  const index = stepIndex(id);
  return index <= 0 ? null : ONBOARDING_STEPS[index - 1]!;
}

/* ========================================================================== */
/* 4. Progresso do wizard                                                    */
/* ========================================================================== */

export type StepState = "pending" | "done" | "skipped";

export type ProgressSteps = Partial<Record<OnboardingStepId, StepState>>;

/**
 * Lê o `jsonb` do banco e devolve um mapa seguro.
 *
 * O banco já valida o vocabulário (migration 0022), mas o valor pode ter vindo
 * de uma migration antiga ou de um `update` manual. Chave desconhecida e valor
 * inválido são **descartados** aqui: a tela calcula progresso, então dado
 * estranho não pode virar exceção no Server Component.
 */
export function readProgress(raw: unknown): ProgressSteps {
  const steps = (raw as { steps?: unknown } | null | undefined)?.steps;
  if (!steps || typeof steps !== "object") return {};

  const result: ProgressSteps = {};
  for (const [key, value] of Object.entries(steps as Record<string, unknown>)) {
    if (!STEP_IDS.includes(key as OnboardingStepId)) continue;
    if (value !== "done" && value !== "skipped" && value !== "pending") continue;
    result[key as OnboardingStepId] = value;
  }
  return result;
}

export type WizardProgress = {
  /** Etapas concluídas (inclui puladas: ambas não voltam a aparecer). */
  finished: number;
  total: number;
  /** 0–100, arredondado. */
  percent: number;
  /** Primeira etapa ainda não resolvida — é onde o wizard retoma. */
  resumeAt: OnboardingStepId;
  /** Primeira etapa não resolvida entre as **não puláveis**; null se todas. */
  requiredMissing: OnboardingStepId | null;
};

/**
 * Calcula o progresso do wizard.
 *
 * `resumeAt` é o coração do "sair no meio e voltar de onde parou": o banco
 * guarda o mapa, esta função devolve a primeira etapa pendente — não a última
 * visitada. A diferença aparece quando o dono volta para uma etapa anterior
 * para corrigir algo: ele retoma na primeira lacuna, não no lugar onde parou
 * olhando.
 */
export function wizardProgress(steps: ProgressSteps): WizardProgress {
  const finished = STEP_IDS.filter((id) => {
    const state = steps[id];
    return state === "done" || state === "skipped";
  }).length;

  const firstPending = ONBOARDING_STEPS.find((step) => {
    const state = steps[step.id];
    return state !== "done" && state !== "skipped";
  });

  const firstRequiredMissing = ONBOARDING_STEPS.find((step) => {
    if (step.skippable) return false;
    const state = steps[step.id];
    return state !== "done";
  });

  return {
    finished,
    total: TOTAL_STEPS,
    percent: Math.round((finished / TOTAL_STEPS) * 100),
    resumeAt: (firstPending?.id ?? ONBOARDING_STEPS[TOTAL_STEPS - 1]!.id) as OnboardingStepId,
    requiredMissing: (firstRequiredMissing?.id ?? null) as OnboardingStepId | null,
  };
}

/**
 * O wizard pode ser finalizado?
 *
 * Só exige as etapas **não puláveis**. Sem isso, o dono que pula tudo chega ao
 * "Seu cardápio está pronto" com um cardápio sem nome — e a tela final vira
 * mentira. As etapas puláveis não bloqueiam: cardápio sem WhatsApp é um
 * cardápio perfeitamente válido.
 */
export function canFinish(steps: ProgressSteps): boolean {
  return wizardProgress(steps).requiredMissing === null;
}

/** Resumo do cabeçalho: `"3/8 · Categorias"`. */
export function stepHeading(id: OnboardingStepId): string {
  const index = stepIndex(id);
  const step = ONBOARDING_STEPS[index];
  if (!step) return "";
  return `${index + 1}/${TOTAL_STEPS} · ${step.label}`;
}

/* ========================================================================== */
/* 5. Checklist do dashboard                                                 */
/* ========================================================================== */

export type ChecklistId =
  | "informacoes"
  | "logo"
  | "categorias"
  | "produtos"
  | "mesas"
  | "qrcode"
  | "whatsapp";

export type ChecklistItem = {
  id: ChecklistId;
  label: string;
  done: boolean;
  /** Onde o dono resolve este item. */
  href: string;
  /** Texto do estado pendente — o que fazer, não o que falta. */
  action: string;
};

/**
 * Fatos da casa usados para decidir o checklist.
 *
 * Vêm de `onboarding_overview()` (uma consulta) e são **dados reais**, nunca o
 * mapa de progresso. Essa é a decisão central: se o checklist olhasse o mapa,
 * bastaria marcar as etapas para o dashboard dizer "100%" com cardápio vazio.
 */
export type SetupFacts = {
  name: string | null;
  description: string | null;
  logoUrl: string | null;
  categories: number;
  products: number;
  tables: number;
  /** Mesas com token ativo — o QR só existe se a mesa existe. */
  activeTables: number;
  whatsapp: boolean;
  published: boolean;
};

export type SetupOverview = {
  items: ChecklistItem[];
  /** Quantos itens estão prontos. */
  done: number;
  total: number;
  /** 0–100 do **checklist**, não do wizard. */
  percent: number;
  /** `true` quando só falta publicar (o cardápio já tem o essencial). */
  readyToPublish: boolean;
};

/**
 * Monta o checklist.
 *
 * ─── Por que "QR Code" depende de mesa ativa ────────────────────────────────
 *
 * O QR Code não é um arquivo guardado: é gerado a partir do `public_token` da
 * mesa (`/app/mesas/{id}/qr`). Sem mesa, não há QR. Por isso o item só fecha
 * com `activeTables > 0` — contar mesas desativadas marcaria como pronto algo
 * que o cliente não consegue escanear.
 *
 * ─── Por que "Informações" exige descrição ──────────────────────────────────
 *
 * Nome sozinho é o mínimo do banco (`not null`), mas o cardápio público mostra
 * a descrição embaixo do nome. Uma casa sem descrição não está "pronta": está
 * sem a frase que diz ao cliente o que ela serve. Continua sendo possível
 * publicar — só não conta como item do checklist.
 */
export function setupOverview(facts: SetupFacts): SetupOverview {
  const items: ChecklistItem[] = [
    {
      id: "informacoes",
      label: "Informações",
      done: Boolean(facts.name && facts.name.trim().length >= 2 && facts.description?.trim()),
      href: "/app/configuracoes/restaurante",
      action: "Adicione uma descrição ao restaurante",
    },
    {
      id: "logo",
      label: "Logo",
      done: Boolean(facts.logoUrl),
      href: "/app/configuracoes/personalizacao",
      action: "Envie a logo da sua marca",
    },
    {
      id: "categorias",
      label: "Categorias",
      done: facts.categories > 0,
      href: "/app/cardapio",
      action: "Crie a primeira categoria",
    },
    {
      id: "produtos",
      label: "Produtos",
      done: facts.products > 0,
      href: "/app/cardapio/produtos",
      action: "Cadastre o primeiro produto",
    },
    {
      id: "mesas",
      label: "Mesas",
      done: facts.tables > 0,
      href: "/app/mesas",
      action: "Cadastre as mesas do salão",
    },
    {
      id: "qrcode",
      label: "QR Code",
      done: facts.activeTables > 0,
      href: "/app/mesas",
      action: "Ative uma mesa para liberar o QR",
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      done: facts.whatsapp,
      href: "/app/configuracoes/whatsapp",
      action: "Conecte o WhatsApp (opcional)",
    },
  ];

  const done = items.filter((item) => item.done).length;
  const pending = items.filter((item) => !item.done);

  return {
    items,
    done,
    total: items.length,
    percent: Math.round((done / items.length) * 100),
    // "Pronto para publicar" é mais honesto que "100%": o dono pode publicar
    // sem logo e sem WhatsApp, mas não sem categoria + produto + mesa.
    readyToPublish:
      facts.published ||
      (pending.every((item) => item.id === "logo" || item.id === "whatsapp") &&
        facts.categories > 0 &&
        facts.products > 0),
  };
}

/**
 * Percentual curto para o card do dashboard, já arredondado ao múltiplo de 5.
 *
 * `83%` parece medição de laboratório; `85%` o dono lê como "quase lá". O
 * arredondamento só vale para exibição — quem decide conclusão é `percent`.
 */
export function displayPercent(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent / 5) * 5));
}

/* ========================================================================== */
/* 6. Passo inicial                                                          */
/* ========================================================================== */

/**
 * Onde o wizard abre ao entrar.
 *
 * Depois de criar o restaurante, `informacoes` já vem marcada (nome/slug foram
 * preenchidos no cadastro) e o wizard deve abrir na etapa seguinte — abrir na
 * primeira tela com os campos já preenchidos faz o dono achar que travou.
 */
export function firstOpenStep(steps: ProgressSteps): OnboardingStepId {
  return wizardProgress(steps).resumeAt;
}
