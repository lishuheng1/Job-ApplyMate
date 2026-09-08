# Job ApplyMate

<p align="center">
  <img src="public/icons/job-applymate-master.png" width="160" alt="Job ApplyMate mascot holding an OFFER sign">
</p>

<p align="center">
  <a href="README.md">中文</a> · <strong>English</strong>
</p>

Job ApplyMate is a Chrome and Edge extension that keeps job-application information in one place and fills online application forms with your personal profile, education, work experience, projects, and resume.

## Highlights

| Feature | Description |
|---|---|
| Profile management | Store personal information, separate undergraduate/graduate education, work experience, projects, skills, certificates, and custom fields |
| Quick Fill | Detect common recruitment-form fields and fill them from your saved profile |
| Logical form detection | Treat radio/checkbox groups, split date controls, and repeated experience rows as complete questions instead of unrelated inputs |
| Smart date adaptation | Adapt year, month, and date values to the format required by the website; `2020.06`, `2020.6`, and `2020-06` are treated as the same month |
| Reliable dropdown filling | Handle common UI libraries, delayed options, searchable selects, multi-selects, and cascaders; verify the committed value to avoid positive/negative mismatches |
| Failure review and learning | Review fields that could not be filled, correct and remember a value, skip one item, or skip all failures for the current run |
| AI Page Scan | Match the page as structured form blocks and keep every education, work, or project block bound to one profile record |
| AI Region Fill | Select a form area and use a vision-capable model to fill only the empty controls in that area |
| Information panel | Focus a web form control and write one saved profile value at a time; rejected values are copied automatically |
| Resume library | Store role-specific resumes with independent parsed profiles and original filenames; switching a resume updates overlay data, autofill values, and file upload together |
| Resume parsing | Import PDF, DOCX, Markdown, TXT, and structured JSON resumes |
| Application tracker | Create, filter, sort, edit, delete, and import/export application records as CSV |
| Backup and sync | Versioned JSON import/export and optional conflict-aware WebDAV synchronization |

## Install

### Install a release build

1. Open the repository's **Releases** page, or download [`release/job-applymate-extension.zip`](release/job-applymate-extension.zip) directly from the repository.
2. Download `job-applymate-extension.zip` from the latest release when one is available.
3. Extract the ZIP file. Browsers cannot load the ZIP directly.
4. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
5. Enable **Developer mode**.
6. Click **Load unpacked** and select the extracted folder.
7. Pin **Job ApplyMate** to the browser toolbar.

### Build from source

Requirements:

- Chrome or Edge 116+
- Node.js 20.19+ or 22.12+
- npm

```bash
npm ci
npm test
npm run build
```

Load the generated `dist/` directory as an unpacked extension. To create the release ZIP, run:

```bash
npm run package:extension
```

## Usage

### 1. Set up your profile

1. Click the extension icon.
2. Select **设置个人信息** (Profile Settings).
3. Enter your personal information, education, work experience, projects, and custom values.
4. Click **保存设置** (Save Settings).

Add undergraduate and graduate education as separate records. Each record keeps its own school, college/department, major, major category/discipline, study mode, education level, academic degree, and dates. When a form explicitly says undergraduate or graduate, the matching record is selected instead of relying only on list order.
If a resume did not yield a college, major category, or degree, matching manually maintained education data fills only those missing values without replacing data already parsed from that resume.

AI configuration is optional. Regular profile management, local resume parsing, Quick Fill, the information panel, and JSON import/export work without AI.

### 2. Import a resume

Open **简历库** (Resume Library) in Settings, enter an internal category such as Product or Operations, and add a PDF, DOCX, Markdown, TXT, or structured JSON file. Job ApplyMate preserves the original filename and stores an independent parsed profile for every resume, so adding a new file no longer overwrites existing profile data. AI parsing falls back to local rules after 45 seconds instead of remaining stuck. Choose a resume in the popup to switch the information overlay, Quick Fill, AI Fill, and uploaded file together.

### 3. Fill an application form

1. Open a job application or resume form.
2. Click the Job ApplyMate icon.
3. In **本次简历** (Resume for this fill), choose no automatic upload or one categorized resume.
4. Select **快速填充** (Quick Fill). Only the explicitly selected resume is uploaded.
5. Review all values written to the page.
6. If a field could not be filled, use the review panel in the lower-right corner:
   - enter a corrected value and choose **填写并记住** (Fill and Remember);
   - choose **本次不填** (Skip This Time) for one item; or
   - choose **本次全部不填** (Skip All This Time).

Learned values are isolated by website and logical field. When a correction matches a saved profile value, Job ApplyMate remembers the profile path as well, so later profile edits can flow into the learned field instead of reusing stale text.

### 4. Use AI Page Scan

Configure an AI provider in **AI 设置**, open an application page, choose no resume or a specific file in **本次简历**, and select **AI 扫描填充**. Job ApplyMate first fills fields covered by local rules and learned corrections, then asks AI for each remaining field and commits every verified answer immediately. Cancelling or timing out keeps the values already written. Verified results are cached for the same site, profile, and field. Resume files, extracted resume text, and internal record IDs are excluded from page-scan requests. Existing non-empty fields are not overwritten.

### 5. Use AI Region Fill

Configure a vision-capable model and select **AI 框选补填**. Click a detected form section or drag a custom rectangle. Only empty writable controls inside that area are considered. Press `Esc` to cancel region selection.

### 6. Use the information panel

Select **打开信息浮窗** to pin the panel directly inside the current application page. You can drag it and its position is remembered. Focus an input, textarea, or dropdown, then click a value in the panel. If the site rejects direct writing, the value is copied so you can paste it manually.

### 7. Track applications

Use **新建投递记录** to save the current position, or **打开投递记录** to view all records. Records support sorting, filtering, inline editing, deletion, and CSV import/export.

### 8. Backup and restore

Open **数据与同步**:

- **导出完整数据** downloads a versioned JSON backup.
- **导入完整数据** validates a previous JSON backup before replacing local profile data.
- Existing backups from the earlier project version remain importable.

The legacy WebDAV path is intentionally retained for backward compatibility:

```text
job-application-helper/
└── job-application-helper.json
```

Backups can contain personal information, resume files, AI configuration, and API keys. Store them securely.

## Development commands

```bash
npm test                 # Run automated tests
npm run build            # Type-check and build dist/
npm run lint             # Run static checks
npm run dev              # Start the Vite development server
npm run package:extension # Build the release ZIP
```

## Tech stack

- React 19
- TypeScript 6
- Vite 8
- Chrome Extension Manifest V3
- Ant Design 6
- PDF.js, Mammoth, and Marked

## Data and privacy

- Data is stored in `chrome.storage.local` by default.
- JSON imports are limited to 20 MiB.
- Manual backups and WebDAV backups are plain JSON and may contain sensitive profile data and AI API keys.
- Data is sent to WebDAV only after the user explicitly configures and enables synchronization.
- Export a backup before uninstalling the extension or clearing extension data.

## License

MIT License
