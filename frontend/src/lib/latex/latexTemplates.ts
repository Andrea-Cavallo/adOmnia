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
    description: 'A compact one-page software engineer resume in a classic LaTeX style.',
    filename: 'software-engineer-resume.tex',
    source: dedent(String.raw`
      \documentclass[10pt,a4paper]{article}
      \usepackage[margin=0.68in]{geometry}
      \usepackage[hidelinks]{hyperref}
      \usepackage{enumitem}
      \setlength{\parindent}{0pt}
      \setlist[itemize]{leftmargin=*, itemsep=1pt, topsep=1pt}
      \setlist[itemize,2]{label=\(\circ\), leftmargin=1.2em}

      % adOmnia resume macros. Portable, editable, and intentionally close to the rendered page.
      \newcommand{\adName}[1]{\def\ADName{#1}}
      \newcommand{\adRole}[1]{\def\ADRole{#1}}
      \newcommand{\adLocation}[1]{\def\ADLocation{#1}}
      \newcommand{\adEmail}[1]{\def\ADEmail{#1}}
      \newcommand{\adPhone}[1]{\def\ADPhone{#1}}
      \newcommand{\adWebsite}[1]{\def\ADWebsite{#1}}
      \newcommand{\adSummary}[1]{\def\ADSummary{#1}}
      \newcommand{\adSkills}[1]{\def\ADSkills{#1}}
      \newcommand{\adSection}[1]{\vspace{7pt}{\scshape #1}\vspace{2pt}\hrule\vspace{4pt}}
      \newcommand{\adExperience}[5]{
        \item \textbf{#2} \hfill #3\\
        \textit{#1} \hfill \textit{#4}
        \begin{itemize}#5\end{itemize}
      }
      \newcommand{\adEducation}[5]{\adExperience{#1}{#2}{#3}{#4}{#5}}
      \newcommand{\adProject}[5]{\item \textbf{#1}: #5}

      \adName{Sourabh Bajaj}
      \adRole{Software Engineer}
      \adLocation{}
      \adEmail{mail@website.com}
      \adPhone{+1-123-456-7890}
      \adWebsite{http://www.sourabhbajaj.com}
      \adSummary{}
      \adSkills{Languages: Scala, Python, Javascript, C++, SQL, Java | Technologies: AWS, Play, React, Kafka, GCE}

      \begin{document}
      \begin{tabular*}{\textwidth}{@{\extracolsep{\fill}} l r}
        {\Large \ADName} & Email : \href{mailto:\ADEmail}{\ADEmail}\\
        \href{\ADWebsite}{\ADWebsite} & Mobile : \ADPhone
      \end{tabular*}

      \adSection{Education}
      \begin{itemize}
      \adEducation{Master of Science in Computer Science; GPA: 4.00}{Georgia Institute of Technology}{Atlanta, GA}{Aug. 2012 -- Dec. 2013}{}
      \adEducation{Bachelor of Engineering in Electrical and Electronics; GPA: 3.66 (9.15/10.0)}{Birla Institute of Technology and Science}{Pilani, India}{Aug. 2008 -- July. 2012}{}
      \end{itemize}

      \adSection{Experience}
      \begin{itemize}
      \adExperience{Software Engineer}{Google}{Mountain View, CA}{Oct 2016 -- Present}{
        \item \textbf{TensorFlow}: TensorFlow is an open source software library for numerical computation using data flow graphs; primarily used for training deep learning models.
        \item \textbf{Apache Beam}: Apache Beam is a unified model for defining both batch and streaming data-parallel processing pipelines, as well as a set of language-specific SDKs for constructing pipelines and runners.
      }

      \adExperience{Senior Software Engineer}{Coursera}{Mountain View, CA}{Jan 2014 -- Oct 2016}{
        \item \textbf{Notifications}: Service for sending email, push and in-app notifications. Involved in features such as delivery time optimization, tracking, queuing and A/B testing.
        \item \textbf{Nostos}: Bulk data processing and injection service from Hadoop to Cassandra and provides a thin REST layer on top for serving offline computed data online.
        \item \textbf{Workflows}: Dataduct an open source workflow framework to create and manage data pipelines leveraging reusable patterns to expedite developer productivity.
        \item \textbf{Data Collection}: Designed the internal survey and crowd sourcing platform which allowed for creating various tasks for crowd sourcing or embedding surveys across the Coursera platform.
        \item \textbf{Dev Environment}: Analytics environment based on docker and AWS, standardized the python and R dependencies. Wrote the core libraries that are shared by all data scientists.
        \item \textbf{Data Warehousing}: Setup, schema design and management of Amazon Redshift. Built an internal app for access to the data using a web interface.
        \item \textbf{Recommendations}: Core service for all recommendation systems at Coursera, currently used on the homepage and throughout the content discovery process.
        \item \textbf{Content Discovery}: Improved content discovery by building a new onboarding experience on coursera.
        \item \textbf{Course Dashboards}: Instructor dashboards and learner surveying tools which helped instructors run their class better.
      }

      \adExperience{Data Scientist}{Lucena Research}{Atlanta, GA}{Summer 2012 and 2013}{
        \item \textbf{Portfolio Management}: Created models for portfolio hedging, portfolio optimization and price forecasting.
        \item \textbf{QuantDesk}: Python backend for a web application used by hedge fund managers for portfolio management.
      }
      \end{itemize}

      \adSection{Projects}
      \begin{itemize}
      \adProject{QuantSoftware Toolkit}{}{}{}{Open source python library for financial data analysis and machine learning for finance.}
      \adProject{Github Visualization}{}{}{}{Data Visualization of Git Log data using D3 to analyze project trends over time.}
      \adProject{Recommendation System}{}{}{}{Music and Movie recommender systems using collaborative filtering on public datasets.}
      \end{itemize}

      \adSection{Programming Skills}
      \begin{itemize}
        \item \ADSkills
      \end{itemize}
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
