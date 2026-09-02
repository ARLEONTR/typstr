import { Router } from 'express'
import path from 'node:path'
import multer from 'multer'
import sharp from 'sharp'
import JSZip from 'jszip'
import * as Y from 'yjs'
import {
  canAccessProject,
  countProjectFiles,
  createProjectComment,
  createProjectCommentReply,
  createProjectNotifications,
  createProjectReviewRequest,
  createProjectFile,
  createOrUpdateProjectInvitation,
  deleteProject,
  deleteProjectComment,
  deleteProjectFile,
  deleteProjectFileTree,
  findUserById,
  findUserByEmail,
  getProjectById,
  getProjectCommentById,
  getProjectDetailForUser,
  getProjectEcosystemSettings,
  getProjectFileById,
  getProjectFileByPath,
  getProjectFileForUser,
  getProjectInvitationById,
  getProjectRole,
  getProjectSummaryForUser,
  listProjectReviewRequests,
  revokeProjectReviewRequest,
  getTeamById,
  isUserOnTeam,
  listProjectMembers,
  listProjectComments,
  listProjectFiles,
  listProjectsForUser,
  moveProjectFile,
  revokeProjectInvitation,
  revokeProjectMember,
  setProjectMainFile,
  updateProjectCompileSettings,
  updateProjectCommentStatus,
  updateProjectReviewRequest,
  updateProjectEcosystemSettings,
  renameProjectFile,
  countProjectFilesInTree,
  touchProjectFile,
  updateProjectFileCollaborationState,
  updateProjectMemberRole,
  updateProjectTeam,
  updateProjectTitle,
  assignProjectComment,
  listCommentsAssignedToUser,
  listCommentsInvolvingUser,
  listProjectCommentsInvolvingUser,
  getSearchableFilesForUser,
  getProjectFileStorage,
} from '../db.js'
import { applySourceToCollaborationState } from '../collaboration.js'
import { getAuthenticatedUser } from '../auth.js'
import { createCollaborationToken } from '../services/collaborationToken.js'
import { emitSharingUpdate, subscribeToSharingUpdates } from '../services/sharingEvents.js'
import { getProjectWorkspaceRevisionId, invalidateProjectWorkspaceCache, invalidateProjectWorkspaceFile, invalidateProjectWorkspaceSubtree, loadProjectWorkspace, loadProjectWorkspaceFiles } from '../services/projectWorkspace.js'
import {
  DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_DOC_MIME_TYPE,
  createBinaryFileInDrive,
  createGoogleDocInDrive,
  ensureGoogleDocsExportFolder,
  ensureChildFolderInDrive,
  shouldUseLocalFileStorage,
  createDriveFolderInDrive,
  createProjectDriveFolder,
  createTextFileInDrive,
  deleteDriveItemPermissionByEmail,
  deleteDriveItem,
  ensureDriveItemPermission,
  ensureUserDriveRootFolder,
  listDriveProjectTree,
  moveDriveItem,
  readFileBufferFromDrive,
  readTextFileFromDrive,
  renameDriveItem,
  upsertBinaryFileInDrive,
  writeTextFileToDrive,
} from '../services/drive.js'
import { updateGoogleDocsDocument } from '../services/googleDocs.js'
import {
  buildPackageSuggestions,
  buildBibliographyFileSummaries,
  buildCslFileSummaries,
  buildProjectWritingStats,
  buildProjectMetadataFiles,
  buildReusableAssets,
  collectCitationRecords,
  collectDuplicateCitationIssues,
  collectProseSuggestions,
  collectReferenceTargets,
  LIBRARY_FOLDER_NAME,
  listProjectFonts,
  normalizeProjectEcosystemSettings,
  PROJECT_FONTS_FOLDER,
  PROJECT_METADATA_FILE_DEFINITIONS,
  PROJECT_INTERNAL_FOLDER,
  TYPOGRAPHY_PACKAGE_CATALOG,
  validateProjectWorkspace,
} from '../services/ecosystem.js'
import { syncDriveProjectTree, syncDriveProjectsForUser, syncDriveProjectsForUserIfStale } from '../services/driveProjects.js'
import { convertLatexWorkspaceToHtmlWithMake4ht, convertLatexWorkspaceToHtmlWithPandoc, convertProjectFormatWithPandoc, convertWorkspaceFilesToTypst } from '../services/exporter.js'
import { collectIncrementalLanguageDiagnostics, collectLanguageDiagnostics, getLanguageServerStatuses, hasIncrementalLanguageDiagnosticsSession, warmLanguageDiagnosticsSession } from '../services/languageServers.js'
import { getTypstPackageBundle } from '../services/typstPackages.js'
import {
  listProjectActivity,
  listProjectFileRevisions,
  logProjectActivity,
  restoreProjectRevision,
  runBackgroundJobAndWait,
  enqueueBackgroundJob,
  updateProjectRevisionLabel,
  createProjectRevisionSnapshot,
} from '../services/reliability.js'
import { ensureTypstPreviewSession, proxyTypstPreviewRequest } from '../services/tinymistPreview.js'
import {
  assertCanCreateProject,
  assertCanAccessRevisionById,
  assertCanInviteCollaborator,
  assertCanUseCompileSettings,
  assertCanUploadBytes,
  assertCanUseCustomFonts,
  assertCanUseManagerRole,
  assertCanUseTrackChanges,
  assertCanUseTypstPackagePins,
  assertCanUseWritingGoals,
  consumeBibliographySearchQuota,
  filterRevisionsForPlan,
} from '../services/billing.js'
import {
  assertFileWritable,
  assignProjectFileReviewOwner,
  cloneProject,
  createProjectChat,
  createProjectFromTemplate,
  createProjectReviewSuggestion,
  decideProjectReviewSuggestion,
  duplicateProjectEntry,
  emptyOwnedProjectTrash,
  emptyProjectTrash,
  enrichProjectDetail,
  getProjectFileWorkflow,
  inferProjectFileMimeType,
  importProjectZip,
  isProjectTextFilePath,
  listDashboardProjects,
  publishProjectTemplate,
  listProjectChat,
  listProjectReviewSuggestions,
  lockProjectFile,
  markProjectOpened,
  permanentlyDeleteProjectEntry,
  restoreProjectEntry,
  trashProjectEntry,
  unlockProjectFile,
  voteOnProjectTemplate,
  updateProjectState as updateProjectFeatureState,
} from '../services/projectFeatures.js'
import type { ProjectCommentPdfAnnotation, ProjectCompileSettings, ProjectEcosystemState, ProjectFile, ProjectFormat, ProjectMember, ProjectRole } from '../types.js'
import { validateString, validateOptionalString, validateEmail, validateArrayLength } from '../validation.js'
import { sendReviewRequestEmail } from '../services/email.js'
import { env } from '../env.js'

const DEFAULT_TYPST_TEMPLATE = `= Untitled Project

This project is stored in Google Drive.
`
const DEFAULT_LATEX_TEMPLATE = `\\documentclass{article}
\\usepackage{cite}
\\title{Untitled Project}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

Write your content here~\\cite{sample2024}.

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`
const IEEE_LATEX_TEMPLATE = `\\documentclass[conference]{IEEEtran}
\\IEEEoverridecommandlockouts
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\def\\BibTeX{{\\rm B\\kern-.05em{\\sc i\\kern-.025em b}\\kern-.08em
    T\\kern-.1667em\\lower.7ex\\hbox{E}\\kern-.125emX}}

\\begin{document}

\\title{IEEE Paper Title}

\\author{\\IEEEauthorblockN{First Author}
\\IEEEauthorblockA{\\textit{Affiliation} \\\\
City, Country \\\\
email@example.com}}

\\maketitle

\\begin{abstract}
Write the abstract here.
\\end{abstract}

\\begin{IEEEkeywords}
keyword1, keyword2, keyword3
\\end{IEEEkeywords}

\\section{Introduction}
Introduce your work here~\\cite{sample2024}.

\\section{Related Work}

\\section{Method}

\\section{Results}

\\section{Conclusion}

\\bibliographystyle{IEEEtran}
\\bibliography{references}

\\end{document}
`
const ACM_LATEX_TEMPLATE = `\\documentclass[sigconf]{acmart}

\\begin{document}

\\title{ACM Paper Title}

\\author{First Author}
\\email{author@example.com}
\\affiliation{%
  \\institution{Institution}
  \\city{City}
  \\country{Country}
}

\\begin{abstract}
Write the abstract here.
\\end{abstract}

\\keywords{keyword1, keyword2}

\\maketitle

\\section{Introduction}
Introduce your work here~\\cite{sample2024}.

\\section{Related Work}

\\section{Method}

\\section{Results}

\\section{Conclusion}

\\bibliographystyle{ACM-Reference-Format}
\\bibliography{references}

\\end{document}
`
const DEFAULT_LATEX_BIB = `% Bibliography — add your references here.
% Delete or replace the sample entry below.

@article{sample2024,
  author    = {Jane Doe and John Smith},
  title     = {A Sample Reference: Replace This with a Real Citation},
  journal   = {Journal of Examples},
  year      = {2024},
  volume    = {1},
  number    = {1},
  pages     = {1--10},
  doi       = {10.0000/example.2024},
}
`

const DEFAULT_GDOC_TEMPLATE = `# Untitled Project

This is a Google Docs style project stored as Markdown.
`

const VALID_MEMBER_ROLES: ProjectRole[] = ['editor', 'viewer']
const VALID_EXPORT_FORMATS = new Set(['pdf', 'docx', 'latex', 'html'])
const VALID_EXPORT_DESTINATIONS = new Set(['download', 'drive'])
const VALID_PROJECT_FORMATS: ProjectFormat[] = ['typst', 'latex', 'gdoc']
const VALID_CREATION_PROJECT_FORMATS: ProjectFormat[] = ['typst', 'latex']
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
const scholarSearchCache = new Map<string, { expiresAt: number; data: unknown[] }>()
const SCHOLAR_SEARCH_CACHE_TTL_MS = 30 * 60 * 1000
const ARXIV_SEARCH_RETRY_DELAYS_MS = [0, 700, 1600]

export const projectsRouter = Router()

projectsRouter.get('/typst-packages/:namespace/:name/:version', async (req, res, next) => {
  try {
    getAuthenticatedUser(req)
    const namespace = typeof req.params.namespace === 'string' ? req.params.namespace : ''
    const name = typeof req.params.name === 'string' ? req.params.name : ''
    const version = typeof req.params.version === 'string' ? req.params.version : ''
    if (!namespace || !name || !version) {
      return res.status(400).json({ error: 'namespace, name, and version are required' })
    }

    const bundle = await getTypstPackageBundle({ namespace, name, version })
    res.json(bundle)
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/dashboard', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    syncDriveProjectsForUserIfStale(user.id).catch(() => {})
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined
    res.json(await listDashboardProjects(user.id, { cursor, limit }))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/publish-template', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const titleResult = validateString(req.body?.title, { maxLength: 255, required: true, label: 'Title' })
    const descriptionResult = validateString(req.body?.description, { maxLength: 1000, required: true, label: 'Description' })
    const categoryResult = validateOptionalString(req.body?.category, { maxLength: 120, label: 'Category' })
    if (!titleResult.valid) return res.status(400).json({ error: titleResult.error })
    if (!descriptionResult.valid) return res.status(400).json({ error: descriptionResult.error })
    if (!categoryResult.valid) return res.status(400).json({ error: categoryResult.error })
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags.filter((entry: unknown): entry is string => typeof entry === 'string').map((entry: string) => entry.trim()).filter(Boolean).slice(0, 12)
      : []

    const template = await publishProjectTemplate({
      projectId: req.params.projectId,
      userId: user.id,
      title: titleResult.value,
      description: descriptionResult.value,
      category: categoryResult.value,
      tags,
    })
    res.status(201).json(template)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/templates/:templateId/vote', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const vote = Number(req.body?.vote)
    if (![1, 0, -1].includes(vote)) {
      return res.status(400).json({ error: 'vote must be -1, 0, or 1' })
    }

    const template = await voteOnProjectTemplate({
      templateId: req.params.templateId,
      userId: user.id,
      vote: vote as -1 | 0 | 1,
    })
    if (!template) {
      return res.status(404).json({ error: 'Template not found' })
    }

    res.json(template)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/trash/empty', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const deletedCount = await emptyOwnedProjectTrash(user.id)
    res.json({ deletedCount })
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/', async (req, res) => {
  const user = getAuthenticatedUser(req)
  syncDriveProjectsForUserIfStale(user.id).catch(() => {})
  res.json(await listProjectsForUser(user.id))
})

projectsRouter.post('/import-zip', upload.single('file'), async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' })
    }

    const titleResult = validateOptionalString(req.body.title, { maxLength: 255, label: 'Title' })
    if (!titleResult.valid) return res.status(400).json({ error: titleResult.error })
    const title = titleResult.value || req.file.originalname.replace(/\.zip$/i, '') || 'Imported Project'
    await assertCanCreateProject(user.id)
    const project = await importProjectZip({
      ownerUserId: user.id,
      title,
      zipBuffer: req.file.buffer,
    })
    await logProjectActivity({
      projectId: project.id,
      actorUserId: user.id,
      type: 'project.import',
      summary: `Imported project ${title} from a ZIP archive.`,
    })

    res.status(201).json(await enrichProjectDetail((await getProjectDetailForUser(project.id, user.id))!))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/sync', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    await syncDriveProjectsForUser(user.id)
    res.json(await listProjectsForUser(user.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const titleResult = validateOptionalString(req.body.title, { maxLength: 255, label: 'Title' })
    if (!titleResult.valid) return res.status(400).json({ error: titleResult.error })
    const title = titleResult.value || 'Untitled Project'
    const projectFormat = normalizeProjectFormat(req.body.projectFormat)
    if (!VALID_CREATION_PROJECT_FORMATS.includes(projectFormat)) {
      return res.status(400).json({ error: 'New projects can only be created as Typst or LaTeX.' })
    }
    const templateId = typeof req.body.templateId === 'string' ? req.body.templateId : 'blank'
    const teamId = typeof req.body.teamId === 'string' && req.body.teamId.trim() ? req.body.teamId.trim() : null
    if (teamId && !(await isUserOnTeam(teamId, user.id))) {
      return res.status(403).json({ error: 'You are not a member of that team workspace' })
    }
    await assertCanCreateProject(user.id)
    const project = projectFormat === 'typst' && templateId !== 'blank'
      ? await createProjectFromTemplate({
          ownerUserId: user.id,
          title,
          templateId: templateId as any,
          teamId,
        })
      : await createProjectFromTemplate({
          ownerUserId: user.id,
          title,
          templateId: 'blank',
          teamId,
        })
    if (projectFormat !== 'typst') {
      await initializeProjectMainFileFormat({
        projectId: project.id,
        ownerUserId: user.id,
        format: projectFormat,
        templateId,
      })
      await updateProjectCompileSettings(project.id, {
        autoCompile: false,
        compileDebounceMs: project.compileSettings.compileDebounceMs,
        defaultExportFormat: projectFormat === 'latex' ? 'latex' : 'docx',
        defaultExportDestination: project.compileSettings.defaultExportDestination,
        pageLimit: project.compileSettings.pageLimit,
      })
    }
    invalidateProjectWorkspaceCache(project.id)
    await logProjectActivity({
      projectId: project.id,
      actorUserId: user.id,
      type: 'project.create',
      summary: `Created project ${title}.`,
      metadata: { templateId, projectFormat },
    })

    res.status(201).json(await enrichProjectDetail((await getProjectDetailForUser(project.id, user.id))!))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/convert', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    if (!(await canAccessProject(projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const project = await getProjectById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const targetFormat = normalizeProjectFormat(req.body.targetFormat)
    const sourceOverride = typeof req.body.source === 'string' ? req.body.source : null
    const downloadOnly = req.body.downloadOnly === true
    const createCopy = req.body.createCopy === true
    const sourceFileId = typeof req.body.sourceFileId === 'string' ? req.body.sourceFileId : project.mainFileId
    if (!sourceFileId) {
      return res.status(400).json({ error: 'No source file selected for conversion' })
    }

    const sourceFile = await getProjectFileForUser(sourceFileId, user.id)
    if (!sourceFile || sourceFile.projectId !== projectId) {
      return res.status(404).json({ error: 'Source file not found' })
    }
    if (sourceFile.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(400).json({ error: 'Source must be a text file' })
    }
    await assertFileWritable(sourceFile.id, user.id)

    const sourceFormat = inferProjectFormatFromPath(sourceFile.path)
    if (!sourceFormat) {
      return res.status(400).json({ error: 'Only .typ, .tex, .md, .markdown, and .txt files can be converted.' })
    }

    if (sourceFormat === targetFormat) {
      return res.json({
        file: sourceFile,
        sourceFormat,
        targetFormat,
        message: 'Source and target format are the same.',
      })
    }

    const sourceContent = sourceOverride ?? await readTextFileFromDrive(project.ownerUserId, sourceFile.driveFileId)

    if (targetFormat === 'gdoc') {
      if (sourceFormat !== 'typst') {
        return res.status(400).json({ error: 'Only Typst sources can be converted into Google Docs documents.' })
      }
      if (downloadOnly) {
        return res.status(400).json({ error: 'Google Docs conversion creates a Drive document and cannot be downloaded directly.' })
      }

      const sourceBaseName = sourceFile.name.replace(/\.[^.]+$/, '') || sourceFile.name
      const projectBaseName = project.title.trim() || 'Untitled Project'
      const targetName = `${projectBaseName}-${sourceBaseName}.gdoc`
      const targetPath = joinProjectPath(parentDirectoryPath(sourceFile.path), targetName)
      const parentFolder = await resolveParentFolder(project.id, project.driveFolderId, parentDirectoryPath(sourceFile.path))
      const usesLocalStorage = await shouldUseLocalFileStorage(project.ownerUserId)
      const gdocParentFolderId = usesLocalStorage
        ? await ensureGoogleDocsExportFolder(project.ownerUserId, projectBaseName)
        : parentFolder.driveFileId
      const assetsFolderId = await ensureChildFolderInDrive(project.ownerUserId, gdocParentFolderId, '.typstr-gdoc-assets')
      const workspace = await loadProjectWorkspace({
        projectId: project.id,
        ownerUserId: project.ownerUserId,
        entryFileId: sourceFile.id,
        entryPath: sourceFile.path,
        sourceOverride: sourceOverride ? { fileId: sourceFile.id, content: sourceOverride } : undefined,
      })

      const existingTargetFile = await getProjectFileByPath(projectId, targetPath)
      if (existingTargetFile && existingTargetFile.mimeType !== GOOGLE_DOC_MIME_TYPE) {
        return res.status(409).json({ error: `A file already exists at ${targetPath}. Remove or rename it before exporting to Google Docs.` })
      }

      const shouldReuseExistingGoogleDoc = existingTargetFile && (!usesLocalStorage || !path.isAbsolute(existingTargetFile.driveFileId))

      if (shouldReuseExistingGoogleDoc && existingTargetFile) {
        const snapshot = await updateGoogleDocsDocument(project.ownerUserId, existingTargetFile.driveFileId, {
          content: sourceContent,
          workspace,
          sourceEntryPath: sourceFile.path,
          assetParentId: assetsFolderId,
        })
        await renameDriveItem(project.ownerUserId, existingTargetFile.driveFileId, targetName.replace(/\.gdoc$/i, ''))
        await touchProjectFile(existingTargetFile.id)
        invalidateProjectWorkspaceFile(projectId, existingTargetFile.id)
        await logProjectActivity({
          projectId,
          actorUserId: user.id,
          type: 'file.update',
          summary: `Updated Google Doc ${existingTargetFile.path} from ${sourceFile.path}.`,
          metadata: { fileId: existingTargetFile.id, sourceFileId: sourceFile.id, sourceFormat, targetFormat, revisionId: snapshot.revisionId },
        })

        return res.json({
          file: {
            ...existingTargetFile,
            name: targetName,
            path: targetPath,
            mimeType: GOOGLE_DOC_MIME_TYPE,
          },
          sourceFormat,
          targetFormat,
          message: `Updated ${targetPath}.`,
          warnings: snapshot.warnings,
        })
      }

      const driveFileId = await createGoogleDocInDrive(project.ownerUserId, gdocParentFolderId, targetName.replace(/\.gdoc$/i, ''))
      const snapshot = await updateGoogleDocsDocument(project.ownerUserId, driveFileId, {
        content: sourceContent,
        workspace,
        sourceEntryPath: sourceFile.path,
        assetParentId: assetsFolderId,
      })
      const createdFile = await createProjectFile({
        projectId: project.id,
        name: targetName,
        path: targetPath,
        mimeType: GOOGLE_DOC_MIME_TYPE,
        driveFileId,
      })

      invalidateProjectWorkspaceFile(projectId, createdFile.id)
      await logProjectActivity({
        projectId,
        actorUserId: user.id,
        type: 'file.create',
        summary: `Created Google Doc ${createdFile.path} from ${sourceFile.path}.`,
        metadata: { fileId: createdFile.id, sourceFileId: sourceFile.id, sourceFormat, targetFormat, revisionId: snapshot.revisionId },
      })

      return res.status(201).json({
        file: createdFile,
        sourceFormat,
        targetFormat,
        message: `Created ${createdFile.path}.`,
        warnings: snapshot.warnings,
      })
    }

    const converted = await convertProjectFormatWithPandoc(sourceContent, sourceFormat, targetFormat)
    const extension = extensionForProjectFormat(targetFormat)
    const sourceExt = path.posix.extname(sourceFile.name)
    const targetName = sourceExt ? `${sourceFile.name.slice(0, -sourceExt.length)}${extension}` : `${sourceFile.name}${extension}`
    const targetPath = path.posix.join(path.posix.dirname(sourceFile.path), targetName).replace(/^\.\//, '')
    if (downloadOnly) {
      return res.json({
        sourceFormat,
        targetFormat,
        fileName: targetName,
        targetPath,
        content: converted,
      })
    }

    if (createCopy) {
      const uniqueTargetName = await ensureUniqueProjectName(projectId, parentDirectoryPath(sourceFile.path), targetName)
      const uniqueTargetPath = joinProjectPath(parentDirectoryPath(sourceFile.path), uniqueTargetName)
      const parentFolder = await resolveParentFolder(project.id, project.driveFolderId, parentDirectoryPath(sourceFile.path))
      const driveFileId = await createTextFileInDrive(project.ownerUserId, parentFolder.driveFileId, uniqueTargetName, converted)
      const createdFile = await createProjectFile({
        projectId: project.id,
        name: uniqueTargetName,
        path: uniqueTargetPath,
        mimeType: 'text/plain',
        driveFileId,
      })

      const createdState = applySourceToCollaborationState(null, converted)
      await updateProjectFileCollaborationState(createdFile.id, createdState)

      invalidateProjectWorkspaceFile(projectId, createdFile.id)
      await logProjectActivity({
        projectId,
        actorUserId: user.id,
        type: 'file.create',
        summary: `Created ${createdFile.path} from ${sourceFile.path}.`,
        metadata: { fileId: createdFile.id, sourceFileId: sourceFile.id, sourceFormat, targetFormat },
      })

      return res.status(201).json({
        file: createdFile,
        sourceFormat,
        targetFormat,
        message: `Created ${createdFile.path}.`,
      })
    }

    const conflictingFile = await getProjectFileByPath(projectId, targetPath)
    if (conflictingFile && conflictingFile.id !== sourceFile.id) {
      return res.status(409).json({ error: `A file already exists at ${targetPath}. Rename or remove it first.` })
    }

    await writeTextFileToDrive(project.ownerUserId, sourceFile.driveFileId, converted)
    if (sourceFile.name !== targetName) {
      await renameDriveItem(project.ownerUserId, sourceFile.driveFileId, targetName)
      await renameProjectFile(sourceFile.id, targetName, targetPath)
    }
    await touchProjectFile(sourceFile.id)

    const sourceStorage = await getProjectFileStorage(sourceFile.id)
    const updatedState = applySourceToCollaborationState(sourceStorage?.collaborationState ?? null, converted)
    await updateProjectFileCollaborationState(sourceFile.id, updatedState)

    invalidateProjectWorkspaceFile(projectId, sourceFile.id)
    await logProjectActivity({
      projectId,
      actorUserId: user.id,
      type: 'file.edit',
      summary: `Converted ${sourceFile.path} from ${sourceFormat} to ${targetFormat}.`,
      metadata: { fileId: sourceFile.id, sourceFormat, targetFormat, targetPath },
    })

    const updatedFile = await getProjectFileById(sourceFile.id)
    res.json({
      file: updatedFile,
      sourceFormat,
      targetFormat,
      targetPath: updatedFile?.path ?? targetPath,
    })
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/preview-html', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const source = typeof req.body.source === 'string' ? req.body.source : ''
    if (!source.trim()) {
      return res.status(400).json({ error: 'source must be a non-empty string' })
    }

    if (source.length > 2_000_000) {
      return res.status(400).json({ error: 'Source must be at most 2000000 characters' })
    }

    const sourceFormat = normalizeProjectFormat(req.body.sourceFormat)
    if (sourceFormat !== 'latex') {
      return res.status(400).json({ error: 'Only latex web preview is currently supported.' })
    }

    const entryFilePath = typeof req.body.entryFilePath === 'string' && req.body.entryFilePath.trim()
      ? req.body.entryFilePath.trim()
      : 'main.tex'
    const activeFileId = typeof req.body.activeFileId === 'string' && req.body.activeFileId.trim()
      ? req.body.activeFileId.trim()
      : null
    const activeSource = typeof req.body.activeSource === 'string'
      ? req.body.activeSource
      : null
    const preferredEngine = req.body.preferredEngine === 'pandoc' || req.body.preferredEngine === 'make4ht'
      ? req.body.preferredEngine as 'pandoc' | 'make4ht'
      : null
    const project = await getProjectById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const files = await listProjectFiles(projectId)
    const entryFile = files.find((file) => normalizeProjectRelativePath(file.path) === normalizeProjectRelativePath(entryFilePath))
    const workspaceFiles = await loadProjectWorkspaceFiles({
      projectId,
      ownerUserId: project.ownerUserId,
      sourceOverride: entryFile ? { fileId: entryFile.id, content: source } : undefined,
      additionalOverrides: activeFileId && activeSource !== null && activeFileId !== entryFile?.id
        ? [{ fileId: activeFileId, content: activeSource }]
        : undefined,
    })

    let html: string
    let engine: 'make4ht' | 'pandoc' = preferredEngine ?? 'make4ht'
    if (preferredEngine === 'pandoc') {
      engine = 'pandoc'
      try {
        html = await convertLatexWorkspaceToHtmlWithPandoc({
          entryPath: entryFilePath,
          files: workspaceFiles,
        })
      } catch (pandocError) {
        console.warn('[preview-html] pandoc failed, returning preview error document:', pandocError instanceof Error ? pandocError.message : String(pandocError))
        html = buildLatexPreviewErrorHtml(pandocError)
      }
    } else {
      try {
        html = await convertLatexWorkspaceToHtmlWithMake4ht({
          entryPath: entryFilePath,
          files: workspaceFiles,
        })
      } catch (make4htError) {
        console.warn('[preview-html] make4ht failed, falling back to pandoc:', make4htError instanceof Error ? make4htError.message : String(make4htError))
        engine = 'pandoc'
        try {
          html = await convertLatexWorkspaceToHtmlWithPandoc({
            entryPath: entryFilePath,
            files: workspaceFiles,
          })
        } catch (pandocError) {
          console.warn('[preview-html] pandoc fallback failed, returning preview error document:', pandocError instanceof Error ? pandocError.message : String(pandocError))
          html = buildLatexPreviewErrorHtml(pandocError, make4htError)
        }
      }
    }
    const htmlWithResolvedAssets = rewritePreviewHtmlAssetUrls(html, projectId, entryFilePath, files)
    const htmlWithLayoutHints = applyLatexPreviewLayoutHints(source, htmlWithResolvedAssets)
    res.json({ html: htmlWithLayoutHints, engine })
  } catch (error) {
    next(error)
  }
})

function rewritePreviewHtmlAssetUrls(
  html: string,
  projectId: string,
  entryFilePath: string,
  files: Array<{ id: string; path: string; mimeType: string }>,
): string {
  const fileByPath = new Map<string, { id: string; mimeType: string }>()
  for (const file of files) {
    fileByPath.set(normalizeProjectRelativePath(file.path), { id: file.id, mimeType: file.mimeType })
  }

  const entryDir = path.posix.dirname(normalizeProjectRelativePath(entryFilePath))
  const replaceAttr = (attribute: 'src' | 'href', input: string) => {
    const pattern = new RegExp(`\\b${attribute}=(\"([^\"]*)\"|'([^']*)')`, 'gi')
    return input.replace(pattern, (full, quoted, dqValue, sqValue) => {
      const rawValue = (dqValue ?? sqValue ?? '').trim()
      if (!rawValue || isExternalPreviewUrl(rawValue)) {
        return full
      }

      const resolvedPath = normalizeProjectRelativePath(path.posix.resolve('/', entryDir, rawValue).replace(/^\//, ''))
      const file = fileByPath.get(resolvedPath)
      if (!file) {
        return full
      }

      const replacement = `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file.id)}/content`
      return `${attribute}=${quoted[0]}${replacement}${quoted[0]}`
    })
  }

  const withResolvedUrls = replaceAttr('href', replaceAttr('src', html))
  return rewritePreviewHtmlEmbeddedPdfs(withResolvedUrls, projectId, entryDir, fileByPath)
}

function buildLatexPreviewErrorHtml(primaryError: unknown, fallbackError?: unknown): string {
  const primaryMessage = escapePreviewErrorMessage(primaryError)
  const fallbackMessage = fallbackError ? escapePreviewErrorMessage(fallbackError) : null

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>Preview unavailable</title>',
    '  <style>',
    '    body { margin: 0; padding: 24px; background: #ffffff; color: #111827; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
    '    .card { max-width: 900px; margin: 0 auto; border: 1px solid #fecaca; background: #fff7f7; border-radius: 12px; padding: 20px 22px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06); }',
    '    h1 { margin: 0 0 10px; font-size: 18px; color: #991b1b; }',
    '    p { margin: 0 0 12px; }',
    '    pre { margin: 0; padding: 12px 14px; background: #111827; color: #f8fafc; border-radius: 8px; overflow: auto; white-space: pre-wrap; word-break: break-word; }',
    '    .label { display: inline-block; margin: 10px 0 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #7f1d1d; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="card">',
    '    <h1>Web preview is temporarily unavailable</h1>',
    '    <p>The LaTeX preview renderer hit a parse error while processing the current document state. This often happens temporarily while a citation, command, or environment is still incomplete.</p>',
    '    <div class="label">Current parser error</div>',
    `    <pre>${primaryMessage}</pre>`,
    fallbackMessage ? '    <div class="label">Earlier fallback error</div>' : '',
    fallbackMessage ? `    <pre>${fallbackMessage}</pre>` : '',
    '  </div>',
    '</body>',
    '</html>',
  ].filter(Boolean).join('\n')
}

function escapePreviewErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown preview error')
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function rewritePreviewHtmlEmbeddedPdfs(
  html: string,
  projectId: string,
  entryDir: string,
  fileByPath: Map<string, { id: string; mimeType: string }>,
): string {
  const resolvePreviewFile = (rawValue: string): { id: string; mimeType: string } | null => {
    if (!rawValue || isExternalPreviewUrl(rawValue)) {
      return null
    }

    const resolvedPath = normalizeProjectRelativePath(path.posix.resolve('/', entryDir, rawValue).replace(/^\//, ''))
    return fileByPath.get(resolvedPath) ?? null
  }

  const buildPdfFigureReplacement = (fileId: string, label: string) => {
    const thumbnailUrl = `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/thumbnail?width=1400&format=png`
    const contentUrl = `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/content`
    return [
      '<figure class="typstr-pdf-figure">',
      `  <a href="${contentUrl}" target="_blank" rel="noreferrer">`,
      `    <img src="${thumbnailUrl}" alt="${escapeHtmlAttribute(label)}" loading="lazy" />`,
      '  </a>',
      `  <figcaption>${escapeHtmlText(label)} (PDF preview)</figcaption>`,
      '</figure>',
    ].join('')
  }

  let nextHtml = html.replace(/<object\b[^>]*\bdata=("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/object>/gi, (full, _quoted, dqValue, sqValue) => {
    const rawValue = (dqValue ?? sqValue ?? '').trim()
    const file = resolvePreviewFile(rawValue)
    if (!file || file.mimeType !== 'application/pdf') {
      return full
    }
    return buildPdfFigureReplacement(file.id, path.posix.basename(rawValue) || 'Embedded PDF figure')
  })

  nextHtml = nextHtml.replace(/<embed\b[^>]*\bsrc=("([^"]*)"|'([^']*)')[^>]*>/gi, (full, _quoted, dqValue, sqValue) => {
    const rawValue = (dqValue ?? sqValue ?? '').trim()
    const file = resolvePreviewFile(rawValue)
    if (!file || file.mimeType !== 'application/pdf') {
      return full
    }
    return buildPdfFigureReplacement(file.id, path.posix.basename(rawValue) || 'Embedded PDF figure')
  })

  nextHtml = nextHtml.replace(/<iframe\b[^>]*\bsrc=("([^"]*)"|'([^']*)')[^>]*><\/iframe>/gi, (full, _quoted, dqValue, sqValue) => {
    const rawValue = (dqValue ?? sqValue ?? '').trim()
    const file = resolvePreviewFile(rawValue)
    if (!file || file.mimeType !== 'application/pdf') {
      return full
    }
    return buildPdfFigureReplacement(file.id, path.posix.basename(rawValue) || 'Embedded PDF figure')
  })

  return nextHtml
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeProjectRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return path.posix.normalize(normalized)
}

function isExternalPreviewUrl(value: string): boolean {
  const lowered = value.toLowerCase()
  return lowered.startsWith('http://')
    || lowered.startsWith('https://')
    || lowered.startsWith('data:')
    || lowered.startsWith('blob:')
    || lowered.startsWith('#')
    || lowered.startsWith('//')
}

function applyLatexPreviewLayoutHints(source: string, html: string): string {
  const usesTwoColumn = detectTwoColumnLatexLayout(source)
  const styleBlock = [
    '<style data-typstr-layout-hint="latex-web-preview">',
    'html, body { margin: 0; padding: 0; }',
    'body {',
    '  max-width: 1180px;',
    '  margin: 0 auto;',
    '  padding: 28px 32px 40px;',
    '  color: #111827;',
    '  background: #ffffff;',
    '  font-family: "Latin Modern Roman", "CMU Serif", "Times New Roman", serif;',
    '  line-height: 1.45;',
    '}',
    'main, article, .body, .content, #content { max-width: 100%; }',
    'p { orphans: 3; widows: 3; }',
    'img, svg, table, pre, figure {',
    '  max-width: 100%;',
    '  height: auto;',
    '}',
    'figure, table, pre, blockquote {',
    '  break-inside: avoid;',
    '  page-break-inside: avoid;',
    '}',
    'figure { margin: 1rem 0; text-align: center; }',
    'figcaption { font-size: 0.95rem; color: #374151; margin-top: 0.5rem; }',
    '.typstr-pdf-figure img { display: block; width: 100%; max-width: min(100%, 720px); margin: 0 auto; border: 1px solid #d1d5db; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08); }',
    'table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }',
    'th, td { border: 1px solid #d1d5db; padding: 0.35rem 0.5rem; vertical-align: top; }',
    'blockquote { border-left: 3px solid #d1d5db; margin: 1rem 0; padding: 0.25rem 0 0.25rem 1rem; color: #374151; }',
    'a { color: #1d4ed8; text-decoration: none; }',
    'a:hover { text-decoration: underline; }',
    'h1, h2, h3, h4, h5, h6 { break-after: avoid; color: #111827; line-height: 1.2; }',
    'h1.title { text-align: center; margin-bottom: 0.4rem; }',
    '.author, .date { text-align: center; color: #4b5563; }',
    '.abstract, .abstract p { font-size: 0.96rem; }',
    '.references, #refs { margin-top: 2rem; }',
    '#refs .csl-entry, .references li { margin-bottom: 0.55rem; }',
    usesTwoColumn
      ? 'body { column-count: 2; column-gap: 2.25rem; column-fill: balance; }'
      : 'body { column-count: 1; }',
    usesTwoColumn
      ? 'h1.title, .author, .date, .abstract, .bibliography, .references, #refs, figure, table { column-span: all; }'
      : '',
    usesTwoColumn
      ? 'h1, h2, h3, h4, h5, h6, p, ul, ol { break-inside: avoid-column; }'
      : '',
    '@media (max-width: 900px) { body { column-count: 1 !important; padding: 18px 16px 24px; } }',
    '</style>',
  ].join('')

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${styleBlock}`)
  }

  return `${styleBlock}${html}`
}

function detectTwoColumnLatexLayout(source: string): boolean {
  const documentClassMatch = source.match(/\\documentclass\s*(\[([^\]]*)\])?\s*\{([^}]+)\}/i)
  const options = (documentClassMatch?.[2] ?? '').toLowerCase().split(',').map((part) => part.trim()).filter(Boolean)
  const className = (documentClassMatch?.[3] ?? '').toLowerCase().trim()
  const lowerSource = source.toLowerCase()

  if (options.includes('twocolumn') || /\\twocolumn\b/i.test(source)) {
    return true
  }

  if (className === 'ieeetran') {
    return true
  }

  if (className === 'acmart' && options.some((option) => /^(sigconf|siggraph|sigplan|sigchi|acmcp)$/i.test(option))) {
    return true
  }

  return /\\begin\{multicols\}\{2\}/i.test(source) || lowerSource.includes('conference') && className === 'llncs'
}

projectsRouter.post('/:projectId/language-diagnostics', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const fileId = typeof req.body.fileId === 'string' ? req.body.fileId : ''
    const source = typeof req.body.source === 'string' ? req.body.source : ''
    const documentFormat = normalizeProjectFormat(req.body.documentFormat)
    if (!fileId || !source.trim()) {
      return res.status(400).json({ error: 'fileId and source are required' })
    }
    if (documentFormat !== 'typst' && documentFormat !== 'latex') {
      return res.status(400).json({ error: 'documentFormat must be typst or latex' })
    }

    const file = await getProjectFileForUser(fileId, user.id)
    if (!file || file.projectId !== projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    const workspaceRevisionId = getProjectWorkspaceRevisionId(projectId)
    const workspaceKey = `${projectId}:${documentFormat}`
    const canUseIncrementalSession = hasIncrementalLanguageDiagnosticsSession(workspaceKey, workspaceRevisionId)

    if (canUseIncrementalSession) {
      const incrementalResult = await collectIncrementalLanguageDiagnostics({
        format: documentFormat,
        activeFilePath: file.path,
        activeFileContent: source,
        workspaceKey,
        workspaceRevisionId,
      })
      if (incrementalResult) {
        return res.json(incrementalResult)
      }
    }

    const workspace = await loadProjectWorkspace({
      projectId,
      ownerUserId: file.ownerUserId,
      entryFileId: file.id,
      entryPath: file.path,
      sourceOverride: {
        fileId: file.id,
        content: source,
      },
    })

    const result = await collectLanguageDiagnostics({
      format: documentFormat,
      workspace,
      activeFilePath: file.path,
      workspaceKey,
    })

    res.json(result)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/language-diagnostics-session', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const fileId = typeof req.body.fileId === 'string' ? req.body.fileId : ''
    const source = typeof req.body.source === 'string' ? req.body.source : ''
    const documentFormat = normalizeProjectFormat(req.body.documentFormat)
    if (!fileId || !source.trim()) {
      return res.status(400).json({ error: 'fileId and source are required' })
    }
    if (documentFormat !== 'typst' && documentFormat !== 'latex') {
      return res.status(400).json({ error: 'documentFormat must be typst or latex' })
    }

    const file = await getProjectFileForUser(fileId, user.id)
    if (!file || file.projectId !== projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    const workspaceKey = `${projectId}:${documentFormat}`
    const workspace = await loadProjectWorkspace({
      projectId,
      ownerUserId: file.ownerUserId,
      entryFileId: file.id,
      entryPath: file.path,
      sourceOverride: {
        fileId: file.id,
        content: source,
      },
    })

    const result = await warmLanguageDiagnosticsSession({
      format: documentFormat,
      workspace,
      activeFilePath: file.path,
      workspaceKey,
    })

    res.json(result)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/typst-preview-session', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const fileId = typeof req.body.fileId === 'string' ? req.body.fileId : ''
    const source = typeof req.body.source === 'string' ? req.body.source : ''
    const activeFileId = typeof req.body.activeFileId === 'string' ? req.body.activeFileId : ''
    const activeSource = typeof req.body.activeSource === 'string' ? req.body.activeSource : ''
    const sessionId = typeof req.body.sessionId === 'string' && req.body.sessionId.trim()
      ? req.body.sessionId.trim()
      : `preview:${projectId}:${fileId}`

    if (!fileId || !source.trim()) {
      return res.status(400).json({ error: 'fileId and source are required' })
    }

    const file = await getProjectFileForUser(fileId, user.id)
    if (!file || file.projectId !== projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    // When editing a sub-file, the frontend sends activeFileId + activeSource so
    // the workspace mirror reflects unsaved changes in the sub-file immediately.
    const additionalOverrides: Array<{ fileId: string; content: string }> = []
    if (activeFileId && activeSource && activeFileId !== fileId) {
      const activeFile = await getProjectFileForUser(activeFileId, user.id)
      if (activeFile && activeFile.projectId === projectId) {
        additionalOverrides.push({ fileId: activeFileId, content: activeSource })
      }
    }

    const workspace = await loadProjectWorkspace({
      projectId,
      ownerUserId: file.ownerUserId,
      entryFileId: file.id,
      entryPath: file.path,
      sourceOverride: {
        fileId: file.id,
        content: source,
      },
      additionalOverrides: additionalOverrides.length > 0 ? additionalOverrides : undefined,
    })

    const descriptor = await ensureTypstPreviewSession({
      projectId,
      sessionId,
      workspace,
    })

    res.json({
      ...descriptor,
      statuses: getLanguageServerStatuses(),
    })
  } catch (error) {
    next(error)
  }
})

projectsRouter.all('/:projectId/tinymist-preview/:sessionId', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }
    await proxyTypstPreviewRequest(req, res)
  } catch (error) {
    next(error)
  }
})

projectsRouter.all('/:projectId/tinymist-preview/:sessionId/*path', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }
    await proxyTypstPreviewRequest(req, res)
  } catch (error) {
    next(error)
  }
})

projectsRouter.patch('/:projectId/workspace', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const role = await getProjectRole(req.params.projectId, user.id)
    if (role !== 'owner' && role !== 'manager') {
      return res.status(403).json({ error: 'Owner or manager access required' })
    }

    const teamId = typeof req.body.teamId === 'string' && req.body.teamId.trim() ? req.body.teamId.trim() : null
    if (teamId) {
      const team = await getTeamById(teamId)
      if (!team || !(await isUserOnTeam(teamId, user.id))) {
        return res.status(404).json({ error: 'Team workspace not found' })
      }
    }

    await updateProjectTeam(req.params.projectId, teamId)
    res.json(await getProjectSummaryForUser(req.params.projectId, user.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/my-tasks', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const comments = await listCommentsInvolvingUser(user.id)
  res.json(comments)
})

projectsRouter.get('/search', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (query.length < 3) {
      return res.json({ results: [] })
    }

    const lowerQuery = query.toLowerCase()
    const files = await getSearchableFilesForUser(user.id, 500)

    const MAX_RESULTS = 50
    const MAX_MATCHES_PER_FILE = 5
    const results: Array<{
      projectId: string
      projectTitle: string
      fileId: string
      filePath: string
      lineNumber: number
      column: number
      lineText: string
    }> = []

    for (const file of files) {
      if (results.length >= MAX_RESULTS) break
      if (!isSearchableMimeType(file.mimeType, file.filePath)) continue

      let text: string
      try {
        const doc = new Y.Doc()
        Y.applyUpdate(doc, file.collaborationState)
        text = doc.getText('content').toString()
      } catch {
        continue
      }

      const lines = text.split('\n')
      let matchCount = 0
      for (let i = 0; i < lines.length && matchCount < MAX_MATCHES_PER_FILE && results.length < MAX_RESULTS; i++) {
        const col = lines[i].toLowerCase().indexOf(lowerQuery)
        if (col === -1) continue
        results.push({
          projectId: file.projectId,
          projectTitle: file.projectTitle,
          fileId: file.fileId,
          filePath: file.filePath,
          lineNumber: i + 1,
          column: col + 1,
          lineText: lines[i].slice(0, 200),
        })
        matchCount++
      }
    }

    res.json({ results })
  } catch (error) {
    next(error)
  }
})

function isSearchableMimeType(mimeType: string, filePath: string): boolean {
  if (mimeType.startsWith('text/')) return true
  return isProjectTextFilePath(filePath)
}

function normalizeUploadedProjectFileMimeType(fileName: string, reportedMimeType?: string | null): string {
  const inferredMimeType = inferProjectFileMimeType(fileName)
  if (!reportedMimeType || reportedMimeType === 'application/octet-stream') {
    return inferredMimeType
  }
  if (inferredMimeType.startsWith('text/') && !reportedMimeType.startsWith('text/')) {
    return inferredMimeType
  }
  return reportedMimeType
}

projectsRouter.get('/:projectId/tasks', async (req, res) => {
  const user = getAuthenticatedUser(req)
  if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
    return res.status(404).json({ error: 'Project not found' })
  }
  const comments = await listProjectCommentsInvolvingUser(req.params.projectId, user.id)
  res.json(comments)
})

projectsRouter.get('/:projectId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const ownedProject = await getProjectById(req.params.projectId)
  if (ownedProject?.ownerUserId === user.id) {
    await syncDriveProjectTree(ownedProject.id, ownedProject.ownerUserId, ownedProject.driveFolderId)
  }

  const project = await getProjectDetailForUser(req.params.projectId, user.id)
  if (!project) {
    return res.status(404).json({ error: 'Project not found' })
  }

  await markProjectOpened(project.id)
  const enriched = await enrichProjectDetail(project)
  const collaborationTokens: Record<string, string> = {}
  for (const file of enriched.files) {
    if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) continue
    if (!file.mimeType.startsWith('text/') && !isProjectTextFilePath(file.name)) continue
    collaborationTokens[file.id] = createCollaborationToken({ userId: user.id, projectId: project.id, fileId: file.id })
  }
  res.json({ ...enriched, collaborationTokens })
})

projectsRouter.patch('/:projectId/state', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const nextState = await updateProjectFeatureState(req.params.projectId, {
      isStarred: typeof req.body.isStarred === 'boolean' ? req.body.isStarred : undefined,
      isPinned: typeof req.body.isPinned === 'boolean' ? req.body.isPinned : undefined,
    })

    await logProjectActivity({
      projectId: req.params.projectId,
      actorUserId: user.id,
      type: 'project.state',
      summary: 'Updated project dashboard state.',
      metadata: { ...nextState },
    })

    res.json(nextState)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/archive', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const state = await updateProjectFeatureState(req.params.projectId, { archivedAt: Date.now(), trashedAt: null })
    await logProjectActivity({
      projectId: req.params.projectId,
      actorUserId: user.id,
      type: 'project.archive',
      summary: 'Archived the project.',
    })
    res.json(state)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/restore', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const state = await updateProjectFeatureState(req.params.projectId, { archivedAt: null, trashedAt: null })
    await logProjectActivity({
      projectId: req.params.projectId,
      actorUserId: user.id,
      type: 'project.restore',
      summary: 'Restored the project.',
    })
    res.json(state)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/trash/empty', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const role = await getProjectRole(req.params.projectId, user.id)
    if (!role || role === 'viewer') {
      return res.status(role ? 403 : 404).json({ error: role ? 'Editor access required' : 'Project not found' })
    }

    await emptyProjectTrash(req.params.projectId)
    invalidateProjectWorkspaceCache(req.params.projectId)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/trash', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const state = await updateProjectFeatureState(req.params.projectId, { trashedAt: Date.now(), archivedAt: null })
    await logProjectActivity({
      projectId: req.params.projectId,
      actorUserId: user.id,
      type: 'project.trash',
      summary: 'Moved the project to trash.',
    })
    res.json(state)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/copy', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const sourceProject = await getProjectById(req.params.projectId)
    if (!sourceProject) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const titleResult = validateOptionalString(req.body.title, { maxLength: 255, label: 'Title' })
    if (!titleResult.valid) return res.status(400).json({ error: titleResult.error })
    const title = titleResult.value || `${sourceProject.title} Copy`
    await assertCanCreateProject(user.id)
    const project = await cloneProject({
      sourceProjectId: req.params.projectId,
      actorUserId: user.id,
      title,
      fork: false,
    })

    await logProjectActivity({
      projectId: project.id,
      actorUserId: user.id,
      type: 'project.copy',
      summary: `Created a copy of ${sourceProject.title}.`,
      metadata: { sourceProjectId: req.params.projectId },
    })
    res.status(201).json(await enrichProjectDetail((await getProjectDetailForUser(project.id, user.id))!))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/create-typst-copy', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const sourceProject = await getProjectById(projectId)
    if (!sourceProject) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const titleResult = validateOptionalString(req.body.title, { maxLength: 255, label: 'Title' })
    if (!titleResult.valid) return res.status(400).json({ error: titleResult.error })

    const sourceOverride = typeof req.body.source === 'string' && typeof req.body.sourceFileId === 'string'
      ? { fileId: req.body.sourceFileId as string, content: req.body.source as string }
      : undefined

    const workspaceFiles = await loadProjectWorkspaceFiles({
      projectId,
      ownerUserId: sourceProject.ownerUserId,
      sourceOverride,
    })
    const convertedFiles = await convertWorkspaceFilesToTypst(workspaceFiles)
    const sourceMainFile = sourceProject.mainFileId ? await getProjectFileById(sourceProject.mainFileId) : null
    const convertedMainFilePath = sourceMainFile?.path.replace(/\.(tex|ltx|latex)$/i, '.typ') ?? null

    const zip = new JSZip()
    for (const file of convertedFiles) {
      zip.file(file.path, file.content)
    }

    const title = titleResult.value || `${sourceProject.title} Typst`
    await assertCanCreateProject(user.id)
    const project = await importProjectZip({
      ownerUserId: user.id,
      title,
      zipBuffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }),
    })

    if (convertedMainFilePath) {
      const importedMainFile = (await listProjectFiles(project.id)).find((file) => file.path === convertedMainFilePath)
      if (importedMainFile) {
        await setProjectMainFile(project.id, importedMainFile.id)
      }
    }

    await logProjectActivity({
      projectId: project.id,
      actorUserId: user.id,
      type: 'project.copy',
      summary: `Created a Typst copy of ${sourceProject.title}.`,
      metadata: { sourceProjectId: projectId, targetFormat: 'typst' },
    })

    res.status(201).json(await enrichProjectDetail((await getProjectDetailForUser(project.id, user.id))!))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/fork', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const sourceProject = await getProjectById(req.params.projectId)
    if (!sourceProject) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const titleResult = validateOptionalString(req.body.title, { maxLength: 255, label: 'Title' })
    if (!titleResult.valid) return res.status(400).json({ error: titleResult.error })
    const title = titleResult.value || `${sourceProject.title} Fork`
    await assertCanCreateProject(user.id)
    const project = await cloneProject({
      sourceProjectId: req.params.projectId,
      actorUserId: user.id,
      title,
      fork: true,
    })

    await logProjectActivity({
      projectId: project.id,
      actorUserId: user.id,
      type: 'project.fork',
      summary: `Forked ${sourceProject.title}.`,
      metadata: { sourceProjectId: req.params.projectId },
    })
    res.status(201).json(await enrichProjectDetail((await getProjectDetailForUser(project.id, user.id))!))
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/chat', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    res.json(await listProjectChat(req.params.projectId))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/chat', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const contentResult = validateString(req.body.content, { maxLength: 5000, required: true, label: 'Content' })
    if (!contentResult.valid) {
      return res.status(400).json({ error: contentResult.error })
    }
    const content = contentResult.value

    const message = await createProjectChat({
      projectId: req.params.projectId,
      authorUserId: user.id,
      content,
    })
    await logProjectActivity({
      projectId: req.params.projectId,
      actorUserId: user.id,
      type: 'chat.message',
      summary: 'Posted a project chat message.',
    })
    res.status(201).json(message)
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/ecosystem', async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    res.json(await buildProjectEcosystemState(projectId, user.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/ecosystem/scholar-search', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    const queryResult = validateString(req.query.q as string, { maxLength: 500, required: true, label: 'Query' })

    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (!queryResult.valid) {
      return res.status(400).json({ error: queryResult.error })
    }
    await consumeBibliographySearchQuota(user.id)
    const query = queryResult.value

    const cacheKey = query.toLowerCase()
    const cached = scholarSearchCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ data: cached.data, cached: true })
    }

    const searchParams = new URLSearchParams({
      query,
      fields: 'title,authors,year,venue,journal,externalIds,citationCount',
      limit: '8',
    })

    const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${searchParams.toString()}`)
    if (response.status === 429) {
      if (cached?.data?.length) {
        return res.json({ data: cached.data, cached: true, rateLimited: true })
      }

      return res.status(429).json({
        error: 'Scholar is rate-limited. Try arXiv or DBLP, or wait a moment.',
      })
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: `Scholar search returned ${response.status}` })
    }

    const data = await response.json() as { data?: unknown[] }
    const results = data.data ?? []
    scholarSearchCache.set(cacheKey, {
      data: results,
      expiresAt: Date.now() + SCHOLAR_SEARCH_CACHE_TTL_MS,
    })
    res.json({ data: results })
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/ecosystem/arxiv-search', async (req, res, next) => {
  let cached: { expiresAt: number; data: unknown[] } | undefined
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    const queryResult = validateString(req.query.q as string, { maxLength: 500, required: true, label: 'Query' })

    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (!queryResult.valid) {
      return res.status(400).json({ error: queryResult.error })
    }
    const query = queryResult.value

    const cacheKey = `arxiv:${query.toLowerCase()}`
    cached = scholarSearchCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ data: cached.data, cached: true })
    }

    const params = new URLSearchParams({
      search_query: `all:${query}`,
      start: '0',
      max_results: '8',
      sortBy: 'relevance',
      sortOrder: 'descending',
    })
    const xml = await fetchArxivSearchXml(params)
    const entries = parseArxivSearchResults(xml)
    scholarSearchCache.set(cacheKey, { data: entries, expiresAt: Date.now() + SCHOLAR_SEARCH_CACHE_TTL_MS })
    res.json({ data: entries })
  } catch (error) {
    const userMessage = error instanceof Error ? error.message : 'arXiv search failed.'
    if (cached?.data?.length) {
      return res.json({ data: cached.data, cached: true, stale: true, upstreamUnavailable: true, error: userMessage })
    }

    res.json({ data: [], upstreamUnavailable: true, error: userMessage })
  }
})

projectsRouter.get('/:projectId/ecosystem/dblp-search', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    const queryResult = validateString(req.query.q as string, { maxLength: 500, required: true, label: 'Query' })

    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (!queryResult.valid) {
      return res.status(400).json({ error: queryResult.error })
    }
    const query = queryResult.value

    const cacheKey = `dblp:${query.toLowerCase()}`
    const cached = scholarSearchCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ data: cached.data, cached: true })
    }

    const params = new URLSearchParams({ q: query, format: 'json', h: '8' })
    const response = await fetch(`https://dblp.org/search/publ/api?${params.toString()}`, {
      headers: { 'User-Agent': 'typstr bibliography importer' },
    })

    if (!response.ok) {
      return res.status(502).json({ error: `DBLP search returned ${response.status}` })
    }

    const json = await response.json() as { result?: { hits?: { hit?: unknown[] } } }
    const hits = json?.result?.hits?.hit ?? []
    const entries = parseDblpSearchResults(hits)
    scholarSearchCache.set(cacheKey, { data: entries, expiresAt: Date.now() + SCHOLAR_SEARCH_CACHE_TTL_MS })
    res.json({ data: entries })
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/ecosystem/bib-import', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectId = normalizeRouteParam(req.params.projectId)
    const identifierResult = validateString(req.body?.identifier, { maxLength: 500, required: true, label: 'Identifier' })

    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (!identifierResult.valid) {
      return res.status(400).json({ error: identifierResult.error })
    }
    const identifier = identifierResult.value

    const doi = extractDoi(identifier)
    if (doi) {
      const entry = await fetchBibtexForDoi(doi)
      return res.json({ entry, source: 'doi' })
    }

    const arxivId = extractArxivId(identifier)
    if (arxivId) {
      const entry = await fetchBibtexForArxiv(arxivId)
      return res.json({ entry, source: 'arxiv' })
    }

    return res.status(400).json({
      error: 'Only DOI and arXiv identifiers or URLs are supported right now.',
    })
  } catch (error) {
    next(error)
  }
})

projectsRouter.patch('/:projectId/ecosystem', async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const project = await getProjectById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const currentSettings = await getProjectEcosystemSettings(project.id)
    const requestedSettings = typeof req.body.settings === 'object' && req.body.settings ? req.body.settings : null
    if (requestedSettings && Object.prototype.hasOwnProperty.call(requestedSettings, 'writingGoals')) {
      await assertCanUseWritingGoals(user.id)
    }
    if (requestedSettings && Array.isArray(requestedSettings.packagePins)) {
      await assertCanUseTypstPackagePins(user.id, requestedSettings.packagePins.length)
    }
    const nextSettings = req.body.settings === undefined
      ? currentSettings
      : normalizeProjectEcosystemSettings({
          ...currentSettings,
          ...(requestedSettings ?? {}),
          packagePins: Array.isArray(req.body.settings?.packagePins) ? req.body.settings.packagePins : currentSettings.packagePins,
          writingSnippets: Array.isArray(req.body.settings?.writingSnippets) ? req.body.settings.writingSnippets : currentSettings.writingSnippets,
          writingGoals: {
            ...currentSettings.writingGoals,
            ...(typeof req.body.settings?.writingGoals === 'object' && req.body.settings.writingGoals ? req.body.settings.writingGoals : {}),
          },
        })

    await updateProjectEcosystemSettings(project.id, nextSettings)

    if (Array.isArray(req.body.metadataFiles)) {
      const arrResult = validateArrayLength(req.body.metadataFiles, { maxItems: 100, label: 'Metadata files' })
      if (!arrResult.valid) return res.status(400).json({ error: arrResult.error })
      for (const file of req.body.metadataFiles) {
        const targetPath = typeof file?.path === 'string' ? file.path.trim() : ''
        const content = typeof file?.content === 'string' ? file.content : ''
        if (!PROJECT_METADATA_FILE_DEFINITIONS.some((definition) => definition.path === targetPath)) {
          return res.status(400).json({ error: `Unsupported metadata file: ${targetPath}` })
        }

        await upsertProjectTextFile(project, targetPath, content)
      }
    }

    invalidateProjectWorkspaceCache(project.id)
    res.json(await buildProjectEcosystemState(project.id, user.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/ecosystem/fonts', upload.single('file'), async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    if (!req.file) {
      return res.status(400).json({ error: 'file is required' })
    }
    await assertCanUseCustomFonts(user.id)
    await assertCanUploadBytes(user.id, projectId, req.file.size)

    if (!/\.(ttf|otf|ttc|woff|woff2)$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: 'Only font files are supported here.' })
    }

    const project = await getProjectById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const fontPath = `${PROJECT_FONTS_FOLDER}/${req.file.originalname}`
    await upsertProjectBinaryFile(project, fontPath, req.file.mimetype || 'font/otf', req.file.buffer)
    invalidateProjectWorkspaceSubtree(project.id, PROJECT_FONTS_FOLDER)

    res.status(201).json(await buildProjectEcosystemState(project.id, user.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/ecosystem/library-assets', upload.single('file'), async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    if (!req.file) {
      return res.status(400).json({ error: 'file is required' })
    }

    await saveReusableAsset(user.id, req.file.originalname, req.file.mimetype || 'application/octet-stream', req.file.buffer)
    res.status(201).json(await buildProjectEcosystemState(projectId, user.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/ecosystem/library-assets/from-project-file', async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const fileId = typeof req.body.fileId === 'string' ? req.body.fileId.trim() : ''
    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' })
    }

    const file = await getProjectFileForUser(fileId, user.id)
    if (!file || file.projectId !== projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(404).json({ error: 'File not found' })
    }

    const buffer = await readFileBufferFromDrive(file.ownerUserId, file.driveFileId)
    await saveReusableAsset(user.id, file.name, file.mimeType, buffer)

    res.status(201).json(await buildProjectEcosystemState(projectId, user.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/ecosystem/library-assets/:assetId/import', async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const project = await getProjectById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const asset = await findReusableAsset(user.id, req.params.assetId)
    if (!asset) {
      return res.status(404).json({ error: 'Reusable asset not found' })
    }

    const parentPath = typeof req.body.parentPath === 'string' ? req.body.parentPath : null
    const parentFolder = await resolveParentFolder(project.id, project.driveFolderId, parentPath)
    const targetName = await ensureUniqueProjectName(project.id, parentFolder.path, asset.name)
    const nextPath = joinProjectPath(parentFolder.path, targetName)
    const buffer = await readFileBufferFromDrive(user.id, asset.id)

    await createProjectBinaryFile(project, parentFolder.driveFileId, nextPath, targetName, asset.mimeType, buffer)
    invalidateProjectWorkspaceCache(project.id)

    res.status(201).json(await buildProjectEcosystemState(project.id, user.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.delete('/:projectId/ecosystem/library-assets/:assetId', async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const asset = await findReusableAsset(user.id, req.params.assetId)
    if (!asset) {
      return res.status(404).json({ error: 'Reusable asset not found' })
    }

    await deleteDriveItem(user.id, asset.id)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/files/:fileId/content', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(404).json({ error: 'File not found' })
    }

    const content = await readFileBufferFromDrive(file.ownerUserId, file.driveFileId)
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(file.name)}"`)
    res.send(content)
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/files/:fileId/thumbnail', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!file.mimeType.startsWith('image/') && file.mimeType !== 'application/pdf') {
      return res.status(400).json({ error: 'File is not previewable as a thumbnail' })
    }

    const requestedWidth = typeof req.query.width === 'string' ? parseInt(req.query.width, 10) : 400
    const requestedQuality = typeof req.query.quality === 'string' ? parseInt(req.query.quality, 10) : 75
    const requestedFormat = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : file.mimeType === 'application/pdf' ? 'png' : 'webp'
    const width = Number.isFinite(requestedWidth) ? Math.max(64, Math.min(1600, requestedWidth)) : 400
    const quality = Number.isFinite(requestedQuality) ? Math.max(35, Math.min(95, requestedQuality)) : 75
    const format = requestedFormat === 'avif' || requestedFormat === 'jpeg' || requestedFormat === 'png' ? requestedFormat : 'webp'
    const etag = `"${file.updatedAt}:${file.mimeType}:${width}:${quality}:${format}"`

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end()
    }

    const buffer = await readFileBufferFromDrive(file.ownerUserId, file.driveFileId)
    const pipeline = sharp(buffer, file.mimeType === 'application/pdf' ? { density: 180, page: 0 } : undefined)
      .rotate()
      .resize({ width, withoutEnlargement: true })
    const thumbnail = format === 'avif'
      ? await pipeline.avif({ quality }).toBuffer()
      : format === 'jpeg'
        ? await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
        : format === 'png'
          ? await pipeline.png({ quality }).toBuffer()
          : await pipeline.webp({ quality }).toBuffer()

    res.setHeader('Content-Type', format === 'jpeg' ? 'image/jpeg' : `image/${format}`)
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
    res.setHeader('ETag', etag)
    res.send(thumbnail)
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/files/:fileId/workflow', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    res.json(await getProjectFileWorkflow(file.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/files/:fileId/duplicate', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const created = await duplicateProjectEntry(file.projectId, file.id, file.ownerUserId)
    invalidateProjectWorkspaceCache(file.projectId)
    await logProjectActivity({
      projectId: file.projectId,
      actorUserId: user.id,
      type: file.mimeType === DRIVE_FOLDER_MIME_TYPE ? 'folder.duplicate' : 'file.duplicate',
      summary: `Duplicated ${file.path}.`,
      metadata: { fileId: file.id, createdIds: created.map((entry) => entry.id) },
    })
    res.status(201).json(created)
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/files/:fileId/suggestions', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(404).json({ error: 'File not found' })
    }

    res.json(await listProjectReviewSuggestions(file.projectId, file.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/files/:fileId/suggestions', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(404).json({ error: 'File not found' })
    }

    const replacementText = typeof req.body.replacementText === 'string' ? req.body.replacementText : ''
    const excerpt = typeof req.body.excerpt === 'string' ? req.body.excerpt : ''
    if (replacementText.length > 50000) {
      return res.status(400).json({ error: 'Replacement text must be at most 50000 characters' })
    }
    if (excerpt.length > 10000) {
      return res.status(400).json({ error: 'Excerpt must be at most 10000 characters' })
    }
    const startLine = Number(req.body.startLine)
    const startColumn = Number(req.body.startColumn)
    const endLine = Number(req.body.endLine)
    const endColumn = Number(req.body.endColumn)
    if (![startLine, startColumn, endLine, endColumn].every((value) => Number.isInteger(value) && value > 0)) {
      return res.status(400).json({ error: 'suggestion coordinates must be positive integers' })
    }

    await assertCanUseTrackChanges(user.id)
    const suggestion = await createProjectReviewSuggestion({
      projectId: file.projectId,
      fileId: file.id,
      authorUserId: user.id,
      excerpt,
      replacementText,
      startLine,
      startColumn,
      endLine,
      endColumn,
    })
    await logProjectActivity({
      projectId: file.projectId,
      actorUserId: user.id,
      type: 'review.suggestion',
      summary: `Proposed a ${suggestion.kind} change in ${file.path}.`,
      metadata: { fileId: file.id, suggestionId: suggestion.id },
    })
    res.status(201).json(suggestion)
  } catch (error) {
    next(error)
  }
})

projectsRouter.patch('/:projectId/files/:fileId/suggestions/:suggestionId', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const action = req.body.action === 'accept' ? 'accept' : req.body.action === 'reject' ? 'reject' : null
    if (!action) {
      return res.status(400).json({ error: 'action must be accept or reject' })
    }

    const suggestion = await decideProjectReviewSuggestion({
      suggestionId: req.params.suggestionId,
      actorUserId: user.id,
      action,
    })
    invalidateProjectWorkspaceFile(file.projectId, file.id)
    await logProjectActivity({
      projectId: file.projectId,
      actorUserId: user.id,
      type: action === 'accept' ? 'review.accept' : 'review.reject',
      summary: `${action === 'accept' ? 'Accepted' : 'Rejected'} a suggested change in ${file.path}.`,
      metadata: { fileId: file.id, suggestionId: suggestion.id },
    })
    res.json(suggestion)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/files/:fileId/lock', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const workflow = await lockProjectFile(file.id, file.projectId, user.id)
    await logProjectActivity({
      projectId: file.projectId,
      actorUserId: user.id,
      type: 'file.lock',
      summary: `Locked ${file.path}.`,
      metadata: { fileId: file.id },
    })
    res.json(workflow)
  } catch (error) {
    next(error)
  }
})

projectsRouter.delete('/:projectId/files/:fileId/lock', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    const workflow = await getProjectFileWorkflow(file.id)
    if (workflow?.lockedByUserId && workflow.lockedByUserId !== user.id && (await getProjectRole(file.projectId, user.id)) !== 'owner') {
      return res.status(403).json({ error: 'Only the lock holder can unlock this file' })
    }

    res.json(await unlockProjectFile(file.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.patch('/:projectId/files/:fileId/review-owner', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const reviewOwnerUserId = typeof req.body.reviewOwnerUserId === 'string' && req.body.reviewOwnerUserId.trim()
      ? req.body.reviewOwnerUserId.trim()
      : null
    const workflow = await assignProjectFileReviewOwner(file.id, file.projectId, reviewOwnerUserId)
    await logProjectActivity({
      projectId: file.projectId,
      actorUserId: user.id,
      type: 'file.review-owner',
      summary: reviewOwnerUserId ? `Assigned review ownership for ${file.path}.` : `Cleared review ownership for ${file.path}.`,
      metadata: { fileId: file.id, reviewOwnerUserId },
    })
    res.json(workflow)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/files/:fileId/restore', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    await restoreProjectEntry(req.params.projectId, req.params.fileId)
    invalidateProjectWorkspaceCache(req.params.projectId)
    await onProjectRestoredActivity(req.params.projectId, req.params.fileId, user.id)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/files/:fileId/comments', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const file = await getProjectFileForUser(req.params.fileId, user.id)
  if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return res.status(404).json({ error: 'File not found' })
  }

  res.json(await listProjectComments(file.id))
})

projectsRouter.get('/:projectId/review-requests', async (req, res) => {
  const user = getAuthenticatedUser(req)
  if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
    return res.status(404).json({ error: 'Project not found' })
  }

  res.json(await listProjectReviewRequests(req.params.projectId))
})

projectsRouter.patch('/:projectId/review-requests/:requestId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  if (!(await canAccessProject(req.params.projectId, user.id, 'editor'))) {
    return res.status(403).json({ error: 'Editor access required' })
  }

  const supervisorNameResult = validateOptionalString(req.body.supervisorName, { maxLength: 120, label: 'Supervisor name' })
  if (!supervisorNameResult.valid) return res.status(400).json({ error: supervisorNameResult.error })
  const messageResult = validateOptionalString(req.body.message, { maxLength: 1000, label: 'Message' })
  if (!messageResult.valid) return res.status(400).json({ error: messageResult.error })

  let expiresAt: number | undefined
  if (req.body.expiresAt !== undefined) {
    expiresAt = Number(req.body.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return res.status(400).json({ error: 'Expiration date must be in the future.' })
    }
  }

  const updated = await updateProjectReviewRequest({
    id: req.params.requestId,
    projectId: req.params.projectId,
    supervisorName: req.body.supervisorName === undefined ? undefined : supervisorNameResult.value ?? null,
    message: req.body.message === undefined ? undefined : messageResult.value ?? null,
    expiresAt,
  })
  if (!updated) return res.status(404).json({ error: 'Review request not found' })
  res.json(updated)
})

projectsRouter.delete('/:projectId/review-requests/:requestId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  if (!(await canAccessProject(req.params.projectId, user.id, 'editor'))) {
    return res.status(403).json({ error: 'Editor access required' })
  }

  const revoked = await revokeProjectReviewRequest(req.params.requestId, req.params.projectId)
  if (!revoked) return res.status(404).json({ error: 'Review request not found or already closed' })
  res.status(204).end()
})

projectsRouter.post('/:projectId/files/:fileId/review-requests', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const emailResult = validateEmail(req.body.supervisorEmail)
    if (!emailResult.valid) return res.status(400).json({ error: emailResult.error })
    const supervisorNameResult = validateOptionalString(req.body.supervisorName, { maxLength: 120, label: 'Supervisor name' })
    if (!supervisorNameResult.valid) return res.status(400).json({ error: supervisorNameResult.error })
    const messageResult = validateOptionalString(req.body.message, { maxLength: 1000, label: 'Message' })
    if (!messageResult.valid) return res.status(400).json({ error: messageResult.error })

    const source = typeof req.body.source === 'string'
      ? req.body.source.slice(0, 2_000_000)
      : await readTextFileFromDrive(file.ownerUserId, file.driveFileId)
    const project = await getProjectById(file.projectId)
    const snapshot = await createProjectRevisionSnapshot({
      projectId: file.projectId,
      fileId: file.id,
      filePath: file.path,
      source,
      reason: 'manual-save',
      actorUserId: user.id,
      label: `Review request ${new Date().toLocaleString()}`,
    })
    const reviewRequest = await createProjectReviewRequest({
      projectId: file.projectId,
      fileId: file.id,
      requesterUserId: user.id,
      supervisorEmail: emailResult.value,
      supervisorName: supervisorNameResult.value,
      message: messageResult.value,
      sourceRevisionId: snapshot.id,
      expiresAt: Date.now() + 14 * 86_400_000,
    })

    const reviewUrl = `${env.frontendOrigin}/review/${encodeURIComponent(reviewRequest.token)}`
    await sendReviewRequestEmail({
      toEmail: emailResult.value,
      supervisorName: supervisorNameResult.value,
      requestedByName: user.name,
      projectTitle: project?.title ?? 'Untitled project',
      filePath: file.path,
      reviewUrl,
      message: messageResult.value,
    })
    await logProjectActivity({
      projectId: file.projectId,
      actorUserId: user.id,
      type: 'review.request',
      summary: `Requested review for ${file.path} from ${emailResult.value}.`,
      metadata: { fileId: file.id, reviewRequestId: reviewRequest.id, supervisorEmail: emailResult.value },
    })

    res.status(201).json({
      id: reviewRequest.id,
      reviewUrl,
      supervisorEmail: reviewRequest.supervisor_email,
      supervisorName: reviewRequest.supervisor_name,
      expiresAt: reviewRequest.expires_at,
      sourceRevisionId: snapshot.id,
    })
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/files/:fileId/comments', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const file = await getProjectFileForUser(req.params.fileId, user.id)
  if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return res.status(404).json({ error: 'File not found' })
  }

  const contentResult = validateString(req.body.content, { maxLength: 5000, required: true, label: 'Content' })
  const excerptResult = validateString(req.body.excerpt, { maxLength: 10000, required: true, label: 'Excerpt' })
  const startLine = Number(req.body.startLine)
  const startColumn = Number(req.body.startColumn)
  const endLine = Number(req.body.endLine)
  const endColumn = Number(req.body.endColumn)
  const pdfAnnotationResult = validateProjectCommentPdfAnnotation(req.body.pdfAnnotation)
  const assigneeUserId = typeof req.body.assigneeUserId === 'string' ? req.body.assigneeUserId : null

  if (!contentResult.valid) {
    return res.status(400).json({ error: contentResult.error })
  }
  const content = contentResult.value

  if (!excerptResult.valid) {
    return res.status(400).json({ error: excerptResult.error })
  }
  const excerpt = excerptResult.value

  if (![startLine, startColumn, endLine, endColumn].every((value) => Number.isInteger(value) && value > 0)) {
    return res.status(400).json({ error: 'comment range coordinates must be positive integers' })
  }

  if (endLine < startLine || (endLine === startLine && endColumn < startColumn)) {
    return res.status(400).json({ error: 'comment range end must not precede its start' })
  }

  if (!pdfAnnotationResult.valid) {
    return res.status(400).json({ error: pdfAnnotationResult.error })
  }

  const comment = await createProjectComment({
    projectId: file.projectId,
    fileId: file.id,
    authorUserId: user.id,
    content,
    excerpt,
    startLine,
    startColumn,
    endLine,
    endColumn,
    pdfAnnotation: pdfAnnotationResult.value,
    assigneeUserId,
  })

  const mentionedUserIds = resolveMentionedUserIds(content, await listProjectMembers(file.projectId), user.id)
  await createProjectNotifications({
    recipientUserIds: mentionedUserIds,
    projectId: file.projectId,
    fileId: file.id,
    commentId: comment.id,
    actorUserId: user.id,
    type: 'mention',
    excerpt: content.slice(0, 220),
  })

  res.status(201).json(comment)
})

function validateProjectCommentPdfAnnotation(value: unknown): {
  valid: boolean
  value: ProjectCommentPdfAnnotation | null
  error?: string
} {
  if (value == null) {
    return { valid: true, value: null }
  }

  if (typeof value !== 'object') {
    return { valid: false, value: null, error: 'PDF annotation must be an object.' }
  }

  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'ink') {
    return { valid: false, value: null, error: 'Unsupported PDF annotation kind.' }
  }

  const page = Number(candidate.page)
  if (!Number.isInteger(page) || page < 1) {
    return { valid: false, value: null, error: 'PDF annotation page must be a positive integer.' }
  }

  const color = typeof candidate.color === 'string' ? candidate.color.trim() : ''
  if (!color || color.length > 32) {
    return { valid: false, value: null, error: 'PDF annotation color is required.' }
  }

  const bounds = validateProjectCommentPdfRect(candidate.bounds)
  if (!bounds.valid) {
    return { valid: false, value: null, error: bounds.error }
  }

  if (!Array.isArray(candidate.strokes) || candidate.strokes.length === 0 || candidate.strokes.length > 64) {
    return { valid: false, value: null, error: 'PDF annotation must contain between 1 and 64 strokes.' }
  }

  let totalPointCount = 0
  const strokes = []
  for (const stroke of candidate.strokes) {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray((stroke as { points?: unknown[] }).points)) {
      return { valid: false, value: null, error: 'PDF annotation stroke is invalid.' }
    }

    const points = (stroke as { points: unknown[] }).points
    if (points.length < 2 || points.length > 2048) {
      return { valid: false, value: null, error: 'Each PDF annotation stroke must contain between 2 and 2048 points.' }
    }

    totalPointCount += points.length
    if (totalPointCount > 4096) {
      return { valid: false, value: null, error: 'PDF annotation is too detailed.' }
    }

    const normalizedPoints = []
    for (const point of points) {
      if (!point || typeof point !== 'object') {
        return { valid: false, value: null, error: 'PDF annotation point is invalid.' }
      }

      const x = Number((point as { x?: unknown }).x)
      const y = Number((point as { y?: unknown }).y)
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        return { valid: false, value: null, error: 'PDF annotation points must stay within the page.' }
      }

      normalizedPoints.push({ x, y })
    }

    strokes.push({ points: normalizedPoints })
  }

  return {
    valid: true,
    value: {
      kind: 'ink',
      page,
      color,
      bounds: bounds.value,
      strokes,
    },
  }
}

function validateProjectCommentPdfRect(value: unknown): {
  valid: boolean
  value: ProjectCommentPdfAnnotation['bounds']
  error?: string
} {
  if (!value || typeof value !== 'object') {
    return { valid: false, value: { x: 0, y: 0, width: 0, height: 0 }, error: 'PDF annotation bounds are required.' }
  }

  const candidate = value as Record<string, unknown>
  const x = Number(candidate.x)
  const y = Number(candidate.y)
  const width = Number(candidate.width)
  const height = Number(candidate.height)

  if (![x, y, width, height].every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)) {
    return { valid: false, value: { x: 0, y: 0, width: 0, height: 0 }, error: 'PDF annotation bounds must stay within the page.' }
  }

  if (width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    return { valid: false, value: { x: 0, y: 0, width: 0, height: 0 }, error: 'PDF annotation bounds are invalid.' }
  }

  return {
    valid: true,
    value: { x, y, width, height },
  }
}

projectsRouter.post('/:projectId/files/:fileId/comments/:commentId/replies', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const file = await getProjectFileForUser(req.params.fileId, user.id)
  if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return res.status(404).json({ error: 'File not found' })
  }

  const comment = await getProjectCommentById(req.params.commentId)
  if (!comment || comment.projectId !== file.projectId || comment.fileId !== file.id) {
    return res.status(404).json({ error: 'Comment not found' })
  }

  const contentResult = validateString(req.body.content, { maxLength: 5000, required: true, label: 'Content' })
  if (!contentResult.valid) {
    return res.status(400).json({ error: contentResult.error })
  }
  const content = contentResult.value

  const updatedComment = await createProjectCommentReply({
    commentId: comment.id,
    projectId: file.projectId,
    fileId: file.id,
    authorUserId: user.id,
    content,
  })

  const mentionedUserIds = resolveMentionedUserIds(content, await listProjectMembers(file.projectId), user.id)
  await createProjectNotifications({
    recipientUserIds: mentionedUserIds,
    projectId: file.projectId,
    fileId: file.id,
    commentId: comment.id,
    actorUserId: user.id,
    type: 'mention',
    excerpt: content.slice(0, 220),
  })

  res.status(201).json(updatedComment)
})

projectsRouter.patch('/:projectId/files/:fileId/comments/:commentId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const file = await getProjectFileForUser(req.params.fileId, user.id)
  if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return res.status(404).json({ error: 'File not found' })
  }

  const comment = await getProjectCommentById(req.params.commentId)
  if (!comment || comment.projectId !== file.projectId || comment.fileId !== file.id) {
    return res.status(404).json({ error: 'Comment not found' })
  }

  let status: 'open' | 'resolved' | 'deleted' | null = null
  if (typeof req.body.status === 'string') {
    status = req.body.status === 'open' || req.body.status === 'resolved' || req.body.status === 'deleted'
      ? req.body.status
      : null
  } else if (typeof req.body.resolved === 'boolean') {
    status = req.body.resolved ? 'resolved' : 'open'
  }

  if (!status) {
    return res.status(400).json({ error: 'status must be open, resolved, or deleted' })
  }

  const updatedComment = await updateProjectCommentStatus({
    commentId: comment.id,
    projectId: file.projectId,
    status,
    updatedByUserId: user.id,
  })

  if (!updatedComment) {
    return res.status(404).json({ error: 'Comment not found' })
  }

  res.json(updatedComment)
})

projectsRouter.patch('/:projectId/files/:fileId/comments/:commentId/assign', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const file = await getProjectFileForUser(req.params.fileId, user.id)
  if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return res.status(404).json({ error: 'File not found' })
  }

  const comment = await getProjectCommentById(req.params.commentId)
  if (!comment || comment.projectId !== file.projectId || comment.fileId !== file.id) {
    return res.status(404).json({ error: 'Comment not found' })
  }

  const role = await getProjectRole(file.projectId, user.id)
  if (!role || role === 'viewer') return res.status(403).json({ error: 'Not authorized' })

  const { assigneeUserId } = req.body as { assigneeUserId?: string | null }
  await assignProjectComment(comment.id, assigneeUserId ?? null)

  const updated = await getProjectCommentById(comment.id)
  res.json(updated)
})

projectsRouter.delete('/:projectId/files/:fileId/comments/:commentId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const file = await getProjectFileForUser(req.params.fileId, user.id)
  if (!file || file.projectId !== req.params.projectId || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return res.status(404).json({ error: 'File not found' })
  }

  const comment = await getProjectCommentById(req.params.commentId)
  if (!comment || comment.projectId !== file.projectId || comment.fileId !== file.id) {
    return res.status(404).json({ error: 'Comment not found' })
  }

  const canDelete = comment.authorUserId === user.id || await canAccessProject(file.projectId, user.id, 'editor')
  if (!canDelete) {
    return res.status(403).json({ error: 'Only the comment author or an editor can delete this comment' })
  }

  await deleteProjectComment(comment.id, file.projectId)
  res.status(204).end()
})

projectsRouter.patch('/:projectId', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const project = await getProjectDetailForUser(req.params.projectId, user.id)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    if (!(await canAccessProject(project.id, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const ownerProject = await getProjectById(project.id)
    if (!ownerProject) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const titleResult = validateOptionalString(req.body.title, { maxLength: 255, label: 'Title' })
    if (!titleResult.valid) return res.status(400).json({ error: titleResult.error })
    const title = titleResult.value
    const mainFileId = typeof req.body.mainFileId === 'string' && req.body.mainFileId.trim() ? req.body.mainFileId.trim() : null
    const compileSettingsResult = req.body.compileSettings === undefined ? null : parseCompileSettings(req.body.compileSettings)

    if (compileSettingsResult?.error) {
      return res.status(400).json({ error: compileSettingsResult.error })
    }

    if (!title && req.body.mainFileId === undefined && req.body.compileSettings === undefined) {
      return res.status(400).json({ error: 'title, mainFileId, or compileSettings must be provided' })
    }

    if (title) {
      await renameDriveItem(ownerProject.ownerUserId, ownerProject.driveFolderId, title)
      await updateProjectTitle(project.id, title)
      await logProjectActivity({
        projectId: project.id,
        actorUserId: user.id,
        type: 'project.rename',
        summary: `Renamed project to ${title}.`,
      })
    }

    if (req.body.mainFileId !== undefined) {
      if (!mainFileId) {
        await setProjectMainFile(project.id, null)
      } else {
        const mainFile = await getProjectFileById(mainFileId)
        const mainFileFormat = mainFile ? inferProjectFormatFromPath(mainFile.name) : null
        if (!mainFile || mainFile.projectId !== project.id || mainFile.mimeType === DRIVE_FOLDER_MIME_TYPE || (mainFileFormat !== 'typst' && mainFileFormat !== 'latex')) {
          return res.status(400).json({ error: 'mainFileId must reference a Typst or LaTeX file in this project' })
        }

        await setProjectMainFile(project.id, mainFile.id)
        await logProjectActivity({
          projectId: project.id,
          actorUserId: user.id,
          type: 'project.main-file',
          summary: `Set ${mainFile.path} as the main ${mainFileFormat === 'latex' ? 'LaTeX' : 'Typst'} file.`,
          metadata: { fileId: mainFile.id, format: mainFileFormat },
        })
      }
    }

    if (compileSettingsResult?.settings) {
      await assertCanUseCompileSettings(user.id, compileSettingsResult.settings.compileDebounceMs, compileSettingsResult.settings.defaultExportFormat)
      await updateProjectCompileSettings(project.id, compileSettingsResult.settings)
      await logProjectActivity({
        projectId: project.id,
        actorUserId: user.id,
        type: 'project.compile-settings',
        summary: 'Updated project compile settings.',
      })
    }

    res.json(await enrichProjectDetail((await getProjectDetailForUser(project.id, user.id))!))
  } catch (error) {
    next(error)
  }
})

function parseCompileSettings(input: unknown): { settings?: ProjectCompileSettings; error?: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'compileSettings must be an object' }
  }

  const candidate = input as Partial<ProjectCompileSettings>

  if (typeof candidate.autoCompile !== 'boolean') {
    return { error: 'compileSettings.autoCompile must be a boolean' }
  }

  if (typeof candidate.compileDebounceMs !== 'number' || !Number.isFinite(candidate.compileDebounceMs) || candidate.compileDebounceMs < 200 || candidate.compileDebounceMs > 5000) {
    return { error: 'compileSettings.compileDebounceMs must be a number between 200 and 5000' }
  }

  if (!VALID_EXPORT_FORMATS.has(String(candidate.defaultExportFormat))) {
    return { error: 'compileSettings.defaultExportFormat must be one of pdf, docx, latex, html' }
  }

  if (!VALID_EXPORT_DESTINATIONS.has(String(candidate.defaultExportDestination))) {
    return { error: 'compileSettings.defaultExportDestination must be download or drive' }
  }

  if (candidate.pageLimit !== null && candidate.pageLimit !== undefined && (typeof candidate.pageLimit !== 'number' || !Number.isFinite(candidate.pageLimit) || candidate.pageLimit < 1 || candidate.pageLimit > 10000)) {
    return { error: 'compileSettings.pageLimit must be null or a number between 1 and 10000' }
  }

  return {
    settings: {
      autoCompile: candidate.autoCompile,
      compileDebounceMs: Math.round(candidate.compileDebounceMs),
      defaultExportFormat: candidate.defaultExportFormat as ProjectCompileSettings['defaultExportFormat'],
      defaultExportDestination: candidate.defaultExportDestination as ProjectCompileSettings['defaultExportDestination'],
      pageLimit: typeof candidate.pageLimit === 'number' ? Math.round(candidate.pageLimit) : null,
    },
  }
}

function resolveMentionedUserIds(content: string, members: ProjectMember[], actorUserId: string): string[] {
  const mentionMatches = [...content.matchAll(/(^|\s)@([^\s.,;:!?()[\]{}<>]+)/g)]
  if (mentionMatches.length === 0) {
    return []
  }

  const identifiers = new Map<string, string>()
  for (const member of members) {
    if (member.userId === actorUserId) {
      continue
    }

    const email = member.email.toLowerCase()
    const localPart = email.split('@')[0]
    const compactName = member.name.toLowerCase().replace(/\s+/g, '')
    const firstName = member.name.toLowerCase().split(/\s+/)[0]

    identifiers.set(email, member.userId)
    identifiers.set(localPart, member.userId)
    identifiers.set(compactName, member.userId)
    identifiers.set(firstName, member.userId)
  }

  return [...new Set(mentionMatches
    .map((match) => match[2]?.toLowerCase())
    .map((token) => token ? identifiers.get(token) ?? null : null)
    .filter((userId): userId is string => Boolean(userId)))]
}

projectsRouter.delete('/:projectId', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const role = await getProjectRole(req.params.projectId, user.id)
    if (role !== 'owner') {
      return res.status(role ? 403 : 404).json({ error: role ? 'Owner access required' : 'Project not found' })
    }

    const project = await getProjectById(req.params.projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    if (req.query.permanent === '1') {
      if (req.query.deleteFromDrive === '1') {
        await deleteDriveItem(project.ownerUserId, project.driveFolderId)
      }
      await deleteProject(project.id)
    } else {
      await updateProjectFeatureState(project.id, { trashedAt: Date.now(), archivedAt: null })
    }
    invalidateProjectWorkspaceCache(project.id)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/files', async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const nameResult = validateString(req.body.name, { maxLength: 255, required: true, label: 'Name' })
    if (!nameResult.valid) {
      return res.status(400).json({ error: nameResult.error })
    }
    const name = nameResult.value

    if (name.includes('/')) {
      return res.status(400).json({ error: 'name cannot contain path separators' })
    }

    const project = await getProjectById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const parentFolder = await resolveParentFolder(project.id, project.driveFolderId, typeof req.body.parentPath === 'string' ? req.body.parentPath : null)
    const nextPath = joinProjectPath(parentFolder.path, name)
    const existing = await getProjectFileByPath(project.id, nextPath)
    if (existing) {
      if (existing.mimeType === DRIVE_FOLDER_MIME_TYPE) {
        return res.status(409).json({ error: 'A folder already exists at that path.' })
      }
      return res.status(200).json(existing)
    }

    const driveFileId = await createTextFileInDrive(project.ownerUserId, parentFolder.driveFileId, name, '')
    const file = await createProjectFile({
      projectId: project.id,
      name,
      path: nextPath,
      mimeType: 'text/plain',
      driveFileId,
    })
    invalidateProjectWorkspaceCache(project.id)
    await logProjectActivity({
      projectId: project.id,
      actorUserId: user.id,
      type: 'file.create',
      summary: `Created file ${file.path}.`,
      metadata: { fileId: file.id },
    })

    res.status(201).json(file)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/folders', async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const nameResult = validateString(req.body.name, { maxLength: 255, required: true, label: 'Name' })
    if (!nameResult.valid) {
      return res.status(400).json({ error: nameResult.error })
    }
    const name = nameResult.value

    if (name.includes('/')) {
      return res.status(400).json({ error: 'name cannot contain path separators' })
    }

    const project = await getProjectById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const parentFolder = await resolveParentFolder(project.id, project.driveFolderId, typeof req.body.parentPath === 'string' ? req.body.parentPath : null)
    const nextPath = joinProjectPath(parentFolder.path, name)
    const existing = await getProjectFileByPath(project.id, nextPath)
    if (existing) {
      if (existing.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
        return res.status(409).json({ error: 'A file already exists at that path.' })
      }
      return res.status(200).json(existing)
    }

    const driveFileId = await createDriveFolderInDrive(project.ownerUserId, parentFolder.driveFileId, name)
    const folder = await createProjectFile({
      projectId: project.id,
      name,
      path: nextPath,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      driveFileId,
    })
    invalidateProjectWorkspaceCache(project.id)
    await logProjectActivity({
      projectId: project.id,
      actorUserId: user.id,
      type: 'folder.create',
      summary: `Created folder ${folder.path}.`,
      metadata: { fileId: folder.id },
    })

    res.status(201).json(folder)
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/uploads', upload.single('file'), async (req, res, next) => {
  try {
    const projectId = normalizeRouteParam(req.params.projectId)
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    if (!req.file) {
      return res.status(400).json({ error: 'file is required' })
    }

    if (req.file.originalname.includes('/')) {
      return res.status(400).json({ error: 'file name cannot contain path separators' })
    }

    const project = await getProjectById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const parentFolder = await resolveParentFolder(project.id, project.driveFolderId, typeof req.body.parentPath === 'string' ? req.body.parentPath : null)
    const nextPath = joinProjectPath(parentFolder.path, req.file.originalname)
    const mimeType = normalizeUploadedProjectFileMimeType(req.file.originalname, req.file.mimetype)
    const driveFileId = await createBinaryFileInDrive({
      userId: project.ownerUserId,
      parentId: parentFolder.driveFileId,
      name: req.file.originalname,
      mimeType,
      content: req.file.buffer,
    })

    const file = await createProjectFile({
      projectId: project.id,
      name: req.file.originalname,
      path: nextPath,
      mimeType,
      driveFileId,
      sizeBytes: req.file.size,
    })
    invalidateProjectWorkspaceCache(project.id)
    await logProjectActivity({
      projectId: project.id,
      actorUserId: user.id,
      type: 'file.upload',
      summary: `Uploaded ${file.path}.`,
      metadata: { fileId: file.id, mimeType: file.mimeType },
    })

    res.status(201).json(file)
  } catch (error) {
    next(error)
  }
})

projectsRouter.patch('/:projectId/files/:fileId', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    await assertFileWritable(file.id, user.id)

    const name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null
    const parentPath = typeof req.body.parentPath === 'string' ? req.body.parentPath : null
    if (!name && parentPath === null) {
      return res.status(400).json({ error: 'name or parentPath must be provided' })
    }

    const normalizedName = name?.trim() || file.name
    if (!normalizedName || normalizedName.includes('/')) {
      return res.status(400).json({ error: 'name must be a non-empty string without path separators' })
    }

    const project = await getProjectById(file.projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const destinationParent = await resolveParentFolder(file.projectId, project.driveFolderId, parentPath)
    const nextPath = joinProjectPath(destinationParent.path, normalizedName)

    await validateMoveTarget(file, nextPath)

    await moveDriveItem({
      userId: file.ownerUserId,
      fileId: file.driveFileId,
      name: normalizedName !== file.name ? normalizedName : undefined,
      parentId: destinationParent.driveFileId,
    })

    if (nextPath !== file.path || normalizedName !== file.name) {
      if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
        await moveProjectFile(file.id, { name: normalizedName, nextPath })
      } else {
        await renameProjectFile(file.id, normalizedName, nextPath)
      }

      await logProjectActivity({
        projectId: file.projectId,
        actorUserId: user.id,
        type: file.mimeType === DRIVE_FOLDER_MIME_TYPE ? 'folder.move' : 'file.move',
        summary: `Moved ${file.path} to ${nextPath}.`,
        metadata: { fileId: file.id, previousPath: file.path, nextPath },
      })
    }

    if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      invalidateProjectWorkspaceSubtree(file.projectId, file.path)
    } else {
      invalidateProjectWorkspaceFile(file.projectId, file.id)
    }
    res.json(await getProjectFileById(file.id))
  } catch (error) {
    next(error)
  }
})

projectsRouter.delete('/:projectId/files/:fileId', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    await assertFileWritable(file.id, user.id)

    if (req.query.permanent === '1') {
      await permanentlyDeleteProjectEntry(file.projectId, file.id)
      invalidateProjectWorkspaceCache(file.projectId)
      res.status(204).end()
      return
    }

    const filesRemoved = file.mimeType === DRIVE_FOLDER_MIME_TYPE
      ? await countProjectFilesInTree(file.projectId, file.path)
      : 1

    if (filesRemoved > 0 && (await countProjectFiles(file.projectId)) - filesRemoved <= 0) {
      return res.status(400).json({ error: 'A project must keep at least one file' })
    }

    await trashProjectEntry(file.projectId, file.id)

    await logProjectActivity({
      projectId: file.projectId,
      actorUserId: user.id,
      type: file.mimeType === DRIVE_FOLDER_MIME_TYPE ? 'folder.trash' : 'file.trash',
      summary: `Moved ${file.path} to trash.`,
      metadata: { fileId: file.id, removedEntries: filesRemoved },
    })

    const nextProjectState = await getProjectById(file.projectId)
    if (nextProjectState?.mainFileId && !(await getProjectFileById(nextProjectState.mainFileId))) {
      const fallbackMainFile = (await listProjectFiles(file.projectId)).find((projectFile) => /\.typ$/i.test(projectFile.name)) ?? null
      await setProjectMainFile(file.projectId, fallbackMainFile?.id ?? null)
    }

    invalidateProjectWorkspaceCache(file.projectId)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/members', async (req, res) => {
  const user = getAuthenticatedUser(req)
  if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
    return res.status(404).json({ error: 'Project not found' })
  }

  res.json(await listProjectMembers(req.params.projectId))
})

projectsRouter.post('/:projectId/shares', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const projectRole = await getProjectRole(req.params.projectId, user.id)
    if (projectRole !== 'owner' && projectRole !== 'manager' && projectRole !== 'editor') {
      return res.status(403).json({ error: 'Owner, manager, or editor access required' })
    }

    const emailResult = validateEmail(req.body.email)
    const role = req.body.role as Exclude<ProjectRole, 'owner'> | undefined
    if (!emailResult.valid || !role || !VALID_MEMBER_ROLES.includes(role)) {
      return res.status(400).json({ error: !emailResult.valid ? emailResult.error : 'email and a valid role are required' })
    }
    if (role === 'manager') {
      await assertCanUseManagerRole(user.id)
    }
    const email = emailResult.value

    if (email === user.email.toLowerCase()) {
      return res.status(400).json({ error: 'You already own this project' })
    }

    const targetUser = await findUserByEmail(email)
    if (targetUser && await getProjectRole(req.params.projectId, targetUser.id)) {
      return res.status(400).json({ error: 'That user already has access. Change their role instead.' })
    }
    const inviteProject = await getProjectById(req.params.projectId)
    await assertCanInviteCollaborator(inviteProject?.ownerUserId ?? user.id, req.params.projectId)

    const invitation = await createOrUpdateProjectInvitation({
      projectId: req.params.projectId,
      email,
      role,
      invitedByUserId: user.id,
    })

    await runBackgroundJobAndWait('invite-sync', {
      projectId: req.params.projectId,
      actorUserId: user.id,
      summary: `Invited ${email} as ${role}.`,
      metadata: { invitationId: invitation.id, email, role },
    })

    emitSharingUpdate(req.params.projectId)

    res.status(201).json(invitation)
  } catch (error) {
    next(error)
  }
})

projectsRouter.patch('/:projectId/members/:userId', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if ((await getProjectRole(req.params.projectId, user.id)) !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' })
    }

    const role = req.body.role as Exclude<ProjectRole, 'owner'> | undefined
    if (!role || !VALID_MEMBER_ROLES.includes(role)) {
      return res.status(400).json({ error: 'role must be editor or viewer' })
    }
    if (role === 'manager') {
      await assertCanUseManagerRole(user.id)
    }

    const project = await getProjectById(req.params.projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const targetUser = await findUserById(req.params.userId)
    const currentRole = targetUser ? await getProjectRole(req.params.projectId, targetUser.id) : null
    if (!targetUser || !currentRole || currentRole === 'owner') {
      return res.status(404).json({ error: 'Member not found' })
    }

    await updateProjectMemberRole(req.params.projectId, req.params.userId, role)

    await runBackgroundJobAndWait('drive-permission-sync', {
      projectId: req.params.projectId,
      ownerUserId: project.ownerUserId,
      fileId: project.driveFolderId,
      email: targetUser.email,
      role,
      action: 'grant',
      actorUserId: user.id,
    })

    emitSharingUpdate(req.params.projectId)

    res.json(await listProjectMembers(req.params.projectId))
  } catch (error) {
    next(error)
  }
})

projectsRouter.delete('/:projectId/members/:userId', async (req, res, next) => {
  try {
  const user = getAuthenticatedUser(req)
  if ((await getProjectRole(req.params.projectId, user.id)) !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' })
  }

  const project = await getProjectById(req.params.projectId)
  if (!project) {
    return res.status(404).json({ error: 'Project not found' })
  }

  const targetUser = await findUserById(req.params.userId)
  const currentRole = targetUser ? await getProjectRole(req.params.projectId, targetUser.id) : null
  if (!targetUser || !currentRole || currentRole === 'owner') {
    return res.status(404).json({ error: 'Member not found' })
  }

  await runBackgroundJobAndWait('drive-permission-sync', {
    projectId: req.params.projectId,
    ownerUserId: project.ownerUserId,
    fileId: project.driveFolderId,
    email: targetUser.email,
    role: null,
    action: 'revoke',
    actorUserId: user.id,
  })

  await revokeProjectMember(req.params.projectId, req.params.userId)
  emitSharingUpdate(req.params.projectId)
  res.status(204).end()
  } catch (error) {
    next(error)
  }
})

projectsRouter.delete('/:projectId/invitations/:invitationId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const projectRole = await getProjectRole(req.params.projectId, user.id)
  if (projectRole !== 'owner' && projectRole !== 'manager' && projectRole !== 'editor') {
    return res.status(403).json({ error: 'Owner, manager, or editor access required' })
  }

  const invitation = await getProjectInvitationById(req.params.invitationId)
  if (!invitation || invitation.projectId !== req.params.projectId) {
    return res.status(404).json({ error: 'Invitation not found' })
  }

  await revokeProjectInvitation(invitation.id)
  await logProjectActivity({
    projectId: req.params.projectId,
    actorUserId: user.id,
    type: 'share.invite-revoked',
    summary: `Revoked invitation for ${invitation.email}.`,
    metadata: { invitationId: invitation.id, email: invitation.email },
  })
  emitSharingUpdate(req.params.projectId)
  res.status(204).end()
})

projectsRouter.get('/:projectId/sharing-events', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (role !== 'owner' && role !== 'manager' && role !== 'editor') {
    return res.status(403).json({ error: 'Owner, manager, or editor access required' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }
  res.write('event: ready\ndata: {}\n\n')

  const sendUpdate = () => {
    res.write(`event: sharing-update\ndata: ${JSON.stringify({ projectId: req.params.projectId, ts: Date.now() })}\n\n`)
  }

  const unsubscribe = subscribeToSharingUpdates(req.params.projectId, sendUpdate)
  const heartbeat = setInterval(() => {
    res.write('event: ping\ndata: {}\n\n')
  }, 25000)

  req.on('close', () => {
    unsubscribe()
    clearInterval(heartbeat)
    res.end()
  })
})

projectsRouter.get('/:projectId/activity', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    if (!(await canAccessProject(req.params.projectId, user.id, 'viewer'))) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50
    res.json(await listProjectActivity(req.params.projectId, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50))
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/files/:fileId/revisions', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 30
    const revisions = await listProjectFileRevisions(file.id, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 30)
    res.json(await filterRevisionsForPlan(user.id, revisions))
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/files/:fileId/revisions/:revisionId/restore', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }
    await assertCanAccessRevisionById(user.id, req.params.revisionId)

    const revision = await restoreProjectRevision({
      projectId: file.projectId,
      fileId: file.id,
      revisionId: req.params.revisionId,
      actorUserId: user.id,
    })
    invalidateProjectWorkspaceFile(file.projectId, file.id)
    res.json(revision)
  } catch (error) {
    next(error)
  }
})

projectsRouter.patch('/:projectId/files/:fileId/revisions/:revisionId/label', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    const label = typeof req.body.label === 'string' ? req.body.label.trim() || null : null
    await updateProjectRevisionLabel(req.params.revisionId, file.id, label)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId/collaboration-token', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : null
  if (!fileId) {
    return res.status(400).json({ error: 'fileId query parameter is required' })
  }

  const file = await getProjectFileForUser(fileId, user.id)
  if (!file || file.projectId !== req.params.projectId) {
    return res.status(404).json({ error: 'File not found' })
  }

  try {
    await assertFileWritable(file.id, user.id)
  } catch {
    // Reviewers and users opening a locked file still need a token; the collaboration server will keep them read-only.
  }

  await touchProjectFile(file.id)
  await markProjectOpened(file.projectId)
  const token = createCollaborationToken({ userId: user.id, projectId: file.projectId, fileId: file.id })
  res.json({ token })
})

projectsRouter.post('/:projectId/files/:fileId/save', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    await assertFileWritable(file.id, user.id)

    const source = typeof req.body.source === 'string' ? req.body.source : ''
    if (source.length > 2_000_000) {
      return res.status(400).json({ error: 'Source must be at most 2000000 characters' })
    }
    const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 180) : undefined

    const start = Date.now();
    await enqueueBackgroundJob('save-file', {
      userId: user.id,
      projectId: file.projectId,
      fileId: file.id,
      source,
      label,
    }, { deduplicateKey: file.id })
    
    console.log(`[Performance] Save enqueued in ${Date.now() - start}ms`);
    invalidateProjectWorkspaceFile(file.projectId, file.id)

    res.json({ saved: true })
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/files/:fileId/autosave', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const file = await getProjectFileForUser(req.params.fileId, user.id)
    if (!file || file.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'File not found' })
    }

    if (!(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' })
    }

    await assertFileWritable(file.id, user.id)

    const source = typeof req.body.source === 'string' ? req.body.source : ''
    if (source.length > 2_000_000) {
      return res.status(400).json({ error: 'Source must be at most 2000000 characters' })
    }

    await writeTextFileToDrive(file.ownerUserId, file.driveFileId, source)
    const storage = await getProjectFileStorage(file.id)
    const updatedState = applySourceToCollaborationState(storage?.collaborationState ?? null, source)
    await updateProjectFileCollaborationState(file.id, updatedState)
    await touchProjectFile(file.id)
    invalidateProjectWorkspaceFile(file.projectId, file.id)

    res.json({ saved: true })
  } catch (error) {
    next(error)
  }
})

async function resolveParentFolder(projectId: string, projectDriveFolderId: string, parentPath: string | null): Promise<{ path: string | null; driveFileId: string }> {
  const normalizedParentPath = normalizeParentPath(parentPath)
  if (!normalizedParentPath) {
    return { path: null, driveFileId: projectDriveFolderId }
  }

  const folder = await getProjectFileByPath(projectId, normalizedParentPath)
  if (!folder || folder.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    throw new Error('Parent folder not found')
  }

  return { path: folder.path, driveFileId: folder.driveFileId }
}

function normalizeParentPath(input: string | null): string | null {
  if (!input?.trim()) {
    return null
  }

  return normalizeProjectPath(input)
}

function normalizeProjectPath(input: string): string {
  const normalized = path.posix.normalize(input.trim()).replace(/^\/+/, '')
  if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.includes('../')) {
    throw new Error('Invalid project path')
  }

  return normalized
}

function joinProjectPath(parentPath: string | null, name: string): string {
  const normalizedName = name.trim()
  if (!normalizedName || normalizedName.includes('/')) {
    throw new Error('Invalid file or folder name')
  }

  return parentPath ? `${parentPath}/${normalizedName}` : normalizedName
}

function parentDirectoryPath(filePath: string): string | null {
  const parent = path.posix.dirname(filePath)
  return parent === '.' ? null : parent
}

function normalizeRouteParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value
}

async function validateMoveTarget(file: ProjectFile, nextPath: string): Promise<void> {
  const existing = await getProjectFileByPath(file.projectId, nextPath)
  if (existing && existing.id !== file.id) {
    throw new Error('Another file or folder already exists at that path')
  }

  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    if (nextPath === file.path || nextPath.startsWith(`${file.path}/`)) {
      throw new Error('A folder cannot be moved into itself')
    }

    let conflictingDescendant: ProjectFile | null = null
    for (const entry of await listProjectFiles(file.projectId)) {
      if (!entry.path.startsWith(`${file.path}/`)) {
        continue
      }

      const suffix = entry.path.slice(file.path.length)
      if (await getProjectFileByPath(file.projectId, `${nextPath}${suffix}`)) {
        conflictingDescendant = entry
        break
      }
    }

    if (conflictingDescendant) {
      throw new Error('A file or folder already exists in the destination folder')
    }
  }
}

async function buildProjectEcosystemState(projectId: string, userId: string): Promise<ProjectEcosystemState> {
  const project = await getProjectById(projectId)
  if (!project) {
    throw new Error('Project not found')
  }

  const [settings, files, reusableAssets, metadataFileContent] = await Promise.all([
    getProjectEcosystemSettings(projectId),
    listProjectFiles(projectId),
    listReusableAssets(userId),
    loadManagedMetadataFiles(projectId, project.ownerUserId),
  ])

  const workspace = await loadProjectWorkspace({
    projectId,
    ownerUserId: project.ownerUserId,
    entryFileId: project.mainFileId ?? files.find((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE)?.id ?? '',
    entryPath: files.find((file) => file.id === project.mainFileId)?.path ?? files.find((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE)?.path ?? 'main.typ',
  })

  const citations = collectCitationRecords(workspace.files)
  const bibliographyFiles = buildBibliographyFileSummaries(files)
    .map((file) => ({
      ...file,
      entryCount: citations.filter((citation) => citation.filePath === file.path).length,
    }))
  const referenceTargets = collectReferenceTargets(workspace.files)
  const writingStats = buildProjectWritingStats(workspace.files, citations, referenceTargets)
  const proseSuggestions = collectProseSuggestions(workspace.files)
  const validationIssues = validateProjectWorkspace({
    files: workspace.files,
    settings,
    metadataFiles: metadataFileContent,
  })

  return {
    settings,
    packageCatalog: TYPOGRAPHY_PACKAGE_CATALOG,
    projectFonts: listProjectFonts(files),
    reusableAssets,
    metadataFiles: buildProjectMetadataFiles(metadataFileContent),
    bibliographyFiles,
    cslFiles: buildCslFileSummaries(files),
    citations,
    referenceTargets,
    writingStats,
    proseSuggestions,
    validationIssues: [
      ...validationIssues,
      ...collectDuplicateCitationIssues(citations),
    ],
  }
}

function extractDoi(input: string): string | null {
  const match = input.trim().match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)
  return match?.[0]?.trim() ?? null
}

function extractArxivId(input: string): string | null {
  const normalized = input.trim()
  const urlMatch = normalized.match(/arxiv\.org\/(?:abs|pdf)\/([A-Za-z0-9.\-]+)(?:\.pdf)?/i)
  if (urlMatch?.[1]) {
    return urlMatch[1]
  }

  const plainMatch = normalized.match(/^(?:arxiv:)?([A-Za-z0-9.\-]+(?:v\d+)?)$/i)
  if (plainMatch?.[1] && /\d{4}\.\d{4,5}|[a-z\-]+\/\d{7}/i.test(plainMatch[1])) {
    return plainMatch[1]
  }

  return null
}

async function fetchBibtexForDoi(doi: string): Promise<string> {
  const response = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
    headers: {
      Accept: 'application/x-bibtex; charset=utf-8',
      'User-Agent': 'typstr bibliography importer',
    },
  })

  if (!response.ok) {
    throw new Error(`DOI lookup returned ${response.status}`)
  }

  const entry = (await response.text()).trim()
  if (!entry.startsWith('@')) {
    throw new Error('DOI lookup did not return BibTeX')
  }

  return entry
}

async function fetchBibtexForArxiv(arxivId: string): Promise<string> {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`, {
    headers: { 'User-Agent': 'typstr bibliography importer' },
  })

  if (!response.ok) {
    throw new Error(`arXiv lookup returned ${response.status}`)
  }

  const xml = await response.text()
  const title = readXmlTag(xml, 'title', true)
  const published = readXmlTag(xml, 'published')
  const summary = readXmlTag(xml, 'summary', true)
  const authors = [...xml.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
    .map((match) => decodeXml(match[1] ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  if (!title) {
    throw new Error('Could not parse arXiv metadata')
  }

  const year = published?.slice(0, 4) ?? ''
  const key = buildImportedBibKey(authors[0] ?? 'arxiv', year, title)
  const lines = [`@misc{${key},`]
  lines.push(`  title = {${escapeBibValue(title)}},`)
  if (authors.length) {
    lines.push(`  author = {${authors.map(escapeBibValue).join(' and ')}},`)
  }
  if (year) {
    lines.push(`  year = {${year}},`)
  }
  lines.push(`  eprint = {${arxivId}},`)
  lines.push('  archivePrefix = {arXiv},')
  lines.push(`  url = {https://arxiv.org/abs/${arxivId}},`)
  if (summary) {
    lines.push(`  abstract = {${escapeBibValue(summary)}},`)
  }
  lines.push('}')
  return lines.join('\n')
}

function readXmlTag(xml: string, tagName: string, skipFirst = false): string | null {
  const matches = [...xml.matchAll(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g'))]
    .map((match) => decodeXml(match[1] ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  if (!matches.length) {
    return null
  }

  return skipFirst && matches.length > 1 ? matches[1] : matches[0]
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function buildImportedBibKey(author: string, year: string, title: string): string {
  const lastName = author.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'source'
  const safeYear = year.match(/^\d{4}$/)?.[0] ?? 'nd'
  const firstWord = title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'entry'
  return `${lastName}${safeYear}${firstWord}`
}

function escapeBibValue(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

export interface CitationSearchResult {
  id: string
  source: 'arxiv' | 'dblp' | 'scholar'
  title: string
  authors: string[]
  year: string | null
  abstract: string | null
  doi: string | null
  url: string | null
  venue: string | null
  bibEntry: string | null
}

function parseArxivSearchResults(xml: string): CitationSearchResult[] {
  const entryMatches = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
  return entryMatches.map((m) => {
    const block = m[1] ?? ''
    const id = (readXmlTag(block, 'id') ?? '').replace(/^.*\//, '').replace(/v\d+$/, '')
    const title = readXmlTag(block, 'title', false)?.replace(/\s+/g, ' ').trim() ?? ''
    const published = readXmlTag(block, 'published') ?? ''
    const year = published.slice(0, 4) || null
    const summary = readXmlTag(block, 'summary')?.replace(/\s+/g, ' ').trim() ?? null
    const authors = [...block.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
      .map((a) => decodeXml(a[1] ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const arxivUrl = `https://arxiv.org/abs/${id}`
    const bibEntry = id && title ? buildArxivBibEntry(id, title, authors, year) : null
    return { id: `arxiv:${id}`, source: 'arxiv' as const, title, authors, year, abstract: summary, doi: null, url: arxivUrl, venue: 'arXiv', bibEntry }
  }).filter((r) => r.title)
}

async function fetchArxivSearchXml(params: URLSearchParams): Promise<string> {
  const url = `https://export.arxiv.org/api/query?${params.toString()}`
  let lastError: Error | null = null

  for (const delayMs of ARXIV_SEARCH_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Typstr bibliography importer (https://typs.tr; mailto:typstr@arleon.com.tr)' },
      })

      if (response.ok) {
        return await response.text()
      }

      lastError = new Error(`arXiv search returned ${response.status}`)
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        break
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('arXiv search failed.')
    }
  }

  throw lastError ?? new Error('arXiv search failed.')
}

function buildArxivBibEntry(arxivId: string, title: string, authors: string[], year: string | null): string {
  const key = buildImportedBibKey(authors[0] ?? 'arxiv', year ?? '', title)
  const lines = [`@misc{${key},`]
  lines.push(`  title = {${escapeBibValue(title)}},`)
  if (authors.length) lines.push(`  author = {${authors.map(escapeBibValue).join(' and ')}},`)
  if (year) lines.push(`  year = {${year}},`)
  lines.push(`  eprint = {${arxivId}},`)
  lines.push('  archivePrefix = {arXiv},')
  lines.push(`  url = {https://arxiv.org/abs/${arxivId}},`)
  lines.push('}')
  return lines.join('\n')
}

function parseDblpSearchResults(hits: unknown[]): CitationSearchResult[] {
  return hits.flatMap((hit) => {
    const info = (hit as Record<string, unknown>)?.info as Record<string, unknown> | undefined
    if (!info) return []
    const title = typeof info.title === 'string' ? info.title.replace(/<[^>]+>/g, '').trim() : ''
    if (!title) return []
    const year = typeof info.year === 'string' ? info.year : (typeof info.year === 'number' ? String(info.year) : null)
    const venue = typeof info.venue === 'string' ? info.venue : null
    const url = typeof info.url === 'string' ? info.url : null
    const doi = typeof info.doi === 'string' ? info.doi : null
    const authorsRaw = info.authors as Record<string, unknown> | undefined
    const authorList = Array.isArray(authorsRaw?.author)
      ? (authorsRaw!.author as unknown[]).map((a) => (typeof a === 'string' ? a : (a as Record<string, string>)?.text ?? '')).filter(Boolean)
      : typeof authorsRaw?.author === 'string' ? [authorsRaw.author] : []
    const rawKey = typeof (hit as Record<string, unknown>).key === 'string' ? (hit as Record<string, string>).key.trim() : ''
    const fallbackKey = buildImportedBibKey(authorList[0] ?? 'dblp', year ?? '', title)
    const resultKey = rawKey || fallbackKey
    const bibEntry = title ? buildDblpBibEntry(resultKey, title, authorList, year, venue, doi, url) : null
    return [{ id: `dblp:${resultKey}`, source: 'dblp' as const, title, authors: authorList, year, abstract: null, doi, url, venue, bibEntry }]
  })
}

function buildDblpBibEntry(key: string, title: string, authors: string[], year: string | null, venue: string | null, doi: string | null, url: string | null): string {
  const safeKey = buildImportedBibKey(authors[0] ?? 'dblp', year ?? '', title)
  const type = venue?.toLowerCase().includes('journal') || venue?.toLowerCase().includes('trans') ? 'article' : 'inproceedings'
  const lines = [`@${type}{${safeKey},`]
  lines.push(`  title = {${escapeBibValue(title)}},`)
  if (authors.length) lines.push(`  author = {${authors.map(escapeBibValue).join(' and ')}},`)
  if (year) lines.push(`  year = {${year}},`)
  if (venue) lines.push(`  ${type === 'article' ? 'journal' : 'booktitle'} = {${escapeBibValue(venue)}},`)
  if (doi) lines.push(`  doi = {${doi}},`)
  if (url) lines.push(`  url = {${url}},`)
  lines.push('}')
  return lines.join('\n')
}

async function loadManagedMetadataFiles(projectId: string, ownerUserId: string): Promise<Record<string, string>> {
  const entries = await Promise.all(PROJECT_METADATA_FILE_DEFINITIONS.map(async (definition) => {
    const file = await getProjectFileByPath(projectId, definition.path)
    if (!file || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return [definition.path, ''] as const
    }

    return [definition.path, await readTextFileFromDrive(ownerUserId, file.driveFileId)] as const
  }))

  return Object.fromEntries(entries)
}

async function upsertProjectTextFile(
  project: NonNullable<Awaited<ReturnType<typeof getProjectById>>>,
  filePath: string,
  content: string,
): Promise<void> {
  const existing = await getProjectFileByPath(project.id, filePath)
  if (existing && existing.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    await writeTextFileToDrive(project.ownerUserId, existing.driveFileId, content)
    await touchProjectFile(existing.id)
    return
  }

  const parentFolder = await ensureProjectFolderPath(project, parentDirectoryPath(filePath))
  const name = path.posix.basename(filePath)
  const driveFileId = await createTextFileInDrive(project.ownerUserId, parentFolder.driveFileId, name, content)
  await createProjectFile({
    projectId: project.id,
    name,
    path: filePath,
    mimeType: 'text/plain',
    driveFileId,
  })
}

async function upsertProjectBinaryFile(
  project: NonNullable<Awaited<ReturnType<typeof getProjectById>>>,
  filePath: string,
  mimeType: string,
  content: Buffer,
): Promise<void> {
  const existing = await getProjectFileByPath(project.id, filePath)
  if (existing && existing.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    const parentPath = parentDirectoryPath(filePath)
    const parentFolder = await ensureProjectFolderPath(project, parentPath)
    await upsertBinaryFileInDrive({
      userId: project.ownerUserId,
      parentId: parentFolder.driveFileId,
      name: existing.name,
      mimeType,
      content,
    })
    await touchProjectFile(existing.id)
    return
  }

  const parentFolder = await ensureProjectFolderPath(project, parentDirectoryPath(filePath))
  const name = path.posix.basename(filePath)
  await createProjectBinaryFile(project, parentFolder.driveFileId, filePath, name, mimeType, content)
}

async function createProjectBinaryFile(
  project: NonNullable<Awaited<ReturnType<typeof getProjectById>>>,
  parentDriveFileId: string,
  filePath: string,
  name: string,
  mimeType: string,
  content: Buffer,
): Promise<ProjectFile> {
  const driveFileId = await createBinaryFileInDrive({
    userId: project.ownerUserId,
    parentId: parentDriveFileId,
    name,
    mimeType,
    content,
  })

  return createProjectFile({
    projectId: project.id,
    name,
    path: filePath,
    mimeType,
    driveFileId,
  })
}

async function ensureProjectFolderPath(
  project: NonNullable<Awaited<ReturnType<typeof getProjectById>>>,
  folderPath: string | null,
): Promise<{ path: string | null; driveFileId: string }> {
  if (!folderPath) {
    return { path: null, driveFileId: project.driveFolderId }
  }

  const normalized = normalizeProjectPath(folderPath)
  const existing = await getProjectFileByPath(project.id, normalized)
  if (existing?.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return { path: existing.path, driveFileId: existing.driveFileId }
  }

  const segments = normalized.split('/')
  let currentPath: string | null = null
  let currentDriveId = project.driveFolderId

  for (const segment of segments) {
    const nextPath = joinProjectPath(currentPath, segment)
    const existingSegment = await getProjectFileByPath(project.id, nextPath)
    if (existingSegment?.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      currentPath = existingSegment.path
      currentDriveId = existingSegment.driveFileId
      continue
    }

    const driveFileId = await createDriveFolderInDrive(project.ownerUserId, currentDriveId, segment)
    await createProjectFile({
      projectId: project.id,
      name: segment,
      path: nextPath,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      driveFileId,
    })
    currentPath = nextPath
    currentDriveId = driveFileId
  }

  return { path: currentPath, driveFileId: currentDriveId }
}

async function ensureUniqueProjectName(projectId: string, parentPath: string | null, name: string): Promise<string> {
  const extension = path.posix.extname(name)
  const baseName = extension ? name.slice(0, -extension.length) : name
  let attempt = 0

  while (attempt < 100) {
    const candidateName = attempt === 0 ? name : `${baseName}-${attempt + 1}${extension}`
    const candidatePath = joinProjectPath(parentPath, candidateName)
    if (!(await getProjectFileByPath(projectId, candidatePath))) {
      return candidateName
    }

    attempt += 1
  }

  throw new Error('Could not allocate a unique file name in the selected folder')
}

async function getReusableAssetFolderId(userId: string): Promise<string> {
  const userRoot = await ensureUserDriveRootFolder(userId)
  return ensureChildFolderInDrive(userId, userRoot, LIBRARY_FOLDER_NAME)
}

async function listReusableAssets(userId: string) {
  const libraryFolderId = await getReusableAssetFolderId(userId)
  return buildReusableAssets(await listDriveProjectTree(userId, libraryFolderId))
}

async function saveReusableAsset(userId: string, name: string, mimeType: string, content: Buffer): Promise<void> {
  const libraryFolderId = await getReusableAssetFolderId(userId)
  await upsertBinaryFileInDrive({
    userId,
    parentId: libraryFolderId,
    name,
    mimeType,
    content,
  })
}

async function findReusableAsset(userId: string, assetId: string) {
  return (await listReusableAssets(userId)).find((asset) => asset.id === assetId) ?? null
}

function normalizeProjectFormat(input: unknown): ProjectFormat {
  return typeof input === 'string' && VALID_PROJECT_FORMATS.includes(input as ProjectFormat)
    ? input as ProjectFormat
    : 'typst'
}

function inferProjectFormatFromPath(filePath: string): ProjectFormat | null {
  const extension = path.posix.extname(filePath).toLowerCase()
  if (extension === '.typ') return 'typst'
  if (extension === '.tex') return 'latex'
  if (extension === '.md' || extension === '.markdown' || extension === '.txt') return 'gdoc'
  return null
}

function extensionForProjectFormat(format: ProjectFormat): '.typ' | '.tex' | '.md' {
  if (format === 'typst') return '.typ'
  if (format === 'latex') return '.tex'
  return '.md'
}

function defaultSourceForProjectFormat(format: ProjectFormat, templateId: string = 'blank'): string {
  if (format === 'typst') return DEFAULT_TYPST_TEMPLATE
  if (format === 'latex') {
    if (templateId === 'ieee') return IEEE_LATEX_TEMPLATE
    if (templateId === 'acm') return ACM_LATEX_TEMPLATE
    return DEFAULT_LATEX_TEMPLATE
  }
  return DEFAULT_GDOC_TEMPLATE
}

async function initializeProjectMainFileFormat(input: {
  projectId: string
  ownerUserId: string
  format: ProjectFormat
  templateId?: string
}): Promise<void> {
  const project = await getProjectById(input.projectId)
  if (!project?.mainFileId) {
    return
  }

  const file = await getProjectFileById(project.mainFileId)
  if (!file || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return
  }

  const extension = extensionForProjectFormat(input.format)
  const sourceExt = path.posix.extname(file.name)
  const nextName = sourceExt ? `${file.name.slice(0, -sourceExt.length)}${extension}` : `${file.name}${extension}`
  const nextPath = path.posix.join(path.posix.dirname(file.path), nextName).replace(/^\.\//, '')
  const nextContent = defaultSourceForProjectFormat(input.format, input.templateId)

  await writeTextFileToDrive(input.ownerUserId, file.driveFileId, nextContent)
  if (file.name !== nextName) {
    await renameDriveItem(input.ownerUserId, file.driveFileId, nextName)
    await renameProjectFile(file.id, nextName, nextPath)
  }
  await touchProjectFile(file.id)

  const fileStorage = await getProjectFileStorage(file.id)
  const updatedState = applySourceToCollaborationState(fileStorage?.collaborationState ?? null, nextContent)
  await updateProjectFileCollaborationState(file.id, updatedState)

  if (input.format === 'latex') {
    await upsertProjectTextFile(project, 'references.bib', DEFAULT_LATEX_BIB)
  }
}

async function onProjectRestoredActivity(projectId: string, fileId: string, actorUserId: string) {
  const restoredFile = await getProjectFileById(fileId)
  await logProjectActivity({
    projectId,
    actorUserId,
    type: restoredFile?.mimeType === DRIVE_FOLDER_MIME_TYPE ? 'folder.restore' : 'file.restore',
    summary: `Restored ${restoredFile?.path ?? 'a trashed item'}.`,
    metadata: { fileId },
  })
}
