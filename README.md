# PrevUni Mock IES API

Simula a base de uma IES real (alunos, professores, coordenadores, cursos, disciplinas e matrículas)
no formato `PrevUniData`. Sem dependências, só Node 18+.

## Rodar
    npm start            # porta 3000 (ou PORT=8080 npm start)

## Endpoint único
    GET /api/dados

| parâmetro   | padrão | descrição |
|-------------|--------|-----------|
| `seed`      | 2026   | mesma semente = mesmos alunos e ids |
| `alunos`    | 300    | 30 a 3000 |
| `cursos`    | 5      | 1 a 5 (SI, Administração, Direito, Eng. Civil, Pedagogia) |
| `data`      | hoje   | `YYYY-MM-DD`: simula outra data (muda o semestre atual e o andamento) |
| `gabarito`  | -      | `1` adiciona `_gabarito` em cada aluno (status real, perfil) para validar a RNA |
| `pretty`    | -      | `1` JSON indentado |

## Como os dados se comportam
- Cada aluno tem traços ocultos (aptidão, dedicação, afinidade com o curso, trabalha, dificuldade financeira)
  que geram notas, frequência, reprovações, retenção de período e evasão.
- Disciplinas têm dificuldade (Cálculo, Física, Direito Civil...) e professores têm rigor diferente.
- `situacao`: aprovado = nota >= 6 e frequência >= 75%; reprovado = nota < 6 ou faltas.
- `cargaHorariaCumprida` = horas de presença. Em disciplinas encerradas, é a presença final.
- Semestre atual: `matriculado` (nota parcial só após ~30% do semestre; carga proporcional ao tempo decorrido),
  e alguns `pendente` (pendência financeira/documental, sem nota).
- Os dados do semestre em andamento variam a cada hora e conforme a data avança; o histórico é fixo.
- Evadidos: sem matrícula no semestre atual; o último semestre costuma mostrar queda de frequência/notas
  (nem sempre: parte dos abandonos é "silenciosa"). Taxa de evasão em torno de 30%.
- Alunos formados também aparecem (todas as disciplinas aprovadas).
- Nada vazio: curso sem alunos, disciplina sem matrículas e professor sem disciplina são removidos.

## Consumindo em Python
    import requests, pandas as pd
    d = requests.get("https://SEU-HOST/api/dados", params={"alunos": 800, "gabarito": 1}).json()
    alunos = pd.DataFrame(d["alunos"]); mats = pd.DataFrame(d["matriculas"])

## Hospedagem
Render / Railway / Fly / qualquer VPS: build vazio, start `npm start`.
Variáveis opcionais: `IES_NOME`, `IES_SIGLA`, `IES_CIDADE`, `IES_ESTADO`, `IES_DOMINIO`.
