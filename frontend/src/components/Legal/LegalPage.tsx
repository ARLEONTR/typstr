import { Link } from 'react-router-dom'

type LegalPageProps = {
  title: string
  children: React.ReactNode
}

export function LegalPage({ title, children }: LegalPageProps) {
  return (
    <div className="legalPage">
      <article className="legalPanel">
        <header className="legalHeader">
          <Link to="/" className="legalBack">
            <img src="/logo.svg" alt="Typstr" style={{ height: '24px', verticalAlign: 'middle', marginRight: '8px' }} />
            Back to typstr
          </Link>
          <h1>{title}</h1>
          <p className="legalUpdated">Last updated: September 2, 2026</p>
        </header>
        <div className="legalBody">{children}</div>
      </article>
    </div>
  )
}

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Typstr is an open-source collaborative research and document authoring platform
        operated by ARLEON BİLGİ İLETİŞİM SİBER GÜVENLİK YAZILIM TEKNOLOJİLERİ ARGE VE TİCARET LİMİTED ŞİRKETİ ("we", "us").
        This Privacy Policy explains how information is handled when using the official hosted service at typs.tr.
      </p>

      <h2>1. Self-Hosted vs. Hosted Deployments</h2>
      <p>
        Typstr is free and open-source software licensed under GNU AGPLv3. If you run a self-hosted instance,
        all data remains entirely under your control on your own infrastructure. This policy applies to the official
        hosted instance provided at typs.tr.
      </p>

      <h2>2. Information We Collect</h2>
      <ul>
        <li><strong>Account Information:</strong> When signing in via Google or ORCID, we receive your name, email address, profile picture, and account identifier.</li>
        <li><strong>User Content:</strong> Typst and LaTeX documents, bibliographies, images, comments, and project chat messages you create or upload.</li>
        <li><strong>Google Drive Integration:</strong> If you connect Google Drive, we read and write files strictly within authorized project folders on your behalf.</li>
        <li><strong>AI API Credentials (BYOK):</strong> If you configure personal API keys for OpenAI, Anthropic, or Google Gemini, keys are stored encrypted at rest using AES-256-GCM.</li>
        <li><strong>Technical Logs:</strong> Server request logs, compile status events, and error traces used strictly to maintain reliability and security.</li>
      </ul>

      <h2>3. How We Use Information</h2>
      <ul>
        <li>To authenticate your session and enforce role-based access permissions.</li>
        <li>To provide real-time collaborative editing, live preview streaming, and document compilation.</li>
        <li>To sync files with your Google Drive when that feature is enabled.</li>
        <li>To proxy user-initiated AI writing requests to your selected provider using your configured API key.</li>
        <li>To protect against abuse, denial-of-service, and unauthorized access.</li>
      </ul>

      <h2>4. Data Sharing & Third Parties</h2>
      <p>
        We do not sell personal information or use your private document content to train AI models. Data is shared
        strictly with essential infrastructure providers required to operate the platform (Google OAuth / Drive, ORCID,
        and third-party AI model providers when explicitly invoked by you).
      </p>

      <h2>5. Google API Disclosure</h2>
      <p>
        Typstr's use of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>6. Data Deletion & Rights</h2>
      <p>
        You can delete individual files, revisions, and projects at any time through the workspace interface.
        To request complete account deletion, email{' '}
        <a href="mailto:typstr@arleon.com.tr">typstr@arleon.com.tr</a>.
      </p>

      <h2>7. Security</h2>
      <p>
        We enforce HTTPS encryption in transit, AES-256-GCM encryption at rest for sensitive credentials,
        CSRF verification, and rate limiting.
      </p>

      <h2>8. Contact</h2>
      <p>Questions: <a href="mailto:typstr@arleon.com.tr">typstr@arleon.com.tr</a></p>
    </LegalPage>
  )
}

export function TermsOfService() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Welcome to Typstr. The Typstr source code is free and open source under the GNU AGPLv3 license.
        These Terms govern your use of the official hosted service at typs.tr.
      </p>

      <h2>1. Open Source License</h2>
      <p>
        The source code for Typstr is available under the GNU Affero General Public License v3.0 (AGPLv3).
        If you host or deploy your own instance, your usage of the codebase is governed by the AGPLv3.
      </p>

      <h2>2. Accounts and Eligibility</h2>
      <p>
        You must be at least 13 years of age and eligible to form a binding contract. You are responsible
        for maintaining the confidentiality of your authentication credentials and for all activities under your account.
      </p>

      <h2>3. User Content Ownership</h2>
      <p>
        You retain full ownership and copyright of all documents, text, assets, and bibliographies you create or upload.
        You grant us only the limited license necessary to process, compile, and display your content to you and your designated collaborators.
      </p>

      <h2>4. Acceptable Use</h2>
      <ul>
        <li>Do not upload unlawful, infringing, abusive, or malicious code.</li>
        <li>Do not attempt to disrupt, exploit, or bypass security, rate limits, or container sandboxes.</li>
        <li>Do not perform automated scraping or denial-of-service attacks.</li>
      </ul>

      <h2>5. AI Features & Third-Party Services</h2>
      <p>
        Typstr provides optional Bring Your Own Key (BYOK) AI integrations with providers including Google Gemini,
        Anthropic, and OpenAI. Use of third-party AI features is subject to the respective provider terms.
        You are responsible for reviewing all AI-generated content.
      </p>

      <h2>6. Disclaimer of Warranties & Limitation of Liability</h2>
      <p>
        The Service is provided "as is" and "as available" without warranties of any kind.
        To the maximum extent permitted by law, Typstr, its maintainers, and Arleon Teknoloji shall not be
        liable for any indirect, incidental, special, or consequential damages or loss of data.
      </p>

      <h2>7. Termination</h2>
      <p>
        You may discontinue using Typstr at any time. We reserve the right to suspend or terminate access
        for violations of these Terms or abusive activity.
      </p>

      <h2>8. Contact</h2>
      <p>
        Inquiries and security disclosures:{' '}
        <a href="mailto:typstr@arleon.com.tr">typstr@arleon.com.tr</a>
      </p>
    </LegalPage>
  )
}
