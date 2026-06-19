export interface LatexTemplate {
  id: string
  name: string
  kind: 'resume' | 'letter' | 'report' | 'blank'
  description: string
  filename: string
  source: string
}

export interface LatexResumeEntry {
  title: string
  organization: string
  location: string
  date: string
  bullets: string[]
}

export interface LatexResumePreview {
  name: string
  role: string
  location: string
  email: string
  phone: string
  website: string
  summary: string
  skills: string[]
  experience: LatexResumeEntry[]
  education: LatexResumeEntry[]
  projects: LatexResumeEntry[]
}

function dedent(value: string): string {
  const lines = value.replace(/^\n/, '').replace(/\s+$/, '').split('\n')
  const indent = Math.min(...lines.filter(Boolean).map((line) => line.match(/^\s*/)?.[0].length ?? 0))
  return lines.map((line) => line.slice(indent)).join('\n')
}

export const LATEX_TEMPLATES: LatexTemplate[] = [
  {
    id: 'resume-classic-software-engineer',
    name: 'Software Engineer Resume',
    kind: 'resume',
    description: 'A solid, ATS-friendly one-page CV with clear sections and editable placeholders.',
    filename: 'professional-software-engineer-cv.tex',
    source: dedent(String.raw`
      \documentclass[10pt,a4paper]{article}
      \usepackage[T1]{fontenc}
      \usepackage[utf8]{inputenc}
      \usepackage[margin=1.55cm]{geometry}
      \usepackage[hidelinks]{hyperref}
      \usepackage{enumitem}
      \usepackage{xcolor}
      \usepackage{tabularx}
      \definecolor{accent}{HTML}{0E7490}
      \definecolor{muted}{HTML}{475569}
      \pagestyle{empty}
      \urlstyle{same}
      \raggedright
      \setlength{\parindent}{0pt}
      \setlength{\tabcolsep}{0pt}
      \setlist[itemize]{leftmargin=1.35em, itemsep=1.5pt, topsep=2pt, parsep=0pt}

      % Keep these macros intact to preserve adOmnia's structured live preview.
      \newcommand{\adName}[1]{\def\ADName{#1}}
      \newcommand{\adRole}[1]{\def\ADRole{#1}}
      \newcommand{\adLocation}[1]{\def\ADLocation{#1}}
      \newcommand{\adEmail}[1]{\def\ADEmail{#1}}
      \newcommand{\adPhone}[1]{\def\ADPhone{#1}}
      \newcommand{\adWebsite}[1]{\def\ADWebsite{#1}}
      \newcommand{\adSummary}[1]{\def\ADSummary{#1}}
      \newcommand{\adSkills}[1]{\def\ADSkills{#1}}
      \newcommand{\adSection}[1]{\vspace{7pt}{\large\bfseries\color{accent} #1}\par\vspace{2pt}\hrule\vspace{4pt}}
      \newcommand{\adExperience}[5]{
        \textbf{#1} \hfill {\small #4}\\
        \textit{#2} \hfill {\small\textit{#3}}
        \begin{itemize}#5\end{itemize}
      }
      \newcommand{\adEducation}[5]{\adExperience{#1}{#2}{#3}{#4}{#5}}
      \newcommand{\adProject}[5]{\adExperience{#1}{#2}{#3}{#4}{#5}}

      \adName{Lorem Ipsum}
      \adRole{Senior Software Engineer}
      \adLocation{Rome, Italy}
      \adEmail{lorem.ipsum@example.com}
      \adPhone{+39 000 000 0000}
      \adWebsite{https://example.com}
      \adSummary{Software engineer focused on reliable API platforms, maintainable systems, and measurable product outcomes. Replace this paragraph with a concise profile tailored to the target role.}
      \adSkills{Languages: TypeScript, Go, SQL | Backend: REST, GraphQL, event-driven systems | Platform: Docker, CI/CD, observability | Practices: testing, security, technical leadership}

      \begin{document}
      \begin{tabularx}{\textwidth}{@{}X r@{}}
        {\LARGE\bfseries \ADName} & \href{mailto:\ADEmail}{\ADEmail}\\
        {\color{accent}\bfseries \ADRole} & \ADPhone\\
        {\small\color{muted}\ADLocation} & \href{\ADWebsite}{\ADWebsite}
      \end{tabularx}

      \adSection{Profile}
      \ADSummary

      \adSection{Experience}
      \adExperience{Senior Software Engineer}{Lorem Systems}{Remote}{2022 -- Present}{
        \item Led [project or platform] for [scope], improving [metric] by [result].
        \item Designed [service or workflow] that reduced [cost, latency, or failures] from [before] to [after].
        \item Mentored [team size] engineers and established [engineering practice] across [area].
      }
      \adExperience{Software Engineer}{Ipsum Technologies}{Milan, Italy}{2019 -- 2022}{
        \item Delivered [customer-facing capability] used by [users or teams] with [availability or quality target].
        \item Automated [manual process], saving [time] per [week or release] while preserving auditability.
      }

      \adSection{Selected Project}
      \adProject{API Reliability Platform}{Independent Project}{Open Source}{2024}{
        \item Built [brief product description] using [relevant technologies].
        \item Demonstrated [measurable outcome] through [test, benchmark, or adoption signal].
      }

      \adSection{Education}
      \adEducation{M.Sc. in Computer Science}{Lorem University}{Rome, Italy}{2017 -- 2019}{
        \item Focus: distributed systems, software architecture, and information security.
      }

      \adSection{Technical Skills}
      \ADSkills
      \end{document}
    `),
  },
  {
    id: 'technical-report',
    name: 'Technical Report',
    kind: 'report',
    description: 'A minimal engineering report for architecture notes or API findings.',
    filename: 'adomnia-technical-report.tex',
    source: dedent(String.raw`
      \documentclass[11pt,a4paper]{article}
      \usepackage[margin=1.8cm]{geometry}
      \usepackage[hidelinks]{hyperref}
      \usepackage{enumitem}
      \setlength{\parindent}{0pt}

      \title{Lorem API Integration Report}
      \author{adOmnia Document Studio}
      \date{\today}

      \begin{document}
      \maketitle

      \section{Executive Summary}
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. This report captures API behavior, risks, and follow-up actions.

      \section{Findings}
      \begin{itemize}
        \item Endpoint contracts are consistent with the documented OpenAPI schema.
        \item Authentication flows require additional negative-case testing.
        \item PDF export and signing workflows remain local-first.
      \end{itemize}

      \section{Actions}
      \begin{enumerate}
        \item Validate production certificates.
        \item Run regression scenarios.
        \item Attach signed evidence PDFs to the workspace archive.
      \end{enumerate}
      \end{document}
    `),
  },
  {
    id: 'blank-article',
    name: 'Blank Article',
    kind: 'blank',
    description: 'A clean empty LaTeX article.',
    filename: 'adomnia-article.tex',
    source: dedent(String.raw`
      \documentclass[11pt,a4paper]{article}
      \usepackage[margin=1.8cm]{geometry}
      \usepackage[hidelinks]{hyperref}

      \title{Untitled Document}
      \author{adOmnia}
      \date{\today}

      \begin{document}
      \maketitle

      \section{Introduction}
      Lorem ipsum dolor sit amet, consectetur adipiscing elit.
      \end{document}
    `),
  },
]

export function isLegacyBundledResume(templateId: string, source: string): boolean {
  return templateId === 'resume-classic-software-engineer' && /\\adName\{Sourabh Bajaj\}/i.test(source)
}

function matchMacro(source: string, name: string): string {
  const match = source.match(new RegExp(`\\\\${name}\\{([\\s\\S]*?)\\}`))
  return match?.[1]?.trim() ?? ''
}

function splitSkills(raw: string): string[] {
  if (raw.includes('|')) return raw.split('|').map((skill) => skill.trim()).filter(Boolean)
  return raw.split(',').map((skill) => skill.trim()).filter(Boolean)
}

function latexInlineToText(raw: string): string {
  return raw
    .replace(/\\textbf\{([^}]*)}/g, '$1')
    .replace(/\\textit\{([^}]*)}/g, '$1')
    .replace(/\\href\{[^}]*}\{([^}]*)}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*])?/g, '')
    .replace(/[{}]/g, '')
    .trim()
}

function extractBullets(raw: string): string[] {
  const bullets = Array.from(raw.matchAll(/\\item\s+([^\n]+)/g)).map((match) => latexInlineToText(match[1]))
  if (bullets.length > 0) return bullets
  const plain = latexInlineToText(raw)
  return plain ? [plain] : []
}

function extractEntries(source: string, macro: 'adExperience' | 'adEducation' | 'adProject'): LatexResumeEntry[] {
  const entries: LatexResumeEntry[] = []
  const documentStart = source.indexOf('\\begin{document}')
  const documentSource = documentStart >= 0 ? source.slice(documentStart) : source
  const pattern = new RegExp(`\\\\${macro}\\{([^{}]*)\\}\\{([^{}]*)\\}\\{([^{}]*)\\}\\{([^{}]*)\\}\\{([\\s\\S]*?)\\n\\s*\\}`, 'g')
  for (const match of documentSource.matchAll(pattern)) {
    entries.push({
      title: match[1].trim(),
      organization: match[2].trim(),
      location: match[3].trim(),
      date: match[4].trim(),
      bullets: extractBullets(match[5]),
    })
  }
  return entries
}

export function parseResumePreview(source: string): LatexResumePreview {
  return {
    name: matchMacro(source, 'adName') || 'Untitled Candidate',
    role: matchMacro(source, 'adRole') || 'Role',
    location: matchMacro(source, 'adLocation'),
    email: matchMacro(source, 'adEmail'),
    phone: matchMacro(source, 'adPhone'),
    website: matchMacro(source, 'adWebsite'),
    summary: matchMacro(source, 'adSummary'),
    skills: splitSkills(matchMacro(source, 'adSkills')),
    experience: extractEntries(source, 'adExperience'),
    education: extractEntries(source, 'adEducation'),
    projects: extractEntries(source, 'adProject'),
  }
}

export function latexToPlainText(source: string): string {
  return source
    .replace(/%.*$/gm, '')
    .replace(/\\(documentclass|usepackage)(\[[^\]]*])?\{[^}]*}/g, '')
    .replace(/\\(begin|end)\{[^}]*}/g, '')
    .replace(/\\(section|subsection|title|author|date)\{([^}]*)}/g, '\n$2\n')
    .replace(/\\item\s+/g, '• ')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
