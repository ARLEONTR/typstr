import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import './App.css'
import { logger } from './logger'
import { apiClient } from './api/client'
import DocumentList from './components/DocumentList/DocumentList'
import CodeMirrorEditor from './components/Editor/CodeMirrorEditor'
import TypstPreviewFrame, { type TinymistContextMenuEvent, type TinymistJumpEvent } from './components/Editor/TypstPreviewFrame'
import PdfPreview from './components/Editor/PdfPreview'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { GeminiProvider } from './context/GeminiContext'
import { PrivacyPolicy, TermsOfService } from './components/Legal/LegalPage'
import {
  Eye,
  EyeOff,
  FileText,
  Focus,
  History,
  Loader2,
  MessageSquare,
  Minimize2,
  RefreshCw,
  Sparkles,
  Zap,
  Users,
  Shield,
  Terminal,
  Check,
  Copy,
  ExternalLink,
  Lock,
  Brain,
  GraduationCap,
} from './icons'
import { THEME_STORAGE_KEY, THEME_PRESETS, DEFAULT_THEME, normalizeWorkspaceTheme, resolveThemeVars, themeStorageKeyForUser } from './theme'
import { safeStorage } from './safeStorage'
import type { BillingStatus, CommentSelectionAnchor, CompileDiagnostic, ProjectComment, ProjectRevision, TypstPreviewSessionResponse } from './types'

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1_000

const EditorPage = lazy(() => import('./components/Editor/EditorPage'))
const AdminPage = lazy(() => import('./components/Admin/AdminPage'))

function ThemeManager({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  useEffect(() => {
    const applyTheme = () => {
      logger.debug('Applying theme...')
      const userScopedKey = themeStorageKeyForUser(user?.id)
      let themeConfig = DEFAULT_THEME
      try {
        const userScopedRaw = safeStorage.getItem(userScopedKey)
        const globalRaw = safeStorage.getItem(THEME_STORAGE_KEY)
        themeConfig = normalizeWorkspaceTheme(
          userScopedRaw ? JSON.parse(userScopedRaw) : user?.selectedTheme ?? (globalRaw ? JSON.parse(globalRaw) : DEFAULT_THEME),
        )
      } catch {
        safeStorage.removeItem(userScopedKey)
        themeConfig = normalizeWorkspaceTheme(user?.selectedTheme ?? DEFAULT_THEME)
      }
      const preset = THEME_PRESETS.find(p => p.id === themeConfig.presetId) || THEME_PRESETS[0]
      const themeVars = resolveThemeVars(preset.vars)
      const uiFontSize = themeConfig.uiFontSize
      logger.debug('Theme preset:', preset.id)

      // Inject a style tag to force theme application
      let style = document.getElementById('theme-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'theme-style';
        document.head.appendChild(style);
      }
      style.innerHTML = `
        @import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;500;600;700&family=Fira+Sans:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Merriweather:wght@400;700&family=Nunito:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap');

        :root {
          ${Object.entries(themeVars).map(([k, v]) => `${k}: ${v}`).join('; ')};
          --ui-font: ${themeConfig.uiFontFamily};
          --ui-font-size: ${uiFontSize}pt;
          --editor-font: ${themeConfig.editorFontFamily};
          --editor-font-size: ${themeConfig.editorFontSize}pt;
        }
        html, body, #root {
          font-size: var(--ui-font-size);
        }
        body,
        #root,
        #root button,
        #root input,
        #root select,
        #root textarea {
          font-family: var(--ui-font);
        }
      `;

      // Force refresh of the dashboard/application container background
      document.documentElement.style.backgroundColor = preset.vars['--page-bg']
    }


    // Expose as global for immediate call
    (window as any).applyTypstrTheme = applyTheme

    applyTheme()
    window.addEventListener('storage', applyTheme)
    return () => {
      window.removeEventListener('storage', applyTheme)
      delete (window as any).applyTypstrTheme
    }
  }, [user?.id, user?.selectedTheme])

  return <>{children}</>
}

function LandingPage() {
  const { login, ldapLogin, devLogin, providers } = useAuth()
  const [showLdapModal, setShowLdapModal] = useState(false)
  const [ldapUsername, setLdapUsername] = useState('')
  const [ldapPassword, setLdapPassword] = useState('')
  const [ldapError, setLdapError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState(false)

  const handleLdapSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ldapUsername.trim() || !ldapPassword) {
      setLdapError('Please enter both username and password.')
      return
    }

    setLdapError(null)
    setIsSubmitting(true)
    try {
      await ldapLogin(ldapUsername.trim(), ldapPassword)
    } catch (err: any) {
      setLdapError(err?.response?.data?.error || err?.message || 'Failed to authenticate via LDAP.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleQuickFill = (u: string, p: string) => {
    setLdapUsername(u)
    setLdapPassword(p)
    setLdapError(null)
  }

  const handleCopyCommand = () => {
    navigator.clipboard.writeText('docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build')
    setCopiedCmd(true)
    setTimeout(() => setCopiedCmd(false), 2000)
  }

  const scrollToAuth = () => {
    const el = document.getElementById('auth-section')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="landingRoot">
      {/* Dynamic Ambient Background Elements */}
      <div className="landingGlowOrb1" aria-hidden />
      <div className="landingGlowOrb2" aria-hidden />
      <div className="landingGridOverlay" aria-hidden />

      {/* Floating Navigation Header */}
      <header className="landingNav">
        <div className="landingNavBrand">
          <img src={`/logo.svg?v=${Date.now()}`} alt="Typstr Logo" className="landingNavLogo" />
          <span className="landingNavTitle">TYPSTR</span>
          <span className="landingNavBadge">v0.2 Open Source</span>
        </div>
        <nav className="landingNavLinks">
          <a href="#features">Features</a>
          <a href="#self-hosting">Self-Hosting</a>
          <a href="https://typs.tr" target="_blank" rel="noopener noreferrer" className="landingCloudLink">
            Cloud App (typs.tr) <ExternalLink style={{ width: 13, height: 13, display: 'inline' }} />
          </a>
          <a href="https://github.com/ARLEONTR/typstr" target="_blank" rel="noopener noreferrer" className="landingGithubLink">
            GitHub <ExternalLink style={{ width: 13, height: 13, display: 'inline' }} />
          </a>
        </nav>
        <button className="landingNavCta" onClick={scrollToAuth}>
          Sign In
        </button>
      </header>

      {/* Hero Section */}
      <main className="landingMain">
        <section className="landingHero">
          <div className="landingHeroHeader">
            <div className="landingPill">
              <Sparkles style={{ width: 14, height: 14, color: 'var(--accent)' }} />
              <span>AGPLv3 Open Source · Typst + LaTeX · Self-Hostable</span>
            </div>

            <h1 className="landingHeadline">
              Collaborative Technical Writing, <br />
              <span className="landingHeadlineGradient">Reimagined for Typst & LaTeX.</span>
            </h1>

            <p className="landingSubheadline">
              Sub-second WebAssembly compilation, multiplayer CRDT editing, instant citation discovery across arXiv & DBLP, and 100% self-hosted privacy with enterprise LDAP.
            </p>
          </div>

          <div className="landingHeroGrid">
            {/* Left Card: Auth Access */}
            <div className="landingAuthCard" id="auth-section">
              <div className="landingAuthCardHeader">
                <div className="landingAuthCardTitle">
                  <Lock style={{ width: 18, height: 18, color: 'var(--accent)' }} />
                  <span>Access Workspace</span>
                </div>
                <span className="landingAuthBadge">Secure & Encrypted</span>
              </div>

              <p className="landingAuthDescription">
                Sign in to collaborate on LaTeX and Typst projects saved on your server or Google Drive.
              </p>

              <div className="loginButtonGroup">
                {providers.google ? (
                  <button className="googleButton" onClick={login}>
                    <span className="googleButtonMark" aria-hidden>
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3.1.8 3.8 1.4l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6 6.9 2.6 2.8 6.7 2.8 11.8S6.9 21 12 21c6.1 0 9.1-4.3 9.1-6.5 0-.4 0-.8-.1-1.2H12Z"/>
                        <path fill="#4285F4" d="M21.1 13.3c.1.4.1.8.1 1.2 0 2.2-3 6.5-9.1 6.5-5.1 0-9.2-4.1-9.2-9.2S6.9 2.6 12 2.6c2.6 0 4.8.9 6.4 2.4l-2.6 2.5c-.7-.7-2-1.4-3.8-1.4-2.8 0-5.1 1.9-5.8 4.5l-3-.2v-2C4.8 5 8.1 2.6 12 2.6c2.6 0 4.8.9 6.4 2.4 1.5 1.4 2.7 3.7 2.7 8.3Z" opacity=".001"/>
                        <path fill="#FBBC05" d="M6.2 13.6a6.1 6.1 0 0 1 0-3.7l-3-.2v3.9l3 .1Z"/>
                        <path fill="#34A853" d="M12 21c2.5 0 4.7-.8 6.2-2.3l-3-2.4c-.8.6-1.9 1-3.2 1-3.2 0-5.9-2.7-5.9-6 0-.4 0-.8.1-1.2l-3-.2A9.2 9.2 0 0 0 12 21Z"/>
                      </svg>
                    </span>
                    <span className="googleButtonText">
                      <span>Sign in with Google</span>
                      <small>Google Drive & Account Integration</small>
                    </span>
                  </button>
                ) : null}

                {providers.ldap ? (
                  <button className="ldapButton" onClick={() => setShowLdapModal(true)}>
                    <span className="ldapButtonMark" aria-hidden>
                      <Users style={{ width: 20, height: 20 }} />
                    </span>
                    <span className="ldapButtonText">
                      <span>Sign in with LDAP</span>
                      <small>Active Directory / OpenLDAP Account</small>
                    </span>
                  </button>
                ) : null}

                {providers.localDev ? (
                  <button
                    className="devLoginButton"
                    onClick={() => {
                      void devLogin()
                    }}
                  >
                    <Zap style={{ width: 16, height: 16, display: 'inline', marginRight: 6 }} />
                    Continue with Instant Dev Login
                  </button>
                ) : null}
              </div>

              <div className="landingCloudCallout">
                <span>Looking for the managed cloud version?</span>
                <a href="https://typs.tr" target="_blank" rel="noopener noreferrer">
                  Access typs.tr ↗
                </a>
              </div>
            </div>

            {/* Right Card: Interactive IDE & Preview Showcase Mockup */}
            <div className="landingMockupCard">
              <div className="landingMockupHeader">
                <div className="mockupWindowDots">
                  <span className="mockupDot dotRed" />
                  <span className="mockupDot dotYellow" />
                  <span className="mockupDot dotGreen" />
                </div>
                <div className="mockupFileName">
                  <FileText style={{ width: 13, height: 13 }} />
                  <span>main.typ — Typstr Studio</span>
                </div>
                <div className="mockupPillBadge">
                  <Zap style={{ width: 12, height: 12 }} /> 8ms WASM
                </div>
              </div>

              <div className="landingMockupBody">
                <div className="mockupEditorPane">
                  <div className="mockupGutter">
                    <span>1</span>
                    <span>2</span>
                    <span>3</span>
                    <span>4</span>
                    <span>5</span>
                    <span>6</span>
                    <span>7</span>
                    <span>8</span>
                    <span>9</span>
                    <span>10</span>
                  </div>
                  <pre className="mockupCode">
                    <code>
                      <span className="codeKeyword">#import</span> <span className="codeString">"@preview/ilm:0.1.3"</span>: *{'\n'}
                      <span className="codeKeyword">#show</span>: ilm.with({'\n'}
                      {'  '}title: <span className="codeString">"Attention Is All You Need"</span>,{'\n'}
                      {'  '}author: <span className="codeString">"Alice Smith, Bob Jones"</span>{'\n'}
                      ){'\n\n'}
                      <span className="codeHeading">= 1. Self-Attention</span>{'\n'}
                      We formulate the scaled dot-product attention:{'\n'}
                      <span className="codeMath">$ "Attention"(Q, K, V) = "softmax"((Q K^T) / sqrt(d_k)) V $</span>{'\n'}
                      As shown in <span className="codeCite">@vaswani2017attention</span>, this mechanism eliminates recurrence.
                    </code>
                  </pre>
                  <div className="mockupCollaboratorBadge">
                    <span className="mockupAvatar">🟢</span>
                    <span>Alice typing line 9...</span>
                  </div>
                </div>

                <div className="mockupPreviewPane">
                  <div className="mockupPaper">
                    <h4 className="paperTitle">Attention Is All You Need</h4>
                    <p className="paperAuthors">Alice Smith · Bob Jones</p>
                    <div className="paperAbstract">
                      <strong>Abstract</strong> — Differentiable attention networks achieve state of the art results while being significantly more parallelizable than recurrence.
                    </div>
                    <div className="paperSection">1. Self-Attention</div>
                    <p className="paperText">We formulate the scaled dot-product attention:</p>
                    <div className="paperFormula">
                      Attention(Q, K, V) = softmax( (Q K<sup>T</sup>) / √d<sub>k</sub> ) V
                    </div>
                    <div className="paperSyncTag">
                      <RefreshCw style={{ width: 11, height: 11 }} /> SyncTeX Active
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Highlights Bento Grid */}
        <section className="landingFeaturesSection" id="features">
          <div className="landingSectionHeader">
            <h2 className="landingSectionTitle">Engineered for High-Velocity Research</h2>
            <p className="landingSectionSubtitle">Everything you need to write, collaborate, compile, and publish technical papers without friction.</p>
          </div>

          <div className="landingBentoGrid">
            <div className="bentoCard bentoCardWide">
              <div className="bentoIconBox">
                <Zap style={{ width: 24, height: 24, color: 'var(--accent)' }} />
              </div>
              <h3>Dual-Engine WASM & Streaming Preview</h3>
              <p>
                Instant, zero-latency in-browser compilation with Typst WebAssembly and BusyTeX, backed by streaming TinyMist live preview and full TeX Live PDF generation.
              </p>
              <div className="bentoBadgeRow">
                <span className="bentoPill">⚡ Typst WASM</span>
                <span className="bentoPill">📄 Full TeX Live</span>
                <span className="bentoPill">🔄 TinyMist Live Preview</span>
              </div>
            </div>

            <div className="bentoCard">
              <div className="bentoIconBox">
                <Users style={{ width: 24, height: 24, color: 'var(--accent)' }} />
              </div>
              <h3>Multiplayer CRDT Collaboration</h3>
              <p>
                Real-time conflict-free collaborative editing powered by Yjs and Hocuspocus with live presence, color-coded cursors, and project chat.
              </p>
              <div className="bentoBadgeRow">
                <span className="bentoPill">Yjs CRDTs</span>
                <span className="bentoPill">Follow Mode</span>
              </div>
            </div>

            <div className="bentoCard">
              <div className="bentoIconBox">
                <GraduationCap style={{ width: 24, height: 24, color: 'var(--accent)' }} />
              </div>
              <h3>Academic Citation Discovery</h3>
              <p>
                Search millions of papers across arXiv, Semantic Scholar, CrossRef, and DBLP right from your editor with one-click BibTeX insertion.
              </p>
              <div className="bentoBadgeRow">
                <span className="bentoPill">arXiv</span>
                <span className="bentoPill">DBLP</span>
                <span className="bentoPill">Semantic Scholar</span>
              </div>
            </div>

            <div className="bentoCard">
              <div className="bentoIconBox">
                <Shield style={{ width: 24, height: 24, color: 'var(--accent)' }} />
              </div>
              <h3>Enterprise LDAP & Self-Hosting</h3>
              <p>
                Full data privacy on your own infrastructure. Native OpenLDAP and Active Directory authentication with local disk persistence.
              </p>
              <div className="bentoBadgeRow">
                <span className="bentoPill">OpenLDAP</span>
                <span className="bentoPill">Active Directory</span>
                <span className="bentoPill">Local Storage</span>
              </div>
            </div>

            <div className="bentoCard bentoCardWide">
              <div className="bentoIconBox">
                <Brain style={{ width: 24, height: 24, color: 'var(--accent)' }} />
              </div>
              <h3>BYOK AI Research Assistant</h3>
              <p>
                Bring Your Own Key support for OpenAI (GPT-4o), Anthropic (Claude 3.5), and Google Gemini. Encrypted at rest with AES-256-GCM for inline drafting and LaTeX formula assistance.
              </p>
              <div className="bentoBadgeRow">
                <span className="bentoPill">Claude 3.5 Sonnet</span>
                <span className="bentoPill">GPT-4o</span>
                <span className="bentoPill">Gemini 1.5 Pro</span>
              </div>
            </div>
          </div>
        </section>

        {/* Self-Hosting Terminal Section */}
        <section className="landingSelfHostSection" id="self-hosting">
          <div className="landingSelfHostBox">
            <div className="landingSelfHostContent">
              <div className="landingPill">
                <Terminal style={{ width: 14, height: 14 }} />
                <span>Deploy in 10 Seconds</span>
              </div>
              <h2>Run on Your Own Infrastructure</h2>
              <p>
                Typstr is 100% open-source under the AGPLv3 license. Deploy with a single Docker Compose command on any Linux VM or Kubernetes cluster.
              </p>
              <ul className="landingCheckList">
                <li><Check style={{ width: 16, height: 16, color: 'var(--success)' }} /> Zero telemetry or external cloud dependencies</li>
                <li><Check style={{ width: 16, height: 16, color: 'var(--success)' }} /> Configurable local storage & backup directories</li>
                <li><Check style={{ width: 16, height: 16, color: 'var(--success)' }} /> Pre-configured OpenLDAP & PostgreSQL services</li>
              </ul>
            </div>

            <div className="landingTerminalSnippet">
              <div className="landingTerminalBar">
                <span className="mockupDot dotRed" />
                <span className="mockupDot dotYellow" />
                <span className="mockupDot dotGreen" />
                <span className="landingTerminalTitle">bash</span>
                <button className="landingCopyBtn" onClick={handleCopyCommand} title="Copy command">
                  {copiedCmd ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
                  <span>{copiedCmd ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
              <pre className="landingTerminalCode">
                <code>
                  <span className="termComment"># 1. Clone & start full stack</span>{'\n'}
                  git clone https://github.com/ARLEONTR/typstr.git{'\n'}
                  cd typstr{'\n\n'}
                  <span className="termComment"># 2. Launch with hot reloading & LDAP</span>{'\n'}
                  docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
                </code>
              </pre>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="landingFooter">
        <div className="landingFooterContent">
          <div className="landingFooterBrand">
            <div className="landingNavBrand">
              <img src="/logo.svg" alt="Typstr" className="landingNavLogo" />
              <span className="landingNavTitle">TYPSTR</span>
            </div>
            <p className="landingFooterTagline">
              The modern open-source collaborative studio for Typst & LaTeX.
            </p>
          </div>

          <div className="landingFooterLinks">
            <div className="landingFooterCol">
              <h4>Platform</h4>
              <a href="#features">Features</a>
              <a href="#self-hosting">Self-Hosting</a>
              <a href="https://typs.tr" target="_blank" rel="noopener noreferrer">Cloud App (typs.tr)</a>
            </div>

            <div className="landingFooterCol">
              <h4>Open Source</h4>
              <a href="https://github.com/ARLEONTR/typstr" target="_blank" rel="noopener noreferrer">GitHub Repository</a>
              <a href="https://github.com/ARLEONTR/typstr/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">AGPLv3 License</a>
              <a href="https://github.com/ARLEONTR/typstr/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">Contributing</a>
            </div>

            <div className="landingFooterCol">
              <h4>Legal</h4>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
            </div>
          </div>
        </div>

        <div className="landingFooterBottom">
          <span>© {new Date().getFullYear()} Typstr. An open-source project by ARLEON.</span>
          <a href="mailto:typstr@arleon.com.tr">typstr@arleon.com.tr</a>
        </div>
      </footer>

      {/* LDAP Sign-in Modal */}
      {showLdapModal && (
        <div className="ldapModalOverlay" onClick={() => setShowLdapModal(false)}>
          <div className="ldapModal" onClick={(e) => e.stopPropagation()}>
            <div className="ldapModalHeader">
              <h3>Sign in with LDAP</h3>
              <button className="ldapCloseButton" onClick={() => setShowLdapModal(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <form onSubmit={handleLdapSubmit} className="ldapForm">
              {ldapError && <div className="ldapErrorBanner">{ldapError}</div>}

              <label className="ldapField">
                <span>Username or Email</span>
                <input
                  type="text"
                  className="ldapInput"
                  value={ldapUsername}
                  onChange={(e) => setLdapUsername(e.target.value)}
                  placeholder="e.g. alice or alice@example.com"
                  autoFocus
                  required
                />
              </label>

              <label className="ldapField">
                <span>Password</span>
                <input
                  type="password"
                  className="ldapInput"
                  value={ldapPassword}
                  onChange={(e) => setLdapPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>

              <button type="submit" className="ldapSubmitButton" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </button>

              {providers.localDev && (
                <div className="ldapQuickFillSection">
                  <span style={{ fontSize: '12px', color: 'var(--muted-text)', marginBottom: '6px', display: 'block' }}>Quick Test Accounts:</span>
                  <div className="ldapQuickFillList">
                    <button type="button" className="ldapQuickFillBadge" onClick={() => handleQuickFill('alice', 'password123')}>
                      👤 Alice
                    </button>
                    <button type="button" className="ldapQuickFillBadge" onClick={() => handleQuickFill('bob', 'password123')}>
                      👤 Bob
                    </button>
                    <button type="button" className="ldapQuickFillBadge" onClick={() => handleQuickFill('john.doe', 'admin123')}>
                      🔑 John (Admin)
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function AnonymousReviewPage() {
  const { token = '' } = useParams()
  const ydocRef = useRef(new Y.Doc())
  const ytextRef = useRef(ydocRef.current.getText('content'))
  const awarenessRef = useRef(new Awareness(ydocRef.current))
  const [data, setData] = useState<{
    id: string
    projectTitle: string
    projectId: string
    fileId: string
    filePath: string
    supervisorEmail: string
    supervisorName: string | null
    sharedByName: string
    sharedByEmail: string
    source: string
    files: Array<{ id: string; path: string; mimeType: string; content: string }>
    comments: ProjectComment[]
    revisions: ProjectRevision[]
    tracking: { open: number; addressed: number }
    createdAt: number
    expiresAt: number
  } | null>(null)
  const [authorName, setAuthorName] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')
  const [content, setContent] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [selection, setSelection] = useState<CommentSelectionAnchor | null>(null)
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)
  const [revealLocation, setRevealLocation] = useState<{ line: number; column?: number; endLine?: number; endColumn?: number; nonce: number } | null>(null)
  const [activeRevisionId, setActiveRevisionId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [showPreview, setShowPreview] = useState(true)
  const [isZenMode, setIsZenMode] = useState(false)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [previewSession, setPreviewSession] = useState<TypstPreviewSessionResponse | null>(null)
  const [latexPreview, setLatexPreview] = useState<{ pdfUrl: string | null; error: string | null; diagnostics: CompileDiagnostic[]; log: string | null } | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    apiClient.get(`/api/review/${encodeURIComponent(token)}`)
      .then((response) => {
        setData(response.data)
        setSelectedFileId((current) => current ?? response.data.fileId)
        const text = ytextRef.current
        text.delete(0, text.length)
        text.insert(0, response.data.source ?? '')
        setAuthorEmail(response.data.supervisorEmail ?? '')
        setAuthorName(response.data.supervisorName ?? '')
      })
      .catch((error) => setMessage(error?.response?.data?.error ?? 'Review link could not be opened.'))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  const reviewFiles = useMemo(
    () => data?.files?.length
      ? data.files
      : data ? [{ id: data.fileId, path: data.filePath, mimeType: 'text/plain', content: data.source }] : [],
    [data],
  )
  const selectedFile = useMemo(
    () => reviewFiles.find((file) => file.id === (selectedFileId ?? data?.fileId)) ?? reviewFiles[0] ?? null,
    [data?.fileId, reviewFiles, selectedFileId],
  )

  useEffect(() => {
    if (!selectedFile) return
    const text = ytextRef.current
    text.delete(0, text.length)
    text.insert(0, selectedFile.content ?? '')
    setSelection(null)
    setHighlightedCommentId(null)
  }, [selectedFile])

  useEffect(() => {
    if (!data || !selectedFile || !isReviewTypstFile(selectedFile.path) || !showPreview) {
      setPreviewSession(null)
      return
    }

    const controller = new AbortController()
    setIsPreviewLoading(true)
    apiClient.post<TypstPreviewSessionResponse>(`/api/review/${encodeURIComponent(token)}/typst-preview-session`, {
      fileId: selectedFile.id,
      source: selectedFile.content,
      sessionId: `review-preview:${data.id}:${selectedFile.id}`,
    }, { signal: controller.signal, timeout: 20_000 })
      .then((response) => setPreviewSession(response.data))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setPreviewSession({
            sessionId: '',
            proxyPath: '',
            entryAbsPath: null,
            workspaceDir: null,
            engine: 'fallback',
            ready: false,
            detail: error?.response?.data?.error ?? 'Tinymist preview could not be started.',
            statuses: [],
          })
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsPreviewLoading(false)
      })

    return () => controller.abort()
  }, [data, selectedFile, showPreview, token, previewRefreshNonce])

  useEffect(() => {
    if (!data || !selectedFile || !isReviewLatexEntryFile(selectedFile.path) || !showPreview) {
      setLatexPreview((current) => {
        if (current?.pdfUrl) URL.revokeObjectURL(current.pdfUrl)
        return null
      })
      return
    }

    const controller = new AbortController()
    setIsPreviewLoading(true)
    apiClient.post<{
      format: 'pdf'
      pdfBase64: string
      engine?: string
      log?: string
      diagnostics?: CompileDiagnostic[]
    }>(`/api/review/${encodeURIComponent(token)}/latex-preview`, {
      fileId: selectedFile.id,
      source: selectedFile.content,
      latexEngine: 'xelatex',
    }, { signal: controller.signal, timeout: 90_000 })
      .then((response) => {
        const pdfUrl = createPdfObjectUrl(response.data.pdfBase64)
        setLatexPreview((current) => {
          if (current?.pdfUrl) URL.revokeObjectURL(current.pdfUrl)
          return {
            pdfUrl,
            error: null,
            diagnostics: response.data.diagnostics ?? [],
            log: response.data.log ?? null,
          }
        })
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLatexPreview((current) => {
            if (current?.pdfUrl) URL.revokeObjectURL(current.pdfUrl)
            return {
              pdfUrl: null,
              error: error?.response?.data?.error ?? 'LaTeX preview could not be compiled.',
              diagnostics: error?.response?.data?.diagnostics ?? [],
              log: null,
            }
          })
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsPreviewLoading(false)
      })

    return () => controller.abort()
  }, [data, selectedFile, showPreview, token, previewRefreshNonce])

  useEffect(() => {
    return () => {
      if (latexPreview?.pdfUrl) URL.revokeObjectURL(latexPreview.pdfUrl)
    }
  }, [latexPreview?.pdfUrl])

  const sortedComments = useMemo(
    () => [...(data?.comments ?? [])]
      .filter((comment) => !selectedFile || comment.fileId === selectedFile.id)
      .sort((left, right) => left.startLine - right.startLine || left.startColumn - right.startColumn || left.createdAt - right.createdAt),
    [data?.comments, selectedFile],
  )

  const activeRevision = data?.revisions.find((revision) => revision.id === activeRevisionId) ?? data?.revisions[0]
  const diff = selectedFile && activeRevision && activeRevision.fileId === selectedFile.id ? buildReviewLineDiff(activeRevision.source, selectedFile.content).slice(0, 220) : []
  const previewDiagnostics = previewSession?.compileDiagnostics ?? []

  const submit = async () => {
    if (!selection) {
      setMessage('Select text in the editor before leaving an anchored comment.')
      return
    }

    setMessage('')
    try {
      await apiClient.post(`/api/review/${encodeURIComponent(token)}/comments`, {
        authorName,
        authorEmail,
        fileId: selectedFile?.id,
        content,
        excerpt: selection.excerpt || content.slice(0, 240),
        startLine: selection.startLine,
        startColumn: selection.startColumn,
        endLine: selection.endLine,
        endColumn: selection.endColumn,
      })
      setContent('')
      setMessage('Comment saved.')
      load()
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Could not save comment.')
    }
  }

  const submitReply = async (commentId: string) => {
    const reply = replyDrafts[commentId]?.trim()
    if (!reply) return
    setMessage('')
    try {
      await apiClient.post(`/api/review/${encodeURIComponent(token)}/comments/${commentId}/replies`, {
        authorName,
        authorEmail,
        content: reply,
      })
      setReplyDrafts((current) => ({ ...current, [commentId]: '' }))
      load()
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Could not save reply.')
    }
  }

  const jumpToComment = (comment: ProjectComment) => {
    setHighlightedCommentId(comment.id)
    setRevealLocation({
      line: comment.startLine,
      column: comment.startColumn,
      endLine: comment.endLine,
      endColumn: comment.endColumn,
      nonce: Date.now(),
    })
  }

  const handlePreviewJump = (jump: TinymistJumpEvent) => {
    if (!selectedFile) return
    const start = normalizeTinymistPosition(jump.start)
    const end = normalizeTinymistPosition(jump.end)
    const startLine = start.line + 1
    const startColumn = start.character + 1
    const endLine = Math.max(startLine, end.line + 1)
    const endColumn = Math.max(startColumn, end.character + 1)
    const excerpt = excerptFromSourceRange(selectedFile.content, startLine, startColumn, endLine, endColumn)
    setSelection({ startLine, startColumn, endLine, endColumn, excerpt })
    setRevealLocation({ line: startLine, column: startColumn, endLine, endColumn, nonce: Date.now() })
  }

  const handlePreviewContextMenu = (event: TinymistContextMenuEvent) => {
    const selectedText = event.selectedText.trim()
    if (selectedText) {
      setSelection({
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: Math.max(1, selectedText.length),
        excerpt: selectedText,
      })
      setContent((current) => current || 'Preview note: ')
    }
  }

  return (
    <div className={isZenMode ? 'reviewWorkspace reviewZenMode' : 'reviewWorkspace'}>
      <header className="reviewWorkspaceTopbar">
        <div className="reviewTitleBlock">
          <div className="reviewBrandLine">
            <img src="/logo.svg" alt="Typstr" />
            <span className="landingEyebrow">TYPSTR REVIEW MODE</span>
          </div>
          <h1>{data?.projectTitle ?? 'Review request'}</h1>
          {data ? (
            <div className="reviewMetaBar" aria-label="Review summary">
              <span>Shared by {data.sharedByName}</span>
              <span>Due {formatReviewDate(data.expiresAt)}</span>
              <span>{data.tracking.open} open</span>
              <span>{data.tracking.addressed} addressed</span>
            </div>
          ) : (
            <p>Opening signed review workspace…</p>
          )}
        </div>
        <div className="reviewIdentity">
          <div className="reviewToolbarGroup">
            <button
              type="button"
              className="reviewIconButton"
              onClick={() => setPreviewRefreshNonce((current) => current + 1)}
              disabled={!data || !selectedFile || isPreviewLoading || (!isReviewTypstFile(selectedFile.path) && !isReviewLatexEntryFile(selectedFile.path))}
              title="Refresh preview"
              aria-label="Refresh preview"
            >
              {isPreviewLoading ? <Loader2 size={16} aria-hidden /> : <RefreshCw size={16} aria-hidden />}
            </button>
            <button
              type="button"
              className="reviewIconButton"
              onClick={() => setShowPreview((current) => !current)}
              title={showPreview ? 'Hide preview' : 'Show preview'}
              aria-label={showPreview ? 'Hide preview' : 'Show preview'}
            >
              {showPreview ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
            </button>
            <button
              type="button"
              className="reviewIconButton"
              onClick={() => setIsZenMode((current) => !current)}
              title={isZenMode ? 'Exit zen mode' : 'Zen mode'}
              aria-label={isZenMode ? 'Exit zen mode' : 'Zen mode'}
            >
              {isZenMode ? <Minimize2 size={16} aria-hidden /> : <Focus size={16} aria-hidden />}
            </button>
          </div>
          <div className="reviewIdentityFields">
            <input aria-label="Reviewer name" value={authorName} onChange={(event) => setAuthorName(event.target.value)} placeholder="Name" />
            <input aria-label="Reviewer email" value={authorEmail} onChange={(event) => setAuthorEmail(event.target.value)} placeholder="Email" />
          </div>
        </div>
      </header>
      {isZenMode ? (
        <button
          type="button"
          className="reviewZenExit"
          onClick={() => setIsZenMode(false)}
          title="Exit zen mode"
          aria-label="Exit zen mode"
        >
          <Minimize2 size={16} aria-hidden />
        </button>
      ) : null}

      {loading ? <div className="authScreen">Opening review workspace…</div> : null}
      {!loading && !data ? <div className="authScreen">{message || 'Review link could not be opened.'}</div> : null}

      {!loading && data ? (
        <main className="reviewWorkspaceGrid">
          <PanelGroup orientation="horizontal" className="reviewPanelGroup">
          <Panel defaultSize={showPreview ? (isZenMode ? 50 : 36) : 100} minSize={22}>
          <section className="reviewEditorPane">
            <div className="reviewFileStrip">
              <span>{reviewFiles.length} file{reviewFiles.length === 1 ? '' : 's'}</span>
              <select value={selectedFile?.id ?? ''} onChange={(event) => setSelectedFileId(event.target.value)}>
                {reviewFiles.map((file) => <option key={file.id} value={file.id}>{file.path}</option>)}
              </select>
            </div>
            <CodeMirrorEditor
              ytext={ytextRef.current}
              awareness={awarenessRef.current}
              projectId={data.projectId}
              comments={sortedComments}
              highlightedCommentId={highlightedCommentId}
              readOnly
              editorLanguage={selectedFile && isReviewTypstFile(selectedFile.path) ? 'typst' : selectedFile && isReviewLatexLikeFile(selectedFile.path) ? 'latex' : 'plain'}
              currentFilePath={selectedFile?.path}
              projectFiles={reviewFiles.map((file) => ({ path: file.path, mimeType: file.mimeType }))}
              projectTextEntries={reviewFiles}
              editorMode="light"
              revealLocation={revealLocation}
              onSelectionRangeChange={setSelection}
              onCommentActivate={(commentId) => setHighlightedCommentId(commentId)}
              onStartCommentFromSelection={setSelection}
            />
          </section>
          </Panel>

          {showPreview ? (
            <>
            <PanelResizeHandle className="reviewResizeHandle" />
            <Panel defaultSize={isZenMode ? 50 : 34} minSize={22}>
            <section className="reviewPreviewPane">
              {selectedFile && isReviewTypstFile(selectedFile.path) ? (
                previewSession?.ready && previewSession.proxyPath ? (
                  <TypstPreviewFrame
                    key={`${previewSession.sessionId}:${previewSession.proxyPath}`}
                    src={previewSession.proxyPath}
                    entryAbsPath={previewSession.entryAbsPath}
                    onSessionLost={() => setPreviewRefreshNonce((current) => current + 1)}
                    onJump={handlePreviewJump}
                    onContextMenu={handlePreviewContextMenu}
                  />
                ) : (
                  <div className="reviewPreviewPlaceholder">
                    <h2>{isPreviewLoading ? 'Loading Tinymist preview' : 'Tinymist preview unavailable'}</h2>
                    <p>{previewSession?.detail ?? 'Starting the same preview engine used in the Typstr editor.'}</p>
                    {previewDiagnostics.length > 0 ? (
                      <div className="reviewCompileErrors" role="status" aria-live="polite">
                        <strong>Compilation diagnostics</strong>
                        {previewDiagnostics.map((diagnostic, index) => (
                          <article key={`${diagnostic.filePath ?? 'entry'}:${diagnostic.line ?? 'x'}:${diagnostic.column ?? 'x'}:${index}`}>
                            <span>{diagnostic.level}</span>
                            <p>{diagnostic.message}</p>
                            {diagnostic.filePath || diagnostic.line ? (
                              <small>{diagnostic.filePath ?? selectedFile.path}{diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}` : ''}</small>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              ) : selectedFile && isReviewLatexEntryFile(selectedFile.path) ? (
                <PdfPreview
                  pdfUrl={latexPreview?.pdfUrl ?? null}
                  compileError={latexPreview?.error ?? null}
                  isCompiling={isPreviewLoading}
                  comments={[]}
                  canWriteInkComments={false}
                />
              ) : (
                <div className="reviewPreviewPlaceholder">
                  <h2>Preview unavailable for this file type</h2>
                  <p>The signed review workspace can render Typst and LaTeX entry files. Select a .typ or .tex file to preview.</p>
                </div>
              )}
            </section>
            </Panel>
            </>
          ) : null}

          {!isZenMode ? (
          <>
          <PanelResizeHandle className="reviewResizeHandle" />
          <Panel defaultSize={showPreview ? 30 : 38} minSize={24}>
          <aside className="reviewSidebar">
            {message ? <div className="reviewMessage">{message}</div> : null}
            <section className="reviewCard">
              <h2><MessageSquare size={16} aria-hidden /> New Comment</h2>
              {selection ? (
                <>
                  <p>Anchored at {selection.startLine}:{selection.startColumn} - {selection.endLine}:{selection.endColumn}</p>
                  <div className="reviewSelection">{selection.excerpt}</div>
                </>
              ) : (
                <div className="reviewEmptyState">Select source text or right-click selected preview text to anchor feedback.</div>
              )}
              <textarea rows={5} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Add review feedback, suggested wording, or a question…" />
              <button className="reviewPrimaryButton" onClick={submit} disabled={!content.trim() || !authorEmail.trim() || !selection}>
                <MessageSquare size={16} aria-hidden /> Add anchored comment
              </button>
            </section>

            <section className="reviewCard">
              <h2><FileText size={16} aria-hidden /> Threads</h2>
              {sortedComments.length === 0 ? <div className="reviewEmptyState">No anchored comments for this file yet.</div> : null}
              {sortedComments.map((comment) => (
                <article key={comment.id} className={highlightedCommentId === comment.id ? 'reviewThread active' : 'reviewThread'}>
                  <button type="button" onClick={() => jumpToComment(comment)}>
                    <strong>{comment.authorName}</strong>
                    <span>{comment.startLine}:{comment.startColumn} · {comment.status === 'resolved' ? 'addressed' : 'open'}</span>
                  </button>
                  <p>{comment.content}</p>
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="reviewReply">
                      <strong>{reply.authorName}</strong>
                      <p>{reply.content}</p>
                    </div>
                  ))}
                  <textarea
                    rows={2}
                    value={replyDrafts[comment.id] ?? ''}
                    onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))}
                    placeholder="Reply to this thread…"
                  />
                  <button className="reviewSmallButton" onClick={() => void submitReply(comment.id)} disabled={!replyDrafts[comment.id]?.trim()}>
                    <MessageSquare size={14} aria-hidden /> Reply
                  </button>
                </article>
              ))}
            </section>

            <section className="reviewCard">
              <h2><History size={16} aria-hidden /> Revision Diff</h2>
              <select value={activeRevisionId} onChange={(event) => setActiveRevisionId(event.target.value)}>
                <option value="">Latest snapshot vs current</option>
                {data.revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.label}</option>)}
              </select>
              {diff.length > 0 ? (
                <pre className="reviewDiff">{diff.map((entry) => `${entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '-' : ' '} ${entry.text}`).join('\n')}</pre>
              ) : (
                <div className="reviewEmptyState">No revision comparison is available for this file.</div>
              )}
            </section>
          </aside>
          </Panel>
          </>
          ) : null}
          </PanelGroup>
        </main>
      ) : null}
    </div>
  )
}

function buildReviewLineDiff(before: string, after: string): Array<{ kind: 'context' | 'added' | 'removed'; text: string }> {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const max = Math.max(beforeLines.length, afterLines.length)
  const entries: Array<{ kind: 'context' | 'added' | 'removed'; text: string }> = []
  for (let index = 0; index < max; index += 1) {
    const left = beforeLines[index]
    const right = afterLines[index]
    if (left === right) entries.push({ kind: 'context', text: left ?? '' })
    else {
      if (left !== undefined) entries.push({ kind: 'removed', text: left })
      if (right !== undefined) entries.push({ kind: 'added', text: right })
    }
  }
  return entries
}

function formatReviewDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function normalizeTinymistPosition(position: TinymistJumpEvent['start']): { line: number; character: number } {
  if (Array.isArray(position)) {
    return {
      line: Math.max(0, Number(position[0]) || 0),
      character: Math.max(0, Number(position[1]) || 0),
    }
  }
  return { line: Math.max(0, Number(position) || 0), character: 0 }
}

function isReviewTypstFile(path: string): boolean {
  return /\.(typ|typst)$/i.test(path)
}

function isReviewLatexEntryFile(path: string): boolean {
  return /\.(tex|ltx|latex)$/i.test(path)
}

function isReviewLatexLikeFile(path: string): boolean {
  return /\.(tex|ltx|latex|bib|cls|sty|bst|bbx|cbx|def|clo|cfg)$/i.test(path)
}

function createPdfObjectUrl(pdfBase64: string): string {
  const binary = atob(pdfBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}

function excerptFromSourceRange(source: string, startLine: number, startColumn: number, endLine: number, endColumn: number): string {
  const lines = source.split('\n')
  const startIndex = Math.max(0, startLine - 1)
  const endIndex = Math.max(startIndex, endLine - 1)
  const selected = lines.slice(startIndex, endIndex + 1)
  if (selected.length === 0) return ''
  selected[0] = selected[0]?.slice(Math.max(0, startColumn - 1)) ?? ''
  const lastIndex = selected.length - 1
  if (lastIndex === 0) {
    selected[0] = selected[0].slice(0, Math.max(0, endColumn - startColumn))
  } else {
    selected[lastIndex] = selected[lastIndex]?.slice(0, Math.max(0, endColumn - 1)) ?? ''
  }
  const excerpt = selected.join('\n').trim()
  return excerpt.length > 240 ? `${excerpt.slice(0, 237)}...` : excerpt
}

const ACADEMIC_ROLE_LABELS: Record<string, string> = {
  student: 'Student (BSc / MSc)',
  phd_student: 'PhD Student',
  postdoc: 'Postdoctoral Researcher',
  researcher: 'Researcher / Scientist',
  faculty: 'Faculty / Professor',
  staff: 'Research Staff',
  other: 'Other',
}

function AcademicProfileStep({ onDone }: { onDone: () => void }) {
  const [role, setRole] = useState('')
  const [department, setDepartment] = useState('')
  const [institution, setInstitution] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const save = async () => {
    setSubmitting(true)
    try {
      await apiClient.patch('/api/account/academic-profile', {
        academicRole: role || null,
        department: department.trim() || null,
        institutionName: institution.trim() || null,
      })
    } catch {
      // non-critical — let user proceed regardless
    } finally {
      setSubmitting(false)
      onDone()
    }
  }

  return (
    <div className="verificationScreen">
      <div className="verificationPanel">
        <span className="landingEyebrow">TYPSTR</span>
        <h1>Tell us about your research</h1>
        <p>
          Help us tailor citation suggestions and AI recommendations to your field. This is optional and can be updated later.
        </p>
        <label>
          Your role
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={submitting} style={{ width: '100%', padding: '10px 12px', borderRadius: '12px', border: '1px solid var(--panel-border)', background: 'var(--editor-bg)', color: 'var(--text-bright)', fontSize: 'inherit' }}>
            <option value="">— select —</option>
            {Object.entries(ACADEMIC_ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Department / Field
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g. Computer Science, Biochemistry"
            disabled={submitting}
          />
        </label>
        <label>
          Institution
          <input
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="e.g. METU, ETH Zürich, MIT"
            disabled={submitting}
          />
        </label>
        <button className="landingButton" onClick={save} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save and continue'}
        </button>
        <button className="landingButton secondary" onClick={onDone} disabled={submitting} style={{ marginTop: '8px' }}>
          Skip for now
        </button>
      </div>
    </div>
  )
}

function AccountVerificationGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showAcademicProfile, setShowAcademicProfile] = useState(false)
  const verificationSkipKey = `typstr.skipInstitutionEmail.${user?.id ?? 'anonymous'}`
  const [verificationSkipped, setVerificationSkipped] = useState(() => {
    if (typeof window === 'undefined') return false
    return safeStorage.getItem(verificationSkipKey) === '1'
  })

  useEffect(() => {
    let cancelled = false
    apiClient.get<BillingStatus>('/api/billing/status')
      .then((response) => {
        if (!cancelled) setBilling(response.data)
      })
      .catch(() => {
        if (!cancelled) setBilling(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setVerificationSkipped(safeStorage.getItem(verificationSkipKey) === '1')
  }, [verificationSkipKey])

  const startVerification = async () => {
    setSubmitting(true)
    setMessage('')
    try {
      const response = await apiClient.post<{ email: string; domain: string; devCode?: string }>('/api/account/verify-email/start', { email })
      setPendingEmail(response.data.email)
      setMessage(response.data.devCode
        ? `Verification code sent. Dev code: ${response.data.devCode}`
        : `Verification code sent to ${response.data.email}.`)
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Could not send verification code.')
    } finally {
      setSubmitting(false)
    }
  }

  const confirmVerification = async () => {
    setSubmitting(true)
    setMessage('')
    try {
      const response = await apiClient.post<BillingStatus>('/api/account/verify-email/confirm', { email: pendingEmail || email, code })
      const newBilling = response.data
      setBilling(newBilling)
      safeStorage.removeItem(verificationSkipKey)
      setVerificationSkipped(false)
      const isAcademic = newBilling.verifiedDomains.some((d) => d.domainType === 'academic')
      if (isAcademic) {
        setShowAcademicProfile(true)
      } else {
        setMessage('Email domain verified.')
      }
    } catch (error: any) {
      setMessage(error?.response?.data?.error ?? 'Could not verify code.')
    } finally {
      setSubmitting(false)
    }
  }

  if (showAcademicProfile) {
    return <AcademicProfileStep onDone={() => setShowAcademicProfile(false)} />
  }

  if (loading || !billing || !billing.requiresVerification || verificationSkipped) {
    return (
      <>
        {billing && <BillingStatusBanner billing={billing} />}
        {children}
      </>
    )
  }

  return (
    <div className="verificationScreen">
      <div className="verificationPanel">
        <span className="landingEyebrow">TYPSTR</span>
        <h1>Verify your academic or organization email</h1>
        <p>
          Add your school, university, or company email to unlock the student freemium plan and future domain-specific subscriptions.
          Student eligibility requires an academic domain label such as <code>edu</code>, for example <code>metu.edu.tr</code>.
        </p>
        <label>
          Email address
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@metu.edu.tr"
            disabled={submitting}
          />
        </label>
        <button className="landingButton" onClick={startVerification} disabled={submitting || !email.trim()}>
          Send code
        </button>

        {pendingEmail && (
          <label>
            Verification code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="6-digit code"
              inputMode="numeric"
              disabled={submitting}
            />
          </label>
        )}
        {pendingEmail && (
          <button className="landingButton secondary" onClick={confirmVerification} disabled={submitting || code.trim().length !== 6}>
            Verify email
          </button>
        )}
        {message && <p className="verificationMessage">{message}</p>}
        <button
          className="landingButton secondary"
          onClick={() => {
            safeStorage.setItem(verificationSkipKey, '1')
            setVerificationSkipped(true)
          }}
          disabled={submitting}
          style={{ marginTop: '8px' }}
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}

function formatLimitValue(value: number | null, suffix = ''): string {
  return value == null ? 'Unlimited' : `${value}${suffix}`
}

function BillingStatusBanner({ billing }: { billing: BillingStatus }) {
  const totalStorageLimitBytes = billing.limits.totalStorageMb == null ? null : billing.limits.totalStorageMb * 1024 * 1024
  const storagePercent = totalStorageLimitBytes ? Math.min(100, Math.round((billing.usage.totalStorageBytes / totalStorageLimitBytes) * 100)) : 0

  return (
    <aside className="billingBanner" aria-label="Billing status">
      <strong>{billing.plan.replace(/_/g, ' ')}</strong>
      <span>Projects {billing.usage.activeProjects}/{formatLimitValue(billing.limits.activeProjects)}</span>
      <span>Compiles {billing.usage.compilesToday}/{formatLimitValue(billing.limits.compilesPerDay)}</span>
      <span>Storage {storagePercent}%</span>
    </aside>
  )
}

function PlanLimitNotice() {
  const [notice, setNotice] = useState<{ error?: string; limitKey?: string } | null>(null)

  useEffect(() => {
    const onLimit = (event: Event) => {
      const customEvent = event as CustomEvent<{ error?: string; limitKey?: string }>
      setNotice(customEvent.detail)
    }
    window.addEventListener('typstr:plan-limit', onLimit)
    return () => window.removeEventListener('typstr:plan-limit', onLimit)
  }, [])

  if (!notice) return null

  return (
    <div className="planLimitBackdrop" role="presentation" onClick={() => setNotice(null)}>
      <section className="planLimitModal" role="dialog" aria-modal="true" aria-labelledby="plan-limit-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="plan-limit-title">Plan limit reached</h2>
        <p>{notice.error ?? 'This action needs a higher Typstr plan.'}</p>
        <button className="landingButton" onClick={() => setNotice(null)}>Got it</button>
      </section>
    </div>
  )
}

function AppRoutes() {
  const { user, loading, logout } = useAuth()
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (!user) return
    if (import.meta.env.VITE_ENABLE_LATEX_WASM_PDF !== 'true') return

    let cancelled = false

    const warmup = () => {
      if (cancelled) return
      void import('./latexWasm')
        .then(({ warmBusytexAssetsInBackground }) => warmBusytexAssetsInBackground())
        .catch((error) => {
          logger.debug('BusyTeX background warm-up skipped or failed:', error)
        })
    }

    warmup()

    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!user) return

    const touch = () => { lastActivityRef.current = Date.now() }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    for (const event of events) window.addEventListener(event, touch, { passive: true })

    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= INACTIVITY_TIMEOUT_MS) {
        void logout()
      }
    }, 60_000)

    return () => {
      for (const event of events) window.removeEventListener(event, touch)
      clearInterval(timer)
    }
  }, [user, logout])

  if (loading) {
    return <div className="authScreen">Checking session…</div>
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/review/:token" element={<GeminiProvider><AnonymousReviewPage /></GeminiProvider>} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    )
  }

  return (
    <GeminiProvider>
      <ThemeManager>
        <AccountVerificationGate>
          <Suspense fallback={<div className="authScreen">Loading workspace…</div>}>
            <Routes>
              <Route path="/" element={<DocumentList />} />
              <Route path="/admin" element={user.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
              <Route path="/projects/:projectId" element={<EditorPage />} />
              <Route path="/review/:token" element={<AnonymousReviewPage />} />
              <Route path="/doc/:documentId" element={<Navigate to="/" replace />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <PlanLimitNotice />
        </AccountVerificationGate>
      </ThemeManager>
    </GeminiProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
