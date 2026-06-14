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
    id: 'resume-modern-lorem',
    name: 'Modern CV - Lorem',
    kind: 'resume',
    description: 'A clean local-first CV preset with placeholder content.',
    filename: 'adomnia-modern-cv.tex',
    source: dedent(String.raw`
      \documentclass[11pt,a4paper]{article}
      \usepackage[margin=1.45cm]{geometry}
      \usepackage[hidelinks]{hyperref}
      \usepackage{enumitem}
      \usepackage{xcolor}
      \definecolor{accent}{HTML}{00A3A3}
      \setlength{\parindent}{0pt}
      \setlist[itemize]{leftmargin=*, itemsep=2pt, topsep=2pt}

      % adOmnia CV macros. They are intentionally simple so this file stays portable.
      \newcommand{\adName}[1]{\def\ADName{#1}}
      \newcommand{\adRole}[1]{\def\ADRole{#1}}
      \newcommand{\adLocation}[1]{\def\ADLocation{#1}}
      \newcommand{\adEmail}[1]{\def\ADEmail{#1}}
      \newcommand{\adPhone}[1]{\def\ADPhone{#1}}
      \newcommand{\adWebsite}[1]{\def\ADWebsite{#1}}
      \newcommand{\adSummary}[1]{\def\ADSummary{#1}}
      \newcommand{\adSkills}[1]{\def\ADSkills{#1}}
      \newcommand{\adSection}[1]{\vspace{8pt}{\large\bfseries\color{accent}#1}\vspace{3pt}\hrule\vspace{5pt}}
      \newcommand{\adExperience}[5]{
        \textbf{#1} \hfill {\small #4}\\
        {\color{accent}#2} \hfill {\small #3}
        \begin{itemize}#5\end{itemize}
      }
      \newcommand{\adEducation}[5]{\adExperience{#1}{#2}{#3}{#4}{#5}}
      \newcommand{\adProject}[5]{\adExperience{#1}{#2}{#3}{#4}{#5}}

      \adName{Alex Lorem}
      \adRole{Senior API Platform Engineer}
      \adLocation{Milan, Italy}
      \adEmail{alex.lorem@example.com}
      \adPhone{+39 000 000 0000}
      \adWebsite{https://example.com}
      \adSummary{Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer API platforms, local-first tooling, legacy integrations, and secure developer workflows are the main areas of focus.}
      \adSkills{Go, TypeScript, React, Wails, OpenAPI, SOAP, gRPC, PostgreSQL, Docker, Security}

      \begin{document}
      {\Huge\bfseries \ADName}\\[-1pt]
      {\Large\color{accent}\ADRole}\\[5pt]
      \ADLocation \quad | \quad \href{mailto:\ADEmail}{\ADEmail} \quad | \quad \ADPhone \quad | \quad \ADWebsite

      \vspace{8pt}
      \ADSummary

      \adSection{Skills}
      \ADSkills

      \adSection{Experience}
      \adExperience{Lead Developer Toolbox Architect}{Lorem Systems}{Remote}{2024 -- Present}{
        \item Designed local-first desktop workflows for API testing and document automation.
        \item Integrated REST, SOAP, gRPC, browser debugging, and signed PDF utilities in one workspace.
        \item Improved developer experience with dense UI patterns, reliable exports, and project templates.
      }

      \adExperience{Backend Engineer}{Ipsum Labs}{Milan}{2021 -- 2024}{
        \item Built secure service integrations for enterprise and legacy environments.
        \item Maintained OpenAPI contracts, request runners, and storage migration flows.
      }

      \adSection{Projects}
      \adProject{adOmnia Document Studio}{Personal Product}{Local-first}{2026}{
        \item Markdown, Mermaid, PDF editing, and LaTeX CV drafting in a single local hub.
        \item Exportable source files with no account, telemetry, or cloud dependency.
      }

      \adSection{Education}
      \adEducation{M.Sc. Computer Science}{Universita Lorem}{Turin}{2018 -- 2020}{
        \item Thesis on developer tooling, API lifecycle automation, and secure local workflows.
      }
      \end{document}
    `),
  },
  {
    id: 'resume-academic-lorem',
    name: 'Academic CV - Lorem',
    kind: 'resume',
    description: 'A compact research/academic CV preset with placeholder sections.',
    filename: 'adomnia-academic-cv.tex',
    source: dedent(String.raw`
      \documentclass[11pt,a4paper]{article}
      \usepackage[margin=1.6cm]{geometry}
      \usepackage[hidelinks]{hyperref}
      \usepackage{enumitem}
      \setlength{\parindent}{0pt}
      \setlist[itemize]{leftmargin=*, itemsep=2pt, topsep=2pt}
      \newcommand{\adName}[1]{\def\ADName{#1}}
      \newcommand{\adRole}[1]{\def\ADRole{#1}}
      \newcommand{\adLocation}[1]{\def\ADLocation{#1}}
      \newcommand{\adEmail}[1]{\def\ADEmail{#1}}
      \newcommand{\adPhone}[1]{\def\ADPhone{#1}}
      \newcommand{\adWebsite}[1]{\def\ADWebsite{#1}}
      \newcommand{\adSummary}[1]{\def\ADSummary{#1}}
      \newcommand{\adSkills}[1]{\def\ADSkills{#1}}
      \newcommand{\adSection}[1]{\vspace{8pt}{\large\bfseries #1}\vspace{2pt}\hrule\vspace{5pt}}
      \newcommand{\adExperience}[5]{\textbf{#1}, #2 \hfill {\small #4}\\{\small #3}\begin{itemize}#5\end{itemize}}
      \newcommand{\adEducation}[5]{\adExperience{#1}{#2}{#3}{#4}{#5}}
      \newcommand{\adProject}[5]{\adExperience{#1}{#2}{#3}{#4}{#5}}

      \adName{Dr. Lorem Ipsum}
      \adRole{Research Engineer}
      \adLocation{Rome, Italy}
      \adEmail{lorem.ipsum@example.edu}
      \adPhone{+39 000 111 2222}
      \adWebsite{https://example.edu/lorem}
      \adSummary{Research-focused profile with placeholder publications, teaching, and applied engineering experience.}
      \adSkills{Distributed Systems, Program Analysis, APIs, Formal Methods, Technical Writing}

      \begin{document}
      {\huge\bfseries \ADName}\\
      \ADRole \quad | \quad \ADLocation \quad | \quad \ADEmail \quad | \quad \ADWebsite

      \adSection{Research Summary}
      \ADSummary

      \adSection{Education}
      \adEducation{Ph.D. in Computer Science}{Lorem University}{Rome}{2020 -- 2024}{
        \item Dissertation: Lorem ipsum dolor sit amet for local developer environments.
        \item Research areas: API tooling, secure execution, and reproducible documentation.
      }

      \adSection{Selected Work}
      \adProject{Lorem API Observatory}{Research Prototype}{Open Source}{2023}{
        \item Built a prototype for contract analysis, trace inspection, and technical report generation.
      }

      \adSection{Teaching}
      \adExperience{Teaching Assistant}{Software Engineering}{Lorem University}{2021 -- 2023}{
        \item Led labs on API design, testing, Git workflows, and documentation.
      }
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

function matchMacro(source: string, name: string): string {
  const match = source.match(new RegExp(`\\\\${name}\\{([\\s\\S]*?)\\}`))
  return match?.[1]?.trim() ?? ''
}

function splitSkills(raw: string): string[] {
  return raw.split(',').map((skill) => skill.trim()).filter(Boolean)
}

function extractBullets(raw: string): string[] {
  return Array.from(raw.matchAll(/\\item\s+([^\n]+)/g)).map((match) => match[1].trim())
}

function extractEntries(source: string, macro: 'adExperience' | 'adEducation' | 'adProject'): LatexResumeEntry[] {
  const entries: LatexResumeEntry[] = []
  const pattern = new RegExp(`\\\\${macro}\\{([^{}]*)\\}\\{([^{}]*)\\}\\{([^{}]*)\\}\\{([^{}]*)\\}\\{([\\s\\S]*?)\\n\\s*\\}`, 'g')
  for (const match of source.matchAll(pattern)) {
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
    summary: matchMacro(source, 'adSummary') || 'No summary yet.',
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
