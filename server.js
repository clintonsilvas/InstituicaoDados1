// =============================================================================
//  PrevUni Mock IES API
//  Simula a base de dados de uma Instituição de Ensino Superior real.
//  Zero dependências: só Node 18+.
//
//  GET /api/dados
//    ?seed=2026        semente (mesma semente = mesmos alunos/ids)
//    &alunos=400       quantidade de alunos (30..3000)
//    &cursos=5         quantidade de cursos (1..5)
//    &data=2026-10-15  "data de hoje" simulada (muda semestre atual e andamento)
//    &gabarito=1       inclui _gabarito em cada aluno (para validar a RNA)
//    &pretty=1         JSON indentado
// =============================================================================
import http from "node:http";
import zlib from "node:zlib";

const PORT = process.env.PORT || 3001;
const INST = {
  nome: process.env.IES_NOME || "Centro Universitário Horizonte Mineiro",
  sigla: process.env.IES_SIGLA || "UNIHM",
  cidade: process.env.IES_CIDADE || "Belo Horizonte",
  estado: process.env.IES_ESTADO || "MG",
  dominio: process.env.IES_DOMINIO || "unihm.edu.br",
};

// ----------------------------------------------------------------------------
// Utilitários: PRNG com semente, ruído determinístico, helpers
// ----------------------------------------------------------------------------
const hash32 = (...parts) => {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 16;
  return h >>> 0;
};
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const makeRng = (...parts) => {
  const next = mulberry32(hash32(...parts));
  const rng = {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    normal: (m = 0, s = 1) => {
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    weighted: (weights) => {
      const total = weights.reduce((a, b) => a + b, 0);
      let x = next() * total;
      for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; }
      return weights.length - 1;
    },
  };
  return rng;
};
const noise = (...parts) => (hash32(...parts) / 4294967296) * 2 - 1; // [-1, 1]
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const pad = (n, w) => String(n).padStart(w, "0");
const slug = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// ----------------------------------------------------------------------------
// Documentos válidos (CPF / CNPJ com dígitos verificadores corretos)
// ----------------------------------------------------------------------------
const cpfDv = (arr, start) => {
  const s = arr.reduce((a, x, i) => a + x * (start - i), 0);
  const m = (s * 10) % 11;
  return m === 10 ? 0 : m;
};
const genCPF = (r) => {
  const n = Array.from({ length: 9 }, () => r.int(0, 9));
  if (n.every((x) => x === n[0])) n[8] = (n[8] + 1) % 10;
  const d1 = cpfDv(n, 10);
  const d2 = cpfDv([...n, d1], 11);
  const all = [...n, d1, d2].join("");
  return `${all.slice(0, 3)}.${all.slice(3, 6)}.${all.slice(6, 9)}-${all.slice(9)}`;
};
const cnpjDv = (arr, w) => {
  const r = arr.reduce((a, x, i) => a + x * w[i], 0) % 11;
  return r < 2 ? 0 : 11 - r;
};
const genCNPJ = (r) => {
  const base = [...Array.from({ length: 8 }, () => r.int(0, 9)), 0, 0, 0, 1];
  const d1 = cnpjDv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = cnpjDv([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const a = [...base, d1, d2].join("");
  return `${a.slice(0, 2)}.${a.slice(2, 5)}.${a.slice(5, 8)}/${a.slice(8, 12)}-${a.slice(12)}`;
};

// ----------------------------------------------------------------------------
// Nomes
// ----------------------------------------------------------------------------
const NOMES_M = ["João","Pedro","Lucas","Gabriel","Matheus","Guilherme","Rafael","Felipe","Gustavo","Bruno","Thiago","Eduardo","Leonardo","Rodrigo","Daniel","Vinícius","Henrique","Carlos","Marcos","André","Fernando","Ricardo","Diego","Caio","Samuel","Arthur","Davi","Miguel","Heitor","Murilo","Renan","Igor","Leandro","Wesley","Anderson","Paulo","Luiz","José","Alex","Fábio"];
const NOMES_F = ["Maria","Ana","Juliana","Fernanda","Camila","Beatriz","Larissa","Letícia","Amanda","Gabriela","Mariana","Isabela","Bruna","Natália","Carolina","Patrícia","Aline","Renata","Vanessa","Luana","Raquel","Jéssica","Thaís","Rafaela","Priscila","Débora","Sabrina","Tatiane","Lívia","Helena","Laura","Sofia","Valentina","Bianca","Eduarda","Daniela","Cristiane","Simone","Kelly","Michele"];
const SOBRENOMES = ["Silva","Santos","Oliveira","Souza","Rodrigues","Ferreira","Alves","Pereira","Lima","Gomes","Costa","Ribeiro","Martins","Carvalho","Almeida","Lopes","Soares","Fernandes","Vieira","Barbosa","Rocha","Dias","Nascimento","Andrade","Moreira","Nunes","Marques","Machado","Mendes","Freitas","Cardoso","Ramos","Gonçalves","Santana","Teixeira","Araújo","Cavalcante","Monteiro","Moura","Pinto","Correia","Azevedo","Batista","Campos","Borges","Reis","Duarte","Miranda","Melo","Cunha"];

const genNome = (r) => {
  const fem = r.chance(0.52);
  const lista = fem ? NOMES_F : NOMES_M;
  let nome = r.pick(lista);
  if (r.chance(0.28)) nome += " " + r.pick(lista);
  const s1 = r.pick(SOBRENOMES);
  let s2 = r.pick(SOBRENOMES);
  if (s2 === s1) s2 = r.pick(SOBRENOMES);
  const full = `${nome} ${s1}` + (r.chance(0.8) ? ` ${s2}` : "");
  return { full, first: nome.split(" ")[0], last: s1 };
};

// ----------------------------------------------------------------------------
// Catálogo de cursos (cada período: disciplinas separadas por "|", ":N" = carga horária)
// ----------------------------------------------------------------------------
const CATALOGO = [
  { nome: "Sistemas de Informação", peso: 0.28, periodos: [
    "Algoritmos e Lógica de Programação|Introdução à Computação|Matemática Discreta|Comunicação e Expressão",
    "Programação Orientada a Objetos|Cálculo I|Arquitetura de Computadores|Fundamentos de Administração",
    "Estruturas de Dados|Banco de Dados I|Estatística Aplicada|Sistemas Operacionais",
    "Engenharia de Software I|Banco de Dados II|Redes de Computadores|Álgebra Linear",
    "Engenharia de Software II|Desenvolvimento Web|Interação Humano-Computador|Análise de Sistemas",
    "Inteligência Artificial|Segurança da Informação|Programação Mobile|Gestão de Projetos de TI",
    "Computação em Nuvem|Metodologia de Pesquisa|Empreendedorismo em TI|Estágio Supervisionado:120",
    "Trabalho de Conclusão de Curso:80|Governança de TI|Ética e Legislação em Informática|Tópicos Avançados em Computação",
  ]},
  { nome: "Administração", peso: 0.24, periodos: [
    "Fundamentos de Administração|Matemática Básica|Comunicação Empresarial|Introdução à Economia",
    "Contabilidade Geral|Teorias da Administração|Microeconomia|Sociologia das Organizações",
    "Estatística Aplicada|Gestão de Pessoas|Marketing I|Direito Empresarial",
    "Contabilidade de Custos|Matemática Financeira|Marketing II|Comportamento Organizacional",
    "Administração Financeira I|Gestão da Produção|Pesquisa de Mercado|Sistemas de Informação Gerencial",
    "Administração Financeira II|Logística e Cadeia de Suprimentos|Gestão de Projetos|Empreendedorismo",
    "Planejamento Estratégico|Gestão da Qualidade|Metodologia Científica|Estágio Supervisionado:120",
    "Trabalho de Conclusão de Curso:80|Ética e Responsabilidade Social|Negócios Internacionais|Consultoria Empresarial",
  ]},
  { nome: "Direito", peso: 0.2, periodos: [
    "Introdução ao Estudo do Direito|Teoria Geral do Estado|Sociologia Jurídica|Português Jurídico",
    "Direito Constitucional I|Direito Civil I|Direito Penal I|Filosofia do Direito",
    "Direito Constitucional II|Direito Civil II|Direito Penal II|Teoria Geral do Processo",
    "Direito Civil III|Direito Penal III|Direito Processual Civil I|Direito Administrativo I",
    "Direito Civil IV|Direito Processual Civil II|Direito Processual Penal I|Direito do Trabalho I",
    "Direito Empresarial I|Direito Processual Penal II|Direito do Trabalho II|Direito Tributário I",
    "Direito Empresarial II|Direito Tributário II|Direito Previdenciário|Direito do Consumidor",
    "Direito Civil V|Direito Ambiental|Direito Internacional Público|Prática Jurídica I:80",
    "Direito Processual do Trabalho|Direito Eleitoral|Prática Jurídica II:80|Metodologia da Pesquisa Jurídica",
    "Trabalho de Conclusão de Curso:80|Prática Jurídica III:120|Ética Profissional e Estatuto da OAB|Mediação e Arbitragem",
  ]},
  { nome: "Engenharia Civil", peso: 0.14, periodos: [
    "Cálculo I|Geometria Analítica|Desenho Técnico|Introdução à Engenharia",
    "Cálculo II|Física I|Química Geral|Algoritmos para Engenharia",
    "Cálculo III|Física II|Mecânica Geral|Materiais de Construção I",
    "Resistência dos Materiais I|Topografia|Estatística para Engenharia|Materiais de Construção II",
    "Resistência dos Materiais II|Mecânica dos Fluidos|Geologia de Engenharia|Hidrologia",
    "Teoria das Estruturas|Mecânica dos Solos|Hidráulica|Instalações Prediais",
    "Concreto Armado I|Fundações|Estradas e Pavimentação|Saneamento Básico",
    "Concreto Armado II|Estruturas de Aço e Madeira|Planejamento e Orçamento de Obras|Segurança do Trabalho",
    "Gerenciamento de Obras|Pontes e Grandes Estruturas|Engenharia Econômica|Metodologia Científica",
    "Trabalho de Conclusão de Curso:80|Estágio Supervisionado:160|Patologia das Construções|Ética e Legislação Profissional",
  ]},
  { nome: "Pedagogia", peso: 0.14, periodos: [
    "Fundamentos da Educação|Psicologia do Desenvolvimento|Sociologia da Educação|Língua Portuguesa e Produção Textual",
    "História da Educação|Filosofia da Educação|Psicologia da Aprendizagem|Didática Geral",
    "Políticas Públicas da Educação|Educação Infantil|Alfabetização e Letramento|Tecnologias na Educação",
    "Currículo e Avaliação|Metodologia do Ensino de Matemática|Metodologia do Ensino de Língua Portuguesa|Educação Inclusiva",
    "Metodologia do Ensino de Ciências|Metodologia do Ensino de História e Geografia|Gestão Escolar|Estágio Supervisionado I:100",
    "Educação de Jovens e Adultos|Libras|Pesquisa em Educação|Estágio Supervisionado II:100",
    "Coordenação Pedagógica|Educação e Diversidade|Estágio Supervisionado III:120|Ludicidade e Aprendizagem",
    "Trabalho de Conclusão de Curso:80|Orientação Educacional|Educação Ambiental|Estágio Supervisionado IV:120",
  ]},
];
const DISC_DIFICEIS = /Cálculo|Física|Química|Estatística|Algoritmos|Estruturas|Resistência|Mecânica|Direito Civil|Direito Penal|Contabilidade|Matemática|Banco de Dados|Hidráulica|Processual|Tributário|Concreto|Álgebra/;
const DISC_FACEIS = /Estágio|Trabalho de Conclusão|Prática Jurídica|Ética|Tópicos|Ludicidade/;

// ----------------------------------------------------------------------------
// Calendário acadêmico
// ----------------------------------------------------------------------------
const semLabel = (y, s) => `${y}.${s}`;
const parseSem = (l) => { const [y, s] = l.split("."); return { y: +y, s: +s }; };
const semStart = (l) => { const { y, s } = parseSem(l); return new Date(Date.UTC(y, s === 1 ? 1 : 7, s === 1 ? 6 : 3)); };
const semEnd = (l) => { const { y, s } = parseSem(l); return new Date(Date.UTC(y, s === 1 ? 5 : 11, s === 1 ? 26 : 11)); };
const shiftSem = (l, delta) => {
  const { y, s } = parseSem(l);
  const idx = y * 2 + (s - 1) + delta;
  return semLabel(Math.floor(idx / 2), (idx % 2) + 1);
};
const currentSemester = (now) => {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (m === 0) return semLabel(y - 1, 2);
  return semLabel(y, m <= 6 ? 1 : 2);
};

// ----------------------------------------------------------------------------
// Geração da instituição (estrutura): cursos, coordenadores, professores, disciplinas
// ----------------------------------------------------------------------------
function buildStructure(seed, nCursos, host) {
  const rI = makeRng(seed, "inst");
  const usedEmails = new Set();
  const uniqueEmail = (base, domain) => {
    let e = `${base}@${domain}`, k = 2;
    while (usedEmails.has(e)) e = `${base}${k++}@${domain}`;
    usedEmails.add(e);
    return e;
  };

  const instituicao = {
    id: "INS-001",
    nome: INST.nome,
    sigla: INST.sigla,
    cnpj: genCNPJ(rI),
    cidade: INST.cidade,
    estado: INST.estado,
    api: `${host}/api/dados`,
    dominio: INST.dominio,
  };

  const cursos = [], coordenadores = [], professores = [], disciplinas = [];
  const courses = []; // estrutura interna usada na simulação

  CATALOGO.slice(0, nCursos).forEach((cat, ci) => {
    const r = makeRng(seed, "curso", ci);
    const cursoId = `CUR-${pad(ci + 1, 2)}`;
    const nPeriodos = cat.periodos.length;

    const pc = genNome(r);
    const coord = {
      id: `COO-${pad(ci + 1, 3)}`,
      instituicaoId: instituicao.id,
      nome: pc.full,
      email: uniqueEmail(`${slug(pc.first)}.${slug(pc.last)}`, INST.dominio),
      matricula: `CO${r.int(2008, 2020)}${pad(r.int(1, 999), 3)}`,
    };
    coordenadores.push(coord);
    cursos.push({ id: cursoId, nome: cat.nome, quantidadePeriodos: nPeriodos, instituicaoId: instituicao.id, coordenadorId: coord.id });

    const allNames = cat.periodos.flatMap((p, pi) => p.split("|").map((n) => ({ n, pi })));
    const nProf = Math.max(3, Math.ceil(allNames.length / 3));
    const profs = Array.from({ length: nProf }, (_, k) => {
      const p = genNome(r);
      const prof = {
        id: `PRO-${pad(ci + 1, 2)}${pad(k + 1, 2)}`,
        instituicaoId: instituicao.id,
        nome: p.full,
        email: uniqueEmail(`${slug(p.first)}.${slug(p.last)}`, INST.dominio),
        matricula: `PR${r.int(2005, 2024)}${pad(ci * 100 + k + 1, 4)}`,
      };
      return { ...prof, rigor: clamp(r.normal(0.55, 0.15), 0.25, 0.85), usos: 0 };
    });

    const byPeriod = Array.from({ length: nPeriodos }, () => []);
    const byId = {};
    allNames.forEach(({ n, pi }, idx) => {
      const [nome, chStr] = n.split(":");
      const ch = chStr ? +chStr : r.pick([40, 60, 60, 80, 80]);
      let dif = r.normal(0.45, 0.1);
      if (DISC_DIFICEIS.test(nome)) dif += 0.2;
      if (DISC_FACEIS.test(nome)) dif -= 0.22;
      const prof = profs[idx % nProf];
      prof.usos++;
      const d = {
        id: `DIS-${pad(ci + 1, 2)}${pad(idx + 1, 3)}`,
        nome, periodo: pi + 1, cargaHoraria: ch, cursoId,
        professorId: prof.id,
        dif: clamp(dif, 0.1, 0.95), rigor: prof.rigor, ch,
        matriculas: 0,
      };
      byPeriod[pi].push(d);
      byId[d.id] = d;
    });
    professores.push(...profs);
    courses.push({ id: cursoId, nPeriodos, byPeriod, byId, total: allNames.length, peso: cat.peso, alunos: 0 });
  });

  return { instituicao, cursos, coordenadores, professores, courses };
}

// ----------------------------------------------------------------------------
// Simulação de um aluno ao longo dos semestres
// ----------------------------------------------------------------------------
function simulateStudent(i, ctx) {
  const { seed, courses, cur, now, f, ongoing, bucket, domain } = ctx;
  const r = makeRng(seed, "aluno", i);
  const nC = courses.length;

  // "Veteranos exemplares": garantem que todas as disciplinas (até o último período) tenham alunos.
  const veterano = i < nC * 2;
  let ci, offset;
  if (veterano) {
    ci = i % nC;
    offset = courses[ci].nPeriodos - 1;
  } else {
    ci = r.weighted(courses.map((c) => c.peso));
    const maxOff = courses[ci].nPeriodos + 1;
    offset = r.weighted(Array.from({ length: maxOff + 1 }, (_, k) => Math.max(0.5, 1.5 - 0.08 * k)));
  }
  const c = courses[ci];
  c.alunos++;
  const sems = [];
  for (let k = offset; k >= 0; k--) sems.push(shiftSem(cur, -k));
  const ingSem = sems[0];

  // ---- identidade
  const nome = genNome(r);
  const faixa = r.weighted([0.7, 0.22, 0.08]);
  const idade = faixa === 0 ? clamp(Math.round(r.normal(18.4, 0.9)), 17, 20) : faixa === 1 ? r.int(21, 29) : r.int(30, 48);
  const ingDate = semStart(ingSem);
  const nascimento = new Date(Date.UTC(ingDate.getUTCFullYear() - idade, r.int(0, 11), r.int(1, 28)));
  const cpf = genCPF(r);
  const provedor = r.pick(["gmail.com", "gmail.com", "outlook.com", "hotmail.com", "yahoo.com.br"]);
  const emailBase = `${slug(nome.first)}.${slug(nome.last)}${r.chance(0.5) ? r.int(1, 99) : ""}`;
  const email = r.chance(0.6) ? `${emailBase}@aluno.${domain}` : `${emailBase}@${provedor}`;

  // ---- traços latentes (não saem na API, só em _gabarito)
  const trabalha = r.chance(faixa === 0 ? 0.25 : faixa === 1 ? 0.65 : 0.85);
  const financeiro = r.chance(trabalha ? 0.45 : 0.28);
  const S = {
    perfeito: veterano,
    trabalha,
    financeiro,
    aptidao: veterano ? 0.9 : clamp(r.normal(0.6, 0.17), 0.15, 0.97),
    dedicacao: veterano ? 0.88 : clamp(r.normal(0.62, 0.18) - 0.07 * trabalha - 0.05 * financeiro, 0.1, 0.98),
    afinidade: veterano ? 0.9 : clamp(r.normal(0.68, 0.2), 0.1, 1),
  };

  const aprov = new Set();
  let pend = [];
  let periodo = 1, retained = 0, lastFail = 0;
  let status = "ativo", semEvasao = null, periodoAtual = 1;
  const mats = [];

  for (let idx = 0; idx < sems.length; idx++) {
    const sem = sems[idx];
    const isLast = idx === sems.length - 1;
    const live = isLast && ongoing;

    const periodDisc = c.byPeriod[periodo - 1].filter((d) => !aprov.has(d.id) && !pend.includes(d.id));
    let take = [...pend.slice(0, 3).map((id) => c.byId[id]), ...periodDisc];
    const rest = pend.slice(3);
    const maxLoad = S.trabalha ? 5 : 6;
    const deferred = take.slice(maxLoad).map((d) => d.id);
    take = take.slice(0, maxLoad);
    pend = [...rest, ...deferred];
    if (take.length === 0) break;
    periodoAtual = periodo;

    // ---- decisão de evasão neste semestre
    let drop = false;
    if (!S.perfeito) {
      const logit =
        -3.5 +
        2.0 * (0.55 - S.afinidade) +
        1.7 * (0.55 - S.aptidao) +
        0.7 * S.trabalha +
        0.8 * S.financeiro +
        1.6 * lastFail +
        0.35 * retained +
        (idx === 0 ? 0.5 : idx === 1 ? 0.3 : 0);
      drop = r.chance(1 / (1 + Math.exp(-logit)));
    }

    const dropSevero = drop && r.chance(0.55);
    const shock = r.normal(0, 0.45);
    const pshock = r.normal(0, 0.035);
    const pendFin = live && r.chance(0.012 + 0.05 * S.financeiro + (drop ? 0.1 : 0));

    const results = take.map((d) => {
      let nota = 4.4 + 6.0 * (0.5 * S.aptidao + 0.3 * S.dedicacao + 0.2 * S.afinidade)
        - 2.4 * (d.dif - 0.5) - 1.6 * (d.rigor - 0.5) - (idx === 0 ? 0.4 : 0) + shock + r.normal(0, 0.9);
      let pres = 0.70 + 0.25 * S.dedicacao + 0.05 * S.afinidade - 0.07 * S.trabalha - 0.04 * S.financeiro + pshock + r.normal(0, 0.05);
      if (S.perfeito) { nota = Math.max(nota, 6.6 + r.next() * 2.4); pres = Math.max(pres, 0.86); }
      if (drop) {
        if (dropSevero) { nota = nota * 0.55 + r.normal(0, 0.9); pres = r.normal(0.32, 0.13); nota = Math.min(nota, 5.5); }
        else { nota = nota * 0.8 - 0.5 + r.normal(0, 0.7); pres = r.normal(0.62, 0.14); } // abandono "silencioso"
      }
      return { d, nota: clamp(nota, 0, 10), pres: clamp(pres, 0.05, 1) };
    });

    if (live) {
      for (const { d, nota, pres } of results) {
        const matId = ctx.nextMat();
        const jn = noise(seed, matId, bucket, "p"), jn2 = noise(seed, matId, bucket, "n");
        const presNow = clamp(pres + 0.02 * jn, 0.03, 1);
        let carga = Math.round(d.ch * f * presNow);
        let notaParcial = f >= 0.3 ? round1(clamp(nota + (1 - f) * 1.4 * jn2, 0, 10)) : null;
        let situacao = "matriculado";
        if (pendFin) { situacao = "pendente"; notaParcial = null; carga = Math.round(carga * 0.35); }
        mats.push({ id: `MAT-${pad(matId, 6)}`, alunoId: null, disciplinaId: d.id, semestre: sem, situacao, cargaHorariaCumprida: carga, nota: notaParcial });
        d.matriculas++;
      }
      if (drop) { status = "evadido"; semEvasao = sem; }
      break;
    }

    // semestre encerrado
    let approved = 0;
    const failed = [];
    for (const { d, nota, pres } of results) {
      const ok = nota >= 6 && pres >= 0.75;
      const matId = ctx.nextMat();
      mats.push({
        id: `MAT-${pad(matId, 6)}`, alunoId: null, disciplinaId: d.id, semestre: sem,
        situacao: ok ? "aprovado" : "reprovado",
        cargaHorariaCumprida: Math.round(d.ch * pres),
        nota: round1(nota),
      });
      d.matriculas++;
      if (ok) { approved++; aprov.add(d.id); } else failed.push(d.id);
    }
    pend = [...failed, ...pend];
    lastFail = failed.length / results.length;

    if (drop) { status = "evadido"; semEvasao = sem; break; }
    if (aprov.size === c.total) { status = "formado"; break; }
    if (approved / results.length >= 0.5 && periodo < c.nPeriodos) { periodo++; retained = 0; } else retained++;
  }

  const seqKey = ingSem;
  ctx.seq[seqKey] = (ctx.seq[seqKey] || 0) + 1;
  const alunoId = `ALU-${ingSem}-${pad(ctx.seq[seqKey], 4)}`;
  mats.forEach((m) => (m.alunoId = alunoId));

  const aluno = {
    id: alunoId, nome: nome.full, cpf, email, dataNascimento: nascimento,
    cursoId: c.id, periodoAtual, dataIngresso: ingDate,
  };
  if (ctx.gabarito) {
    aluno._gabarito = {
      status,
      evadiu: status === "evadido",
      semestreEvasao: semEvasao,
      perfil: {
        aptidao: r2(S.aptidao), dedicacao: r2(S.dedicacao),
        afinidadeCurso: r2(S.afinidade), trabalha: S.trabalha, dificuldadeFinanceira: S.financeiro,
        idadeIngresso: idade,
      },
    };
  }
  return { aluno, mats };
}

// ----------------------------------------------------------------------------
// Montagem do dataset completo (PrevUniData)
// ----------------------------------------------------------------------------
function generate({ seed, nAlunos, nCursos, now, host, gabarito }) {
  const st = buildStructure(seed, nCursos, host);
  const cur = currentSemester(now);
  const ini = semStart(cur), fim = semEnd(cur);
  const f = clamp((now - ini) / (fim - ini), 0, 1);
  const ongoing = f < 1 && now >= ini;
  const bucket = Math.floor(now.getTime() / 3600000);

  let matCounter = 0;
  const ctx = {
    seed, courses: st.courses, cur, now, f, ongoing, bucket, gabarito,
    domain: INST.dominio, seq: {}, nextMat: () => ++matCounter,
  };

  const alunos = [], matriculas = [];
  for (let i = 0; i < nAlunos; i++) {
    const { aluno, mats } = simulateStudent(i, ctx);
    alunos.push(aluno);
    matriculas.push(...mats);
  }

  // Nada vazio: remove disciplinas sem matrículas, cursos sem alunos, professores sem disciplinas.
  const discUsadas = new Set(matriculas.map((m) => m.disciplinaId));
  const disciplinas = st.courses.flatMap((c) =>
    c.byPeriod.flat().filter((d) => discUsadas.has(d.id))
      .map((d) => ({ id: d.id, nome: d.nome, periodo: d.periodo, cargaHoraria: d.cargaHoraria, cursoId: d.cursoId, professorId: d.professorId }))
  );
  const cursoUsado = new Set(alunos.map((a) => a.cursoId));
  const cursos = st.cursos.filter((c) => cursoUsado.has(c.id));
  const coordenadores = st.coordenadores.filter((c) => cursos.some((cu) => cu.coordenadorId === c.id));
  const profUsado = new Set(disciplinas.map((d) => d.professorId));
  const professores = st.professores.filter((p) => profUsado.has(p.id)).map(({ rigor, usos, ...p }) => p);

  return {
    instituicao: st.instituicao,
    coordenadores, professores, cursos, disciplinas, alunos, matriculas,
  };
}

// ----------------------------------------------------------------------------
// Servidor HTTP
// ----------------------------------------------------------------------------
const cache = new Map();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const cors = { "Access-Control-Allow-Origin": "*" };

  if (req.method === "OPTIONS") { res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" }); return res.end(); }
  if (req.method !== "GET") { res.writeHead(405, cors); return res.end(); }

  if (url.pathname === "/" || url.pathname === "/health") {
    res.writeHead(200, { ...cors, "Content-Type": "text/plain; charset=utf-8" });
    return res.end("PrevUni Mock IES API - GET /api/dados?seed=2026&alunos=300&cursos=5&data=2026-10-15&gabarito=1&pretty=1\n");
  }
  if (url.pathname !== "/api/dados") { res.writeHead(404, cors); return res.end("not found"); }

  const q = url.searchParams;
  const seed = q.get("seed") ?? "2026";
  const nAlunos = clamp(parseInt(q.get("alunos") ?? "300", 10) || 300, 30, 3000);
  const nCursos = clamp(parseInt(q.get("cursos") ?? "5", 10) || 5, 1, CATALOGO.length);
  const gabarito = ["1", "true"].includes(q.get("gabarito"));
  const pretty = ["1", "true"].includes(q.get("pretty"));
  let now = new Date();
  if (q.get("data")) {
    const d = new Date(q.get("data") + "T12:00:00Z");
    if (isNaN(d)) { res.writeHead(400, { ...cors, "Content-Type": "application/json" }); return res.end('{"erro":"data invalida, use YYYY-MM-DD"}'); }
    now = d;
  }

  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = `${proto}://${req.headers.host}`;
  const key = [seed, nAlunos, nCursos, gabarito, pretty, Math.floor(now.getTime() / 3600000), host].join("|");

  let body = cache.get(key);
  if (!body) {
    const data = generate({ seed, nAlunos, nCursos, now, host, gabarito });
    body = Buffer.from(JSON.stringify(data, null, pretty ? 2 : 0));
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(key, body);
  }

  const headers = { ...cors, "Content-Type": "application/json; charset=utf-8" };
  if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    headers["Content-Encoding"] = "gzip";
    res.writeHead(200, headers);
    return res.end(zlib.gzipSync(body));
  }
  res.writeHead(200, headers);
  res.end(body);
});

server.listen(PORT, () => console.log(`PrevUni Mock IES API rodando na porta ${PORT}`));
export { generate };
