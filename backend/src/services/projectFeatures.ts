import { randomUUID } from 'node:crypto'
import path from 'node:path'
import JSZip from 'jszip'
import * as Y from 'yjs'
import {
  createProject,
  createProjectFile,
  deleteProject,
  getDbPool,
  getProjectById,
  getProjectFileById,
  getProjectFileStorage,
  listProjectFiles,
  listProjectsForUser,
  setProjectMainFile,
  touchProjectFile,
  updateProjectFileCollaborationState,
} from '../db.js'
import {
  createBinaryFileInDrive,
  createDriveFolderInDrive,
  createProjectDriveFolder,
  createTextFileInDrive,
  deleteDriveItem,
  ensureChildFolderInDrive,
  moveDriveItem,
  readFileBufferFromDrive,
  readTextFileFromDrive,
  writeTextFileToDrive,
} from './drive.js'
import { chooseAutomaticMainFile } from './projectMainFile.js'
import type {
  ProjectActivityEvent,
  ProjectChatMessage,
  ProjectDashboardData,
  ProjectDetail,
  ProjectFile,
  ProjectFileWorkflow,
  ProjectReviewSuggestion,
  ProjectReviewSuggestionKind,
  ProjectState,
  ProjectSummary,
  ProjectTemplate,
  ProjectTemplateId,
} from '../types.js'

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const TRASH_PATH_PREFIX = 'Trash'

type ProjectPreferenceRow = {
  project_id: string
  is_starred: boolean
  is_pinned: boolean
  archived_at: number | null
  trashed_at: number | null
  last_opened_at: number | null
  template_id: ProjectTemplateId | null
}

type ProjectFileWorkflowRow = {
  file_id: string
  project_id: string
  locked_by_user_id: string | null
  locked_by_name: string | null
  locked_at: number | null
  review_owner_user_id: string | null
  review_owner_name: string | null
  review_assigned_at: number | null
  trashed_at: number | null
  trashed_original_path: string | null
}

type ProjectChatMessageRow = {
  id: string
  project_id: string
  author_user_id: string
  author_name: string
  author_avatar_url: string | null
  content: string
  created_at: number
  updated_at: number
}

type ProjectReviewSuggestionRow = {
  id: string
  project_id: string
  file_id: string
  author_user_id: string
  author_name: string
  author_avatar_url: string | null
  kind: ProjectReviewSuggestionKind
  status: 'open' | 'accepted' | 'rejected'
  excerpt: string
  replacement_text: string
  start_line: number
  start_column: number
  end_line: number
  end_column: number
  decided_by_user_id: string | null
  decided_by_name: string | null
  decided_at: number | null
  created_at: number
  updated_at: number
}

type TemplateFileDefinition = {
  path: string
  mimeType: string
  content: string
}

type TemplateDefinition = ProjectTemplate & {
  files: TemplateFileDefinition[]
  mainFilePath: string
}

type ProjectTemplatePublicationRow = {
  id: string
  author_user_id: string
  author_name: string
  title: string
  description: string
  category: string
  tags: string
  preview_snippet: string
  main_file_path: string
  files_json: string
  style_profile_id: string | null
  citation_style: string | null
  page_limit: number | null
  created_at: number
}

const PROJECT_TEMPLATES: TemplateDefinition[] = [
  buildTemplate({
    id: 'blank',
    title: 'Blank project',
    description: 'A minimal Typst project with a single main document.',
    category: 'General',
    tags: ['starter'],
    mainFilePath: 'main.typ',
    files: [{ path: 'main.typ', mimeType: 'text/plain', content: '= Untitled Project\n\nStart writing here.\n' }],
    pageLimit: null,
    styleProfileId: null,
    citationStyle: null,
    requiredSections: [],
  }),
  buildTemplate({
    id: 'article',
    title: 'Article',
    description: 'Front matter, sections, and bibliography scaffolding for papers and essays.',
    category: 'General',
    tags: ['paper', 'journal'],
    styleProfileId: 'academic-article',
    citationStyle: 'author-year',
    requiredSections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    mainFilePath: 'main.typ',
    pageLimit: 20,
    files: [
      { path: 'main.typ', mimeType: 'text/plain', content: '#set page(margin: 1in)\n#set text(size: 11pt)\n\n= Title\n\nAuthor Name\\\nAffiliation\n\n== Abstract\n\nWrite the abstract here.\n\n== Introduction\n\n== Methods\n\n== Results\n\n== Discussion\n\n#bibliography("references.bib")\n' },
      { path: 'references.bib', mimeType: 'text/plain', content: '@article{example,\n  title = {Example Reference},\n  author = {Doe, Jane},\n  year = {2024}\n}\n' },
    ],
  }),
  buildTemplate({
    id: 'thesis',
    title: 'Thesis',
    description: 'A chapter-based thesis layout with front matter and appendices.',
    category: 'Thesis',
    tags: ['dissertation'],
    styleProfileId: 'generic-thesis',
    citationStyle: 'numeric',
    requiredSections: ['Introduction', 'Related Work', 'Methodology'],
    mainFilePath: 'main.typ',
    pageLimit: 100,
    files: [
      { path: 'main.typ', mimeType: 'text/plain', content: '#include "frontmatter/title.typ"\n#include "chapters/01-introduction.typ"\n#include "chapters/02-related-work.typ"\n#include "chapters/03-methodology.typ"\n#include "appendices/appendix-a.typ"\n' },
      { path: 'frontmatter/title.typ', mimeType: 'text/plain', content: '= Thesis Title\n\nCandidate Name\n' },
      { path: 'chapters/01-introduction.typ', mimeType: 'text/plain', content: '= Introduction\n\n' },
      { path: 'chapters/02-related-work.typ', mimeType: 'text/plain', content: '= Related Work\n\n' },
      { path: 'chapters/03-methodology.typ', mimeType: 'text/plain', content: '= Methodology\n\n' },
      { path: 'appendices/appendix-a.typ', mimeType: 'text/plain', content: '= Appendix A\n\n' },
    ],
  }),
  buildTemplate({
    id: 'report',
    title: 'Report',
    description: 'A practical project report with milestones, findings, and appendices.',
    category: 'General',
    tags: ['report'],
    styleProfileId: 'report',
    citationStyle: 'numeric',
    requiredSections: ['Summary', 'Scope'],
    mainFilePath: 'main.typ',
    pageLimit: 50,
    files: [{ path: 'main.typ', mimeType: 'text/plain', content: '= Project Report\n\n== Executive Summary\n\n== Scope\n\n== Delivery\n\n== Risks\n\n== Appendix\n' }],
  }),
  buildTemplate({
    id: 'slides',
    title: 'Slides',
    description: 'A presentation starter with a title slide and agenda.',
    category: 'Slides',
    tags: ['touying', 'presentation'],
    styleProfileId: 'slides',
    citationStyle: 'none',
    requiredSections: [],
    mainFilePath: 'main.typ',
    pageLimit: 30,
    files: [{ path: 'main.typ', mimeType: 'text/plain', content: '#import "@preview/touying:0.6.1": *\n\n#show: slides.with()\n\n= Presentation Title\n\n== Agenda\n\n- Topic one\n- Topic two\n- Topic three\n' }],
  }),
  buildTemplate({
    id: 'cv',
    title: 'CV',
    description: 'A structured resume with sections for experience, education, and publications.',
    category: 'Professional',
    tags: ['resume'],
    styleProfileId: 'cv',
    citationStyle: 'none',
    requiredSections: ['Experience', 'Education', 'Publications'],
    mainFilePath: 'main.typ',
    pageLimit: 2,
    files: [{ path: 'main.typ', mimeType: 'text/plain', content: '= Your Name\n\nEmail | Website | City\n\n== Experience\n\n== Education\n\n== Publications\n\n== Skills\n' }],
  }),
  buildTemplate({
    id: 'book',
    title: 'Book',
    description: 'A long-form manuscript with chapters and front matter.',
    category: 'Long-form',
    tags: ['manuscript'],
    styleProfileId: 'book',
    citationStyle: 'chicago',
    requiredSections: ['Preface', 'Chapters'],
    mainFilePath: 'manuscript.typ',
    pageLimit: 500,
    files: [
      { path: 'manuscript.typ', mimeType: 'text/plain', content: '#include "frontmatter/preface.typ"\n#include "chapters/chapter-01.typ"\n#include "chapters/chapter-02.typ"\n' },
      { path: 'frontmatter/preface.typ', mimeType: 'text/plain', content: '= Preface\n\n' },
      { path: 'chapters/chapter-01.typ', mimeType: 'text/plain', content: '= Chapter One\n\n' },
      { path: 'chapters/chapter-02.typ', mimeType: 'text/plain', content: '= Chapter Two\n\n' },
    ],
  }),
  buildAcademicTemplate('ieee', 'IEEE', 'Conference paper scaffold with compact layout and numbered references.', 'ieee', 10, 'ieee', ['Abstract', 'Introduction', 'Method', 'Results', 'Conclusion']),
  buildAcademicTemplate('acm', 'ACM', 'Research paper layout for ACM-style proceedings and journals.', 'acm', 10, 'acm', ['Abstract', 'Introduction', 'Method', 'Results', 'Conclusion']),
  buildAcademicTemplate('springer-lncs', 'Springer LNCS', 'Lecture Notes in Computer Science starter with proceedings-friendly structure.', 'lncs', 12, 'numeric', ['Abstract', 'Introduction', 'Related Work', 'Method', 'Conclusion']),
  buildAcademicTemplate('neurips', 'NeurIPS', 'Machine learning paper template with conference-standard section flow.', 'neurips', 9, 'author-year', ['Abstract', 'Introduction', 'Related Work', 'Method', 'Experiments', 'Conclusion']),
  buildAcademicTemplate('icml', 'ICML', 'ICML-style paper with compact margins and bibliography scaffolding.', 'icml', 9, 'author-year', ['Abstract', 'Introduction', 'Related Work', 'Method', 'Experiments', 'Conclusion']),
  buildAcademicTemplate('cvpr', 'CVPR', 'Computer vision paper starter with numbered sections and references.', 'cvpr', 8, 'ieee', ['Abstract', 'Introduction', 'Related Work', 'Method', 'Experiments', 'Conclusion']),
  buildAcademicTemplate('apa-7', 'APA 7th edition', 'APA manuscript layout with title page, abstract, and references.', 'apa', null, 'apa', ['Abstract', 'Introduction', 'Method', 'Results', 'Discussion', 'References']),
  buildThesisTemplate('mit-thesis', 'MIT Thesis', 'mit-thesis'),
  buildThesisTemplate('eth-thesis', 'ETH Thesis', 'eth-thesis'),
  buildThesisTemplate('uk-eu-thesis', 'UK/EU Thesis', 'uk-eu-thesis'),
  buildTemplate({
    id: 'conference-poster',
    title: 'Conference Poster',
    description: 'Landscape poster board with title, columns, and callout blocks for results.',
    category: 'Poster',
    tags: ['poster', 'conference'],
    styleProfileId: 'poster',
    pageLimit: 1,
    citationStyle: 'none',
    requiredSections: ['Overview', 'Method', 'Results', 'Contact'],
    mainFilePath: 'main.typ',
    files: [{ path: 'main.typ', mimeType: 'text/plain', content: '#set page(width: 48in, height: 36in, margin: 0.8in)\n#set text(size: 28pt)\n\n= Poster Title\n\n== Overview\n\n== Method\n\n== Results\n\n== Contact\n' }],
  }),
  buildTemplate({
    id: 'polylux-slides',
    title: 'Polylux Slides',
    description: 'Polylux-based slide deck with title, section slides, and speaker-note ready structure.',
    category: 'Slides',
    tags: ['polylux', 'slides'],
    styleProfileId: 'polylux',
    pageLimit: 30,
    citationStyle: 'none',
    requiredSections: ['Motivation', 'Approach', 'Results', 'Questions'],
    mainFilePath: 'main.typ',
    files: [{ path: 'main.typ', mimeType: 'text/plain', content: '#import "@preview/polylux:0.4.0": *\n#show: polylux-theme()\n\n= Talk Title\n\n== Motivation\n\n== Approach\n\n== Results\n\n== Questions\n' }],
  }),
]

function buildTemplate(input: Omit<TemplateDefinition, 'kind' | 'voteCount' | 'currentUserVote' | 'authorName' | 'publishedAt'>): TemplateDefinition {
  return {
    ...input,
    kind: 'built-in',
    voteCount: 0,
    currentUserVote: 0,
    authorName: 'Typstr',
    publishedAt: null,
  }
}

function buildAcademicTemplate(
  id: string,
  title: string,
  description: string,
  styleProfileId: string,
  pageLimit: number | null,
  citationStyle: string | null,
  requiredSections: string[],
): TemplateDefinition {
  const mainSource = id === 'ieee'
    ? `#import "@preview/charged-ieee:0.1.4": ieee

#show: ieee.with(
  title: [${title} Title],
  abstract: [Write the abstract here.],
  index-terms: ([IEEE], [Typst], [Template]),
  bibliography: bibliography("references.bib"),
)

= Introduction

= Related Work

= Method

= Results

= Conclusion
`
    : id === 'acm'
      ? `#import "@preview/clean-acmart:0.0.1": acmart, acmart-keywords

#show: acmart.with(
  title: [${title} Title],
  authors: (
    (name: [Author Name], email: [author@example.com]),
  ),
  affiliations: (
    (name: [Institution Name], department: [Department Name]),
  ),
  conference: (
    name: [Conference Name],
    short: [CONF '26],
    year: [2026],
    date: [Month DD--DD],
    venue: [City, Country],
  ),
  doi: "https://doi.org/10.1145/0000000000",
)

= Abstract

Write the abstract here.

#acmart-keywords(("keyword-1", "keyword-2"))

= Introduction

= Related Work

= Method

= Results

= Conclusion

#bibliography("references.bib", style: "association-for-computing-machinery")
`
      : `#set page(margin: 1in)
#set text(size: 10pt)

= ${title} Title

Author Name\\
Institution

== Abstract

Write the abstract here.

== Introduction

== Related Work

== Method

== Results

== Conclusion

#bibliography("references.bib")
`

  return buildTemplate({
    id,
    title,
    description,
    category: 'Academic styles',
    tags: ['academic', styleProfileId],
    styleProfileId,
    citationStyle,
    pageLimit,
    requiredSections,
    mainFilePath: 'main.typ',
    files: [
      {
        path: 'main.typ',
        mimeType: 'text/plain',
        content: mainSource,
      },
      {
        path: 'references.bib',
        mimeType: 'text/plain',
        content: '@inproceedings{example,\n  title = {Example Paper},\n  author = {Doe, Jane},\n  booktitle = {Conference Proceedings},\n  year = {2025}\n}\n',
      },
    ],
  })
}

function buildThesisTemplate(id: string, title: string, styleProfileId: string): TemplateDefinition {
  return buildTemplate({
    id,
    title,
    description: `${title} front matter, declaration, and chapter structure with appendices.`,
    category: 'University theses',
    tags: ['thesis', styleProfileId],
    styleProfileId,
    citationStyle: 'author-year',
    pageLimit: null,
    requiredSections: ['Abstract', 'Introduction', 'Related Work', 'Methodology', 'Conclusion'],
    mainFilePath: 'main.typ',
    files: [
      { path: 'main.typ', mimeType: 'text/plain', content: '#include "frontmatter/title.typ"\n#include "frontmatter/abstract.typ"\n#include "chapters/01-introduction.typ"\n#include "chapters/02-related-work.typ"\n#include "chapters/03-methodology.typ"\n#include "chapters/04-conclusion.typ"\n#include "appendices/appendix-a.typ"\n' },
      { path: 'frontmatter/title.typ', mimeType: 'text/plain', content: `= ${title}\n\nCandidate Name\nDepartment\nUniversity\n` },
      { path: 'frontmatter/abstract.typ', mimeType: 'text/plain', content: '= Abstract\n\nSummarize your thesis contribution here.\n' },
      { path: 'chapters/01-introduction.typ', mimeType: 'text/plain', content: '= Introduction\n\n' },
      { path: 'chapters/02-related-work.typ', mimeType: 'text/plain', content: '= Related Work\n\n' },
      { path: 'chapters/03-methodology.typ', mimeType: 'text/plain', content: '= Methodology\n\n' },
      { path: 'chapters/04-conclusion.typ', mimeType: 'text/plain', content: '= Conclusion\n\n' },
      { path: 'appendices/appendix-a.typ', mimeType: 'text/plain', content: '= Appendix A\n\n' },
    ],
  })
}

function projectTemplateSummary(template: TemplateDefinition): ProjectTemplate {
  const previewSource = template.files.find((file) => file.path === template.mainFilePath)?.content ?? template.files[0]?.content ?? ''
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    previewSnippet: previewSource.split(/\r?\n/).filter((line) => line.trim()).slice(0, 6).join('\n'),
    kind: template.kind,
    category: template.category,
    tags: template.tags,
    styleProfileId: template.styleProfileId,
    citationStyle: template.citationStyle,
    pageLimit: template.pageLimit,
    requiredSections: template.requiredSections,
    voteCount: template.voteCount,
    currentUserVote: template.currentUserVote,
    authorName: template.authorName,
    publishedAt: template.publishedAt,
  }
}

async function listCommunityTemplates(userId?: string): Promise<ProjectTemplate[]> {
  const pool = getDbPool()
  const rows = await pool.query<ProjectTemplatePublicationRow & { score: string | null; current_user_vote: number | null }>(`
    SELECT ptp.*, u.name AS author_name,
           COALESCE(SUM(ptv.vote), 0)::text AS score,
           MAX(CASE WHEN ptv.user_id = $1 THEN ptv.vote ELSE NULL END)::int AS current_user_vote
    FROM project_template_publications ptp
    INNER JOIN users u ON u.id = ptp.author_user_id
    LEFT JOIN project_template_votes ptv ON ptv.template_id = ptp.id
    GROUP BY ptp.id, u.name
    ORDER BY COALESCE(SUM(ptv.vote), 0) DESC, ptp.created_at DESC
  `, [userId ?? null])

  return rows.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    previewSnippet: row.preview_snippet,
    kind: 'community',
    category: row.category,
    tags: parseTemplateTags(row.tags),
    styleProfileId: row.style_profile_id,
    citationStyle: row.citation_style,
    pageLimit: row.page_limit,
    requiredSections: inferSectionsFromFilesJson(row.files_json),
    voteCount: Number(row.score ?? 0),
    currentUserVote: row.current_user_vote === -1 ? -1 : row.current_user_vote === 1 ? 1 : 0,
    authorName: row.author_name,
    publishedAt: row.created_at,
  }))
}

async function getCommunityTemplateDefinition(templateId: string, userId?: string): Promise<TemplateDefinition | null> {
  const pool = getDbPool()
  const result = await pool.query<ProjectTemplatePublicationRow & { author_name: string; score: string | null; current_user_vote: number | null }>(`
    SELECT ptp.*, u.name AS author_name,
           COALESCE(SUM(ptv.vote), 0)::text AS score,
           MAX(CASE WHEN ptv.user_id = $2 THEN ptv.vote ELSE NULL END)::int AS current_user_vote
    FROM project_template_publications ptp
    INNER JOIN users u ON u.id = ptp.author_user_id
    LEFT JOIN project_template_votes ptv ON ptv.template_id = ptp.id
    WHERE ptp.id = $1
    GROUP BY ptp.id, u.name
    LIMIT 1
  `, [templateId, userId ?? null])

  const row = result.rows[0]
  if (!row) {
    return null
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    previewSnippet: row.preview_snippet,
    kind: 'community',
    category: row.category,
    tags: parseTemplateTags(row.tags),
    styleProfileId: row.style_profile_id,
    citationStyle: row.citation_style,
    pageLimit: row.page_limit,
    requiredSections: inferSectionsFromFilesJson(row.files_json),
    voteCount: Number(row.score ?? 0),
    currentUserVote: row.current_user_vote === -1 ? -1 : row.current_user_vote === 1 ? 1 : 0,
    authorName: row.author_name,
    publishedAt: row.created_at,
    mainFilePath: row.main_file_path,
    files: parseTemplateFilesJson(row.files_json),
  }
}

function parseTemplateTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function parseTemplateFilesJson(raw: string): TemplateFileDefinition[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is TemplateFileDefinition =>
          Boolean(entry)
          && typeof entry === 'object'
          && typeof (entry as TemplateFileDefinition).path === 'string'
          && typeof (entry as TemplateFileDefinition).mimeType === 'string'
          && typeof (entry as TemplateFileDefinition).content === 'string')
      : []
  } catch {
    return []
  }
}

function inferSectionsFromFilesJson(raw: string): string[] {
  const files = parseTemplateFilesJson(raw)
  const source = files.map((file) => file.content).join('\n')
  return [...source.matchAll(/^=+\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, 8)
}

export async function listProjectTemplates(userId?: string): Promise<ProjectTemplate[]> {
  const builtIn = PROJECT_TEMPLATES.map((template) => projectTemplateSummary(template))
  const community = await listCommunityTemplates(userId)
  return [...builtIn, ...community].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'community' ? -1 : 1
    }
    if (left.voteCount !== right.voteCount) {
      return right.voteCount - left.voteCount
    }
    return left.title.localeCompare(right.title)
  })
}

export async function listDashboardProjects(userId: string, options?: { cursor?: string; limit?: number }): Promise<ProjectDashboardData> {
  const limit = Math.min(Math.max(1, options?.limit ?? 50), 100)
  const cursor = options?.cursor ? Number(options.cursor) : null

  const projects = await listProjectsForUser(userId)
  const states = await getProjectStates(projects.map((project) => project.id))

  const decorated = projects.map((project) => ({
    ...project,
    state: states.get(project.id) ?? defaultProjectState(),
  }))

  const allActive = decorated
    .filter((project) => !project.state.archivedAt && !project.state.trashedAt)
    .sort(compareDashboardProjects)

  let paginatedActive = allActive
  if (cursor !== null) {
    const idx = allActive.findIndex((p) => {
      const recent = p.state.lastOpenedAt ?? p.updatedAt
      return recent < cursor || (recent === cursor && p.id <= (options?.cursor ?? ''))
    })
    paginatedActive = idx >= 0 ? allActive.slice(idx) : []
  }

  const page = paginatedActive.slice(0, limit)
  const hasMore = paginatedActive.length > limit
  const lastItem = page[page.length - 1]
  const nextCursor = hasMore && lastItem
    ? String(lastItem.state.lastOpenedAt ?? lastItem.updatedAt)
    : null

  return {
    activeProjects: page,
    archivedProjects: decorated
      .filter((project) => Boolean(project.state.archivedAt) && !project.state.trashedAt)
      .sort(compareDashboardProjects),
    trashedProjects: decorated
      .filter((project) => Boolean(project.state.trashedAt))
      .sort(compareDashboardProjects),
    templates: await listProjectTemplates(userId),
    nextCursor,
  }
}

export async function publishProjectTemplate(input: {
  projectId: string
  userId: string
  title: string
  description: string
  category?: string | null
  tags?: string[]
}): Promise<ProjectTemplate> {
  const project = await getProjectById(input.projectId)
  if (!project) {
    throw new Error('Project not found')
  }

  const files = await listProjectFiles(input.projectId)
  const textFiles = files.filter((file) => file.mimeType.startsWith('text/') || /\.(typ|txt|md|yaml|yml|toml|json|bib)$/i.test(file.name))
  const templateFiles: TemplateFileDefinition[] = []
  for (const file of textFiles) {
    const content = await readTextFileFromDrive(project.ownerUserId, file.driveFileId)
    templateFiles.push({
      path: file.path,
      mimeType: file.mimeType,
      content,
    })
  }

  if (templateFiles.length === 0) {
    throw new Error('Project has no text files that can be published as a template')
  }

  const mainFilePath = files.find((file) => file.id === project.mainFileId)?.path ?? templateFiles[0].path
  const previewSource = templateFiles.find((file) => file.path === mainFilePath)?.content ?? templateFiles[0].content
  const now = Date.now()
  const id = `community:${randomUUID()}`
  const state = await getProjectState(input.projectId)
  const sourceTemplate = state.templateId ? await findTemplateSummary(state.templateId, input.userId) : null
  const pool = getDbPool()
  await pool.query(`
    INSERT INTO project_template_publications (
      id, author_user_id, source_project_id, title, description, category, tags,
      preview_snippet, main_file_path, files_json, style_profile_id, citation_style, page_limit, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [
    id,
    input.userId,
    input.projectId,
    input.title,
    input.description,
    input.category?.trim() || sourceTemplate?.category || 'Community',
    JSON.stringify((input.tags ?? sourceTemplate?.tags ?? []).slice(0, 12)),
    previewSource.split(/\r?\n/).filter((line) => line.trim()).slice(0, 6).join('\n'),
    mainFilePath,
    JSON.stringify(templateFiles),
    sourceTemplate?.styleProfileId ?? null,
    sourceTemplate?.citationStyle ?? null,
    sourceTemplate?.pageLimit ?? null,
    now,
    now,
  ])

  const created = await getCommunityTemplateDefinition(id, input.userId)
  if (!created) {
    throw new Error('Failed to publish template')
  }
  return projectTemplateSummary(created)
}

export async function voteOnProjectTemplate(input: {
  templateId: string
  userId: string
  vote: -1 | 0 | 1
}): Promise<ProjectTemplate | null> {
  const pool = getDbPool()
  if (input.vote === 0) {
    await pool.query('DELETE FROM project_template_votes WHERE template_id = $1 AND user_id = $2', [input.templateId, input.userId])
  } else {
    await pool.query(`
      INSERT INTO project_template_votes (template_id, user_id, vote, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (template_id, user_id)
      DO UPDATE SET vote = EXCLUDED.vote, updated_at = EXCLUDED.updated_at
    `, [input.templateId, input.userId, input.vote, Date.now(), Date.now()])
  }

  const updated = await getCommunityTemplateDefinition(input.templateId, input.userId)
  return updated ? projectTemplateSummary(updated) : null
}

export async function createProjectFromTemplate(input: {
  ownerUserId: string
  title: string
  templateId: ProjectTemplateId
  teamId?: string | null
}): Promise<ProjectSummary> {
  const template = await findTemplate(input.templateId, input.ownerUserId)
  const driveFolderId = await createProjectDriveFolder(input.ownerUserId, input.title)
  const project = await createProject({
    ownerUserId: input.ownerUserId,
    title: input.title,
    driveFolderId,
    teamId: input.teamId ?? null,
  })

  await upsertProjectPreferences(project.id, {
    templateId: template.id,
  })

  const folderIds = new Map<string, string>()
  folderIds.set('', driveFolderId)

  const sortedFiles = [...template.files].sort((left, right) => left.path.localeCompare(right.path))
  let mainFileId: string | null = null
  for (const file of sortedFiles) {
    const parentPath = parentDirectoryPath(file.path)
    const parentDriveId = await ensureProjectFolderPath(input.ownerUserId, project.id, driveFolderId, folderIds, parentPath)
    const driveFileId = file.mimeType.startsWith('text/')
      ? await createTextFileInDrive(input.ownerUserId, parentDriveId, path.posix.basename(file.path), file.content)
      : await createBinaryFileInDrive({
          userId: input.ownerUserId,
          parentId: parentDriveId,
          name: path.posix.basename(file.path),
          mimeType: file.mimeType,
          content: Buffer.from(file.content),
        })

    const created = await createProjectFile({
      projectId: project.id,
      name: path.posix.basename(file.path),
      path: file.path,
      mimeType: file.mimeType,
      driveFileId,
    })

    if (file.path === template.mainFilePath) {
      mainFileId = created.id
    }
  }

  if (mainFileId) {
    await setProjectMainFile(project.id, mainFileId)
  }

  return (await getProjectById(project.id)) ?? project
}

export async function importProjectZip(input: {
  ownerUserId: string
  title: string
  zipBuffer: Buffer
}): Promise<ProjectSummary> {
  const zip = await JSZip.loadAsync(input.zipBuffer)
  const entries = Object.values(zip.files).filter((entry) => !entry.name.startsWith('__MACOSX/'))
  const driveFolderId = await createProjectDriveFolder(input.ownerUserId, input.title)
  const project = await createProject({
    ownerUserId: input.ownerUserId,
    title: input.title,
    driveFolderId,
  })

  const folderIds = new Map<string, string>()
  folderIds.set('', driveFolderId)
  const createdFiles: ProjectFile[] = []
  const contentByFileId = new Map<string, string>()

  const fileEntries = entries
    .filter((entry) => !entry.dir)
    .sort((left, right) => left.name.localeCompare(right.name))

  const topLevelPrefix = detectZipTopLevelPrefix(fileEntries.map((e) => e.name))

  for (const entry of fileEntries) {
    const strippedName = topLevelPrefix ? entry.name.slice(topLevelPrefix.length) : entry.name
    const normalizedPath = normalizeZipPath(strippedName)
    if (!normalizedPath || entry.dir) {
      continue
    }

    const name = path.posix.basename(normalizedPath)
    const parentPath = parentDirectoryPath(normalizedPath)
    const parentDriveId = await ensureProjectFolderPath(input.ownerUserId, project.id, driveFolderId, folderIds, parentPath)

    const content = await entry.async('nodebuffer')
    const mimeType = inferProjectFileMimeType(normalizedPath)
    const textContent = mimeType.startsWith('text/') ? content.toString('utf8') : null
    const driveFileId = mimeType.startsWith('text/')
      ? await createTextFileInDrive(input.ownerUserId, parentDriveId, name, textContent ?? '')
      : await createBinaryFileInDrive({ userId: input.ownerUserId, parentId: parentDriveId, name, mimeType, content })

    const createdFile = await createProjectFile({
      projectId: project.id,
      name,
      path: normalizedPath,
      mimeType,
      driveFileId,
    })
    createdFiles.push(createdFile)
    if (textContent !== null) {
      contentByFileId.set(createdFile.id, textContent)
    }
  }

  const mainFile = chooseAutomaticMainFile(createdFiles, contentByFileId)

  await setProjectMainFile(project.id, mainFile?.id ?? null)
  return (await getProjectById(project.id)) ?? project
}

export async function cloneProject(input: {
  sourceProjectId: string
  actorUserId: string
  title: string
  fork: boolean
}): Promise<ProjectSummary> {
  const sourceProject = await getProjectById(input.sourceProjectId)
  if (!sourceProject) {
    throw new Error('Project not found')
  }

  const sourceFiles = await listProjectFiles(input.sourceProjectId)
  const driveFolderId = await createProjectDriveFolder(input.actorUserId, input.title)
  const nextProject = await createProject({
    ownerUserId: input.actorUserId,
    title: input.title,
    driveFolderId,
  })

  const sourceState = await getProjectState(sourceProject.id)
  await upsertProjectPreferences(nextProject.id, {
    templateId: sourceState.templateId,
  })

  const folderIds = new Map<string, string>()
  folderIds.set('', driveFolderId)
  const pathToCreatedFileId = new Map<string, string>()

  const sortedFiles = [...sourceFiles].sort((left, right) => sortFilesByPath(left.path, right.path))
  for (const file of sortedFiles) {
    if (file.path.startsWith(`${TRASH_PATH_PREFIX}/`)) {
      continue
    }

    const parentPath = parentDirectoryPath(file.path)
    const parentDriveId = await ensureProjectFolderPath(input.actorUserId, nextProject.id, driveFolderId, folderIds, parentPath)

    if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      const folderDriveId = await createDriveFolderInDrive(input.actorUserId, parentDriveId, file.name)
      await createProjectFile({
        projectId: nextProject.id,
        name: file.name,
        path: file.path,
        mimeType: file.mimeType,
        driveFileId: folderDriveId,
      })
      folderIds.set(file.path, folderDriveId)
      continue
    }

    const content = await readFileBufferFromDrive(sourceProject.ownerUserId, file.driveFileId)
    const driveFileId = await createBinaryFileInDrive({
      userId: input.actorUserId,
      parentId: parentDriveId,
      name: file.name,
      mimeType: file.mimeType,
      content,
    })
    const createdFile = await createProjectFile({
      projectId: nextProject.id,
      name: file.name,
      path: file.path,
      mimeType: file.mimeType,
      driveFileId,
    })
    pathToCreatedFileId.set(file.path, createdFile.id)
  }

  const mainFile = sortedFiles.find((file) => file.id === sourceProject.mainFileId)
  if (mainFile) {
    await setProjectMainFile(nextProject.id, pathToCreatedFileId.get(mainFile.path) ?? null)
  }

  return (await getProjectById(nextProject.id)) ?? nextProject
}

export async function getProjectState(projectId: string): Promise<ProjectState> {
  await ensureProjectPreferences(projectId)
  const pool = getDbPool()
  const result = await pool.query<ProjectPreferenceRow>(`
    SELECT project_id, is_starred, is_pinned, archived_at, trashed_at, last_opened_at, template_id
    FROM project_preferences
    WHERE project_id = $1
  `, [projectId])

  return result.rows[0] ? rowToProjectState(result.rows[0]) : defaultProjectState()
}

export async function getProjectStates(projectIds: string[]): Promise<Map<string, ProjectState>> {
  const ids = [...new Set(projectIds.filter(Boolean))]
  const map = new Map<string, ProjectState>()
  if (ids.length === 0) {
    return map
  }

  const now = Date.now()
  const pool = getDbPool()
  await pool.query(`
    INSERT INTO project_preferences (project_id, is_starred, is_pinned, created_at, updated_at)
    SELECT id, FALSE, FALSE, $2, $3 FROM unnest($1::text[]) AS id
    ON CONFLICT(project_id) DO NOTHING
  `, [ids, now, now])
  const result = await pool.query<ProjectPreferenceRow>(`
    SELECT project_id, is_starred, is_pinned, archived_at, trashed_at, last_opened_at, template_id
    FROM project_preferences
    WHERE project_id = ANY($1::text[])
  `, [ids])

  for (const row of result.rows) {
    map.set(row.project_id, rowToProjectState(row))
  }
  for (const projectId of ids) {
    if (!map.has(projectId)) {
      map.set(projectId, defaultProjectState())
    }
  }

  return map
}

export async function updateProjectState(projectId: string, patch: Partial<ProjectState>): Promise<ProjectState> {
  const current = await getProjectState(projectId)
  const next: ProjectState = {
    isStarred: patch.isStarred ?? current.isStarred,
    isPinned: patch.isPinned ?? current.isPinned,
    archivedAt: patch.archivedAt === undefined ? current.archivedAt : patch.archivedAt,
    trashedAt: patch.trashedAt === undefined ? current.trashedAt : patch.trashedAt,
    lastOpenedAt: patch.lastOpenedAt === undefined ? current.lastOpenedAt : patch.lastOpenedAt,
    templateId: patch.templateId === undefined ? current.templateId : patch.templateId,
  }

  await upsertProjectPreferences(projectId, next)
  return next
}

export async function markProjectOpened(projectId: string): Promise<void> {
  await updateProjectState(projectId, { lastOpenedAt: Date.now() })
}

export async function enrichProjectDetail(project: ProjectDetail): Promise<ProjectDetail> {
  const [state, fileWorkflows] = await Promise.all([
    getProjectState(project.id),
    listProjectFileWorkflows(project.id),
  ])

  const workflowMap = new Map(fileWorkflows.map((workflow) => [workflow.fileId, workflow] as const))
  const files = project.files.filter((file) => !(workflowMap.get(file.id)?.trashedAt))
  const trashedFiles = project.files.filter((file) => Boolean(workflowMap.get(file.id)?.trashedAt))

  return {
    ...project,
    state,
    files,
    trashedFiles,
    fileWorkflows,
  }
}

export async function listProjectFileWorkflows(projectId: string): Promise<ProjectFileWorkflow[]> {
  const pool = getDbPool()
  const result = await pool.query<ProjectFileWorkflowRow>(`
    SELECT pfw.file_id, pfw.project_id,
           pfw.locked_by_user_id, locked_user.name AS locked_by_name, pfw.locked_at,
           pfw.review_owner_user_id, review_user.name AS review_owner_name, pfw.review_assigned_at,
           pfw.trashed_at, pfw.trashed_original_path
    FROM project_file_workflow pfw
    LEFT JOIN users locked_user ON locked_user.id = pfw.locked_by_user_id
    LEFT JOIN users review_user ON review_user.id = pfw.review_owner_user_id
    WHERE pfw.project_id = $1
    ORDER BY pfw.updated_at DESC
  `, [projectId])

  return result.rows.map(rowToProjectFileWorkflow)
}

export async function getProjectFileWorkflow(fileId: string): Promise<ProjectFileWorkflow | null> {
  const pool = getDbPool()
  const result = await pool.query<ProjectFileWorkflowRow>(`
    SELECT pfw.file_id, pfw.project_id,
           pfw.locked_by_user_id, locked_user.name AS locked_by_name, pfw.locked_at,
           pfw.review_owner_user_id, review_user.name AS review_owner_name, pfw.review_assigned_at,
           pfw.trashed_at, pfw.trashed_original_path
    FROM project_file_workflow pfw
    LEFT JOIN users locked_user ON locked_user.id = pfw.locked_by_user_id
    LEFT JOIN users review_user ON review_user.id = pfw.review_owner_user_id
    WHERE pfw.file_id = $1
    LIMIT 1
  `, [fileId])

  return result.rows[0] ? rowToProjectFileWorkflow(result.rows[0]) : null
}

export async function assertFileWritable(fileId: string, userId: string): Promise<void> {
  const workflow = await getProjectFileWorkflow(fileId)
  if (workflow?.trashedAt) {
    throw new Error('This file is in the trash.')
  }

  if (workflow?.lockedByUserId && workflow.lockedByUserId !== userId) {
    throw new Error(`This file is locked by ${workflow.lockedByName ?? 'another collaborator'}.`)
  }
}

export async function lockProjectFile(fileId: string, projectId: string, userId: string): Promise<ProjectFileWorkflow> {
  const now = Date.now()
  const pool = getDbPool()
  await pool.query(`
    INSERT INTO project_file_workflow (file_id, project_id, locked_by_user_id, locked_at, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(file_id) DO UPDATE
    SET project_id = EXCLUDED.project_id,
        locked_by_user_id = EXCLUDED.locked_by_user_id,
        locked_at = EXCLUDED.locked_at,
        updated_at = EXCLUDED.updated_at
  `, [fileId, projectId, userId, now, now, now])
  return (await getProjectFileWorkflow(fileId))!
}

export async function unlockProjectFile(fileId: string): Promise<ProjectFileWorkflow | null> {
  const now = Date.now()
  const pool = getDbPool()
  await pool.query(`
    INSERT INTO project_file_workflow (file_id, project_id, created_at, updated_at)
    VALUES ($1, (SELECT project_id FROM project_files WHERE id = $1), $2, $3)
    ON CONFLICT(file_id) DO NOTHING
  `, [fileId, now, now])
  await pool.query(`
    UPDATE project_file_workflow
    SET locked_by_user_id = NULL,
        locked_at = NULL,
        updated_at = $2
    WHERE file_id = $1
  `, [fileId, now])
  return getProjectFileWorkflow(fileId)
}

export async function assignProjectFileReviewOwner(fileId: string, projectId: string, userId: string | null): Promise<ProjectFileWorkflow> {
  const now = Date.now()
  const pool = getDbPool()
  await pool.query(`
    INSERT INTO project_file_workflow (file_id, project_id, review_owner_user_id, review_assigned_at, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(file_id) DO UPDATE
    SET project_id = EXCLUDED.project_id,
        review_owner_user_id = EXCLUDED.review_owner_user_id,
        review_assigned_at = EXCLUDED.review_assigned_at,
        updated_at = EXCLUDED.updated_at
  `, [fileId, projectId, userId, userId ? now : null, now, now])
  return (await getProjectFileWorkflow(fileId))!
}

export async function duplicateProjectEntry(projectId: string, fileId: string, actorUserId: string): Promise<ProjectFile[]> {
  const target = await getProjectFileById(fileId)
  const project = await getProjectById(projectId)
  if (!target || !project || target.projectId !== projectId) {
    throw new Error('File not found')
  }

  const allFiles = await listProjectFiles(projectId)
  const entries = target.mimeType === DRIVE_FOLDER_MIME_TYPE
    ? allFiles.filter((file) => file.id === target.id || file.path.startsWith(`${target.path}/`)).sort((left, right) => sortFilesByPath(left.path, right.path))
    : [target]

  const duplicateName = await allocateDuplicateName(allFiles, parentDirectoryPath(target.path), target.name)
  const duplicateBasePath = joinProjectPath(parentDirectoryPath(target.path), duplicateName)
  const created: ProjectFile[] = []
  const driveIds = new Map<string, string>()

  for (const entry of entries) {
    const relativeSuffix = entry.path === target.path ? '' : entry.path.slice(target.path.length)
    const nextPath = `${duplicateBasePath}${relativeSuffix}`
    const nextName = path.posix.basename(nextPath)
    const nextParentPath = parentDirectoryPath(nextPath)
    const parentDriveId = nextParentPath
      ? driveIds.get(nextParentPath) ?? (await requireDriveIdForPath(allFiles, nextParentPath))
      : project.driveFolderId

    if (entry.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      const folderDriveId = await createDriveFolderInDrive(actorUserId, parentDriveId, nextName)
      const folder = await createProjectFile({
        projectId,
        name: nextName,
        path: nextPath,
        mimeType: entry.mimeType,
        driveFileId: folderDriveId,
      })
      driveIds.set(nextPath, folderDriveId)
      created.push(folder)
      continue
    }

    const buffer = await readFileBufferFromDrive(project.ownerUserId, entry.driveFileId)
    const driveFileId = await createBinaryFileInDrive({
      userId: actorUserId,
      parentId: parentDriveId,
      name: nextName,
      mimeType: entry.mimeType,
      content: buffer,
    })
    created.push(await createProjectFile({
      projectId,
      name: nextName,
      path: nextPath,
      mimeType: entry.mimeType,
      driveFileId,
    }))
  }

  return created
}

export async function trashProjectEntry(projectId: string, fileId: string): Promise<void> {
  const target = await getProjectFileById(fileId)
  const project = await getProjectById(projectId)
  if (!target || !project || target.projectId !== projectId) {
    throw new Error('File not found')
  }

  const allFiles = await listProjectFiles(projectId)
  const entries = target.mimeType === DRIVE_FOLDER_MIME_TYPE
    ? allFiles.filter((file) => file.id === target.id || file.path.startsWith(`${target.path}/`))
    : [target]
  const now = Date.now()
  const trashToken = randomUUID().slice(0, 8)
  const pool = getDbPool()
  const trashFolderId = await ensureChildFolderInDrive(project.ownerUserId, project.driveFolderId, TRASH_PATH_PREFIX)
  const trashTokenFolderId = await ensureChildFolderInDrive(project.ownerUserId, trashFolderId, trashToken)

  await moveDriveItem({
    userId: project.ownerUserId,
    fileId: target.driveFileId,
    parentId: trashTokenFolderId,
    name: target.name,
  })

  for (const entry of entries.sort((left, right) => sortFilesByPath(left.path, right.path))) {
    const hiddenPath = `${TRASH_PATH_PREFIX}/${trashToken}/${entry.path}`
    await pool.query('UPDATE project_files SET path = $1, updated_at = $2 WHERE id = $3', [hiddenPath, now, entry.id])
    await pool.query(`
      INSERT INTO project_file_workflow (file_id, project_id, trashed_at, trashed_original_path, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(file_id) DO UPDATE
      SET project_id = EXCLUDED.project_id,
          trashed_at = EXCLUDED.trashed_at,
          trashed_original_path = EXCLUDED.trashed_original_path,
          updated_at = EXCLUDED.updated_at
    `, [entry.id, projectId, now, entry.path, now, now])
  }
}

export async function restoreProjectEntry(projectId: string, fileId: string): Promise<void> {
  const workflow = await getProjectFileWorkflow(fileId)
  const file = await getProjectFileById(fileId)
  const project = await getProjectById(projectId)
  if (!workflow?.trashedAt || !workflow.trashedOriginalPath || !file || !project || file.projectId !== projectId) {
    throw new Error('Trashed file not found')
  }

  const allFiles = await listProjectFiles(projectId)
  const entries = file.mimeType === DRIVE_FOLDER_MIME_TYPE
    ? allFiles.filter((entry) => entry.id === file.id || entry.path.startsWith(`${file.path}/`)).sort((left, right) => sortFilesByPath(left.path, right.path))
    : [file]
  const workflowEntries = new Map((await listProjectFileWorkflows(projectId)).map((entry) => [entry.fileId, entry] as const))
  const now = Date.now()
  const pool = getDbPool()

  const originalParentPath = parentDirectoryPath(workflow.trashedOriginalPath)
  const destinationParentId = originalParentPath
    ? await requireDriveIdForPath(allFiles, originalParentPath)
    : project.driveFolderId

  await moveDriveItem({
    userId: project.ownerUserId,
    fileId: file.driveFileId,
    parentId: destinationParentId,
    name: path.posix.basename(workflow.trashedOriginalPath),
  })

  for (const entry of entries) {
    const entryWorkflow = workflowEntries.get(entry.id)
    const originalPath = entryWorkflow?.trashedOriginalPath
    if (!originalPath) {
      continue
    }

    const conflict = allFiles.find((candidate) => candidate.id !== entry.id && candidate.path === originalPath)
    if (conflict) {
      throw new Error(`Cannot restore ${originalPath} because another file already uses that path.`)
    }

    await pool.query('UPDATE project_files SET path = $1, updated_at = $2 WHERE id = $3', [originalPath, now, entry.id])
    await pool.query(`
      UPDATE project_file_workflow
      SET trashed_at = NULL,
          trashed_original_path = NULL,
          updated_at = $2
      WHERE file_id = $1
    `, [entry.id, now])
  }
}

export async function permanentlyDeleteProjectEntry(projectId: string, fileId: string): Promise<void> {
  const file = await getProjectFileById(fileId)
  if (!file || file.projectId !== projectId) {
    throw new Error('File not found')
  }

  const project = await getProjectById(projectId)
  if (!project) {
    throw new Error('Project not found')
  }

  await deleteDriveItem(project.ownerUserId, file.driveFileId)
  const pool = getDbPool()
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    const descendants = (await listProjectFiles(projectId)).filter((entry) => entry.id === file.id || entry.path.startsWith(`${file.path}/`))
    await pool.query('DELETE FROM project_file_workflow WHERE file_id = ANY($1::text[])', [descendants.map((entry) => entry.id)])
    await pool.query('DELETE FROM project_files WHERE project_id = $1 AND (id = $2 OR path LIKE $3)', [projectId, file.id, `${file.path}/%`])
    return
  }

  await pool.query('DELETE FROM project_file_workflow WHERE file_id = $1', [file.id])
  await pool.query('DELETE FROM project_files WHERE id = $1', [file.id])
}

export async function emptyProjectTrash(projectId: string): Promise<void> {
  const files = await listProjectFiles(projectId)
  const workflows = new Map((await listProjectFileWorkflows(projectId)).map((entry) => [entry.fileId, entry] as const))
  const trashedEntries = files
    .filter((file) => Boolean(workflows.get(file.id)?.trashedAt))
    .sort((left, right) => sortFilesByPath(left.path, right.path))
  const rootEntries = trashedEntries.filter((entry) => !trashedEntries.some((candidate) => candidate.id !== entry.id && entry.path.startsWith(`${candidate.path}/`)))

  for (const entry of rootEntries) {
    await permanentlyDeleteProjectEntry(projectId, entry.id)
  }
}

export async function emptyOwnedProjectTrash(userId: string): Promise<number> {
  const dashboard = await listDashboardProjects(userId)
  const ownedProjects = dashboard.trashedProjects.filter((project) => project.role === 'owner')

  for (const project of ownedProjects) {
    const storedProject = await getProjectById(project.id)
    if (!storedProject) {
      continue
    }

    await deleteDriveItem(storedProject.ownerUserId, storedProject.driveFolderId)
    await deleteProject(storedProject.id)
  }

  return ownedProjects.length
}

export async function listProjectChat(projectId: string): Promise<ProjectChatMessage[]> {
  const pool = getDbPool()
  const result = await pool.query<ProjectChatMessageRow>(`
    SELECT pcm.id, pcm.project_id, pcm.author_user_id, u.name AS author_name, u.avatar_url AS author_avatar_url,
           pcm.content, pcm.created_at, pcm.updated_at
    FROM project_chat_messages pcm
    INNER JOIN users u ON u.id = pcm.author_user_id
    WHERE pcm.project_id = $1
    ORDER BY pcm.created_at ASC
    LIMIT 200
  `, [projectId])

  return result.rows.map(rowToProjectChatMessage)
}

export async function createProjectChat(input: {
  projectId: string
  authorUserId: string
  content: string
}): Promise<ProjectChatMessage> {
  const pool = getDbPool()
  const now = Date.now()
  const id = randomUUID()
  await pool.query(`
    INSERT INTO project_chat_messages (id, project_id, author_user_id, content, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [id, input.projectId, input.authorUserId, input.content, now, now])

  const result = await pool.query<ProjectChatMessageRow>(`
    SELECT pcm.id, pcm.project_id, pcm.author_user_id, u.name AS author_name, u.avatar_url AS author_avatar_url,
           pcm.content, pcm.created_at, pcm.updated_at
    FROM project_chat_messages pcm
    INNER JOIN users u ON u.id = pcm.author_user_id
    WHERE pcm.id = $1
  `, [id])

  return rowToProjectChatMessage(result.rows[0])
}

export async function listProjectReviewSuggestions(projectId: string, fileId: string): Promise<ProjectReviewSuggestion[]> {
  const pool = getDbPool()
  const result = await pool.query<ProjectReviewSuggestionRow>(`
    SELECT prs.id, prs.project_id, prs.file_id, prs.author_user_id, author.name AS author_name, author.avatar_url AS author_avatar_url,
           prs.kind, prs.status, prs.excerpt, prs.replacement_text, prs.start_line, prs.start_column, prs.end_line, prs.end_column,
           prs.decided_by_user_id, decider.name AS decided_by_name, prs.decided_at, prs.created_at, prs.updated_at
    FROM project_review_suggestions prs
    INNER JOIN users author ON author.id = prs.author_user_id
    LEFT JOIN users decider ON decider.id = prs.decided_by_user_id
    WHERE prs.project_id = $1 AND prs.file_id = $2
    ORDER BY prs.created_at DESC
  `, [projectId, fileId])

  return result.rows.map(rowToProjectReviewSuggestion)
}

export async function createProjectReviewSuggestion(input: {
  projectId: string
  fileId: string
  authorUserId: string
  excerpt: string
  replacementText: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}): Promise<ProjectReviewSuggestion> {
  const now = Date.now()
  const id = randomUUID()
  const kind: ProjectReviewSuggestionKind = input.replacementText.trim().length === 0
    ? 'delete'
    : input.excerpt.trim().length === 0
      ? 'insert'
      : 'replace'
  const pool = getDbPool()

  await pool.query(`
    INSERT INTO project_review_suggestions (
      id, project_id, file_id, author_user_id, kind, status, excerpt, replacement_text,
      start_line, start_column, end_line, end_column, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $11, $12, $13)
  `, [
    id,
    input.projectId,
    input.fileId,
    input.authorUserId,
    kind,
    input.excerpt,
    input.replacementText,
    input.startLine,
    input.startColumn,
    input.endLine,
    input.endColumn,
    now,
    now,
  ])

  return (await listProjectReviewSuggestions(input.projectId, input.fileId)).find((suggestion) => suggestion.id === id)!
}

export async function decideProjectReviewSuggestion(input: {
  suggestionId: string
  actorUserId: string
  action: 'accept' | 'reject'
}): Promise<ProjectReviewSuggestion> {
  const pool = getDbPool()
  const result = await pool.query<ProjectReviewSuggestionRow>(`
    SELECT prs.id, prs.project_id, prs.file_id, prs.author_user_id, author.name AS author_name, author.avatar_url AS author_avatar_url,
           prs.kind, prs.status, prs.excerpt, prs.replacement_text, prs.start_line, prs.start_column, prs.end_line, prs.end_column,
           prs.decided_by_user_id, decider.name AS decided_by_name, prs.decided_at, prs.created_at, prs.updated_at
    FROM project_review_suggestions prs
    INNER JOIN users author ON author.id = prs.author_user_id
    LEFT JOIN users decider ON decider.id = prs.decided_by_user_id
    WHERE prs.id = $1
  `, [input.suggestionId])
  const suggestion = result.rows[0]
  if (!suggestion) {
    throw new Error('Suggestion not found')
  }

  const now = Date.now()
  if (input.action === 'accept') {
    await applySuggestionToFile(suggestion)
  }

  await pool.query(`
    UPDATE project_review_suggestions
    SET status = $1,
        decided_by_user_id = $2,
        decided_at = $3,
        updated_at = $4
    WHERE id = $5
  `, [input.action === 'accept' ? 'accepted' : 'rejected', input.actorUserId, now, now, input.suggestionId])

  return (await listProjectReviewSuggestions(suggestion.project_id, suggestion.file_id)).find((entry) => entry.id === input.suggestionId)!
}

async function applySuggestionToFile(suggestion: ProjectReviewSuggestionRow) {
  const storage = await getProjectFileStorage(suggestion.file_id)
  if (!storage) {
    throw new Error('File storage not found')
  }

  const source = await readTextFileFromDrive(storage.ownerUserId, storage.file.driveFileId)
  const from = lineColumnOffset(source, suggestion.start_line, suggestion.start_column)
  const to = lineColumnOffset(source, suggestion.end_line, suggestion.end_column)
  const nextSource = `${source.slice(0, from)}${suggestion.replacement_text}${source.slice(to)}`

  await writeTextFileToDrive(storage.ownerUserId, storage.file.driveFileId, nextSource)
  const document = new Y.Doc()
  document.getText('content').insert(0, nextSource)
  await updateProjectFileCollaborationState(storage.file.id, Y.encodeStateAsUpdate(document))
  await touchProjectFile(storage.file.id)
}

async function upsertProjectPreferences(projectId: string, patch: Partial<ProjectState>) {
  const current = await getProjectState(projectId)
  const now = Date.now()
  const pool = getDbPool()
  await pool.query(`
    INSERT INTO project_preferences (
      project_id, is_starred, is_pinned, archived_at, trashed_at, last_opened_at, template_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT(project_id) DO UPDATE
    SET is_starred = EXCLUDED.is_starred,
        is_pinned = EXCLUDED.is_pinned,
        archived_at = EXCLUDED.archived_at,
        trashed_at = EXCLUDED.trashed_at,
        last_opened_at = EXCLUDED.last_opened_at,
        template_id = EXCLUDED.template_id,
        updated_at = EXCLUDED.updated_at
  `, [
    projectId,
    patch.isStarred ?? current.isStarred,
    patch.isPinned ?? current.isPinned,
    patch.archivedAt === undefined ? current.archivedAt : patch.archivedAt,
    patch.trashedAt === undefined ? current.trashedAt : patch.trashedAt,
    patch.lastOpenedAt === undefined ? current.lastOpenedAt : patch.lastOpenedAt,
    patch.templateId === undefined ? current.templateId : patch.templateId,
    now,
    now,
  ])
}

async function ensureProjectPreferences(projectId: string) {
  const pool = getDbPool()
  const now = Date.now()
  await pool.query(`
    INSERT INTO project_preferences (project_id, is_starred, is_pinned, created_at, updated_at)
    VALUES ($1, FALSE, FALSE, $2, $3)
    ON CONFLICT(project_id) DO NOTHING
  `, [projectId, now, now])
}

function defaultProjectState(): ProjectState {
  return {
    isStarred: false,
    isPinned: false,
    archivedAt: null,
    trashedAt: null,
    lastOpenedAt: null,
    templateId: null,
  }
}

function rowToProjectState(row: ProjectPreferenceRow): ProjectState {
  return {
    isStarred: row.is_starred,
    isPinned: row.is_pinned,
    archivedAt: row.archived_at,
    trashedAt: row.trashed_at,
    lastOpenedAt: row.last_opened_at,
    templateId: row.template_id,
  }
}

function rowToProjectFileWorkflow(row: ProjectFileWorkflowRow): ProjectFileWorkflow {
  return {
    fileId: row.file_id,
    projectId: row.project_id,
    lockedByUserId: row.locked_by_user_id,
    lockedByName: row.locked_by_name,
    lockedAt: row.locked_at,
    reviewOwnerUserId: row.review_owner_user_id,
    reviewOwnerName: row.review_owner_name,
    reviewAssignedAt: row.review_assigned_at,
    trashedAt: row.trashed_at,
    trashedOriginalPath: row.trashed_original_path,
  }
}

function rowToProjectChatMessage(row: ProjectChatMessageRow): ProjectChatMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorAvatarUrl: row.author_avatar_url,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToProjectReviewSuggestion(row: ProjectReviewSuggestionRow): ProjectReviewSuggestion {
  return {
    id: row.id,
    projectId: row.project_id,
    fileId: row.file_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorAvatarUrl: row.author_avatar_url,
    kind: row.kind,
    status: row.status,
    excerpt: row.excerpt,
    replacementText: row.replacement_text,
    startLine: row.start_line,
    startColumn: row.start_column,
    endLine: row.end_line,
    endColumn: row.end_column,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    decidedByUserId: row.decided_by_user_id,
    decidedByName: row.decided_by_name,
  }
}

async function findTemplate(templateId: ProjectTemplateId, userId?: string): Promise<TemplateDefinition> {
  const builtIn = PROJECT_TEMPLATES.find((template) => template.id === templateId)
  if (builtIn) {
    return builtIn
  }

  return (await getCommunityTemplateDefinition(templateId, userId)) ?? PROJECT_TEMPLATES[0]
}

async function findTemplateSummary(templateId: ProjectTemplateId, userId?: string): Promise<ProjectTemplate | null> {
  const template = await findTemplate(templateId, userId)
  return template ? projectTemplateSummary(template) : null
}

async function ensureProjectFolderPath(
  userId: string,
  projectId: string,
  rootDriveId: string,
  folderIds: Map<string, string>,
  folderPath: string | null,
): Promise<string> {
  if (!folderPath) {
    return rootDriveId
  }

  if (folderIds.has(folderPath)) {
    return folderIds.get(folderPath)!
  }

  const segments = folderPath.split('/')
  let runningPath = ''
  let currentDriveId = rootDriveId
  for (const segment of segments) {
    runningPath = runningPath ? `${runningPath}/${segment}` : segment
    if (folderIds.has(runningPath)) {
      currentDriveId = folderIds.get(runningPath)!
      continue
    }

    const folderDriveId = await createDriveFolderInDrive(userId, currentDriveId, segment)
    await createProjectFile({
      projectId,
      name: segment,
      path: runningPath,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      driveFileId: folderDriveId,
    })
    folderIds.set(runningPath, folderDriveId)
    currentDriveId = folderDriveId
  }

  return currentDriveId
}

async function requireDriveIdForPath(files: ProjectFile[], folderPath: string): Promise<string> {
  const folder = files.find((file) => file.path === folderPath && file.mimeType === DRIVE_FOLDER_MIME_TYPE)
  if (!folder) {
    throw new Error(`Folder ${folderPath} not found`)
  }
  return folder.driveFileId
}

async function allocateDuplicateName(files: ProjectFile[], parentPath: string | null, name: string): Promise<string> {
  const extension = path.posix.extname(name)
  const baseName = extension ? name.slice(0, -extension.length) : name
  let attempt = 0
  while (attempt < 100) {
    const candidate = attempt === 0 ? `${baseName}-copy${extension}` : `${baseName}-copy-${attempt + 1}${extension}`
    const candidatePath = joinProjectPath(parentPath, candidate)
    if (!files.some((file) => file.path === candidatePath)) {
      return candidate
    }
    attempt += 1
  }

  throw new Error('Could not allocate a duplicate name')
}

function compareDashboardProjects(left: ProjectSummary & { state: ProjectState }, right: ProjectSummary & { state: ProjectState }): number {
  if (left.state.isPinned !== right.state.isPinned) {
    return left.state.isPinned ? -1 : 1
  }
  if (left.state.isStarred !== right.state.isStarred) {
    return left.state.isStarred ? -1 : 1
  }
  const leftRecent = left.state.lastOpenedAt ?? left.updatedAt
  const rightRecent = right.state.lastOpenedAt ?? right.updatedAt
  return rightRecent - leftRecent
}

function parentDirectoryPath(filePath: string): string | null {
  const parent = path.posix.dirname(filePath)
  return parent === '.' ? null : parent
}

function joinProjectPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name
}

function detectZipTopLevelPrefix(names: string[]): string | null {
  if (names.length === 0) return null
  const firstSegment = (name: string) => name.split('/')[0] + '/'
  const first = firstSegment(names[0])
  if (!names.every((n) => n.startsWith(first))) return null
  return first
}

function normalizeZipPath(input: string): string | null {
  const normalized = path.posix.normalize(input).replace(/^\/+/, '')
  if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.includes('../')) {
    return null
  }

  return normalized
}

function sortFilesByPath(left: string, right: string): number {
  const leftDepth = left.split('/').length
  const rightDepth = right.split('/').length
  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth
  }

  return left.localeCompare(right)
}

export function inferProjectFileMimeType(filePath: string): string {
  if (isProjectTextFilePath(filePath)) {
    return 'text/plain'
  }
  if (/\.pdf$/i.test(filePath)) {
    return 'application/pdf'
  }
  if (/\.(png)$/i.test(filePath)) {
    return 'image/png'
  }
  if (/\.(jpg|jpeg)$/i.test(filePath)) {
    return 'image/jpeg'
  }
  if (/\.gif$/i.test(filePath)) {
    return 'image/gif'
  }
  return 'application/octet-stream'
}

export function isProjectTextFilePath(filePath: string): boolean {
  return /\.(typ|txt|md|bib|json|yaml|yml|toml|csv|xml|svg|tex|ltx|latex|cls|sty|bst|bbx|cbx|def|clo|cfg|csl|log|aux|bbl|blg|toc|lof|lot|out|idx|ind|ilg|fls|fdb_latexmk|synctex)$/i.test(filePath)
}

function lineColumnOffset(source: string, lineNumber: number, column: number): number {
  const lines = source.split(/\r?\n/)
  let offset = 0
  for (let index = 0; index < lines.length; index += 1) {
    const currentLineNumber = index + 1
    if (currentLineNumber === lineNumber) {
      return offset + Math.max(0, Math.min(lines[index]!.length, column - 1))
    }
    offset += lines[index]!.length + 1
  }
  return source.length
}
