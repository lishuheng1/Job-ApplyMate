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
| Profile management | Store personal information, education, work experience, projects, skills, certificates, and custom fields |
| Quick Fill | Detect common recruitment-form fields and fill them from your saved profile |
| Smart date adaptation | Adapt year, month, and date values to the format required by the website; `2020.06`, `2020.6`, and `2020-06` are treated as the same month |
| Failure review and learning | Review fields that could not be filled, correct and remember a value, skip one item, or skip all failures for the current run |
| AI Page Scan | Match and fill complex fields with a configured AI provider |
| AI Region Fill | Select a form area and use a vision-capable model to fill only the empty controls in that area |
| Information panel | Focus a web form control and write one saved profile value at a time; rejected values are copied automatically |
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

AI configuration is optional. Regular profile management, local resume parsing, Quick Fill, the information panel, and JSON import/export work without AI.

### 2. Import a resume

Open **简历上传** (Resume Upload) in Settings and select a PDF, DOCX, Markdown, TXT, or structured JSON file. Review the parsed information and save the profile before filling forms.

### 3. Fill an application form

1. Open a job application or resume form.
2. Click the Job ApplyMate icon.
3. Select **快速填充** (Quick Fill).
4. Review all values written to the page.
5. If a field could not be filled, use the review panel in the lower-right corner:
   - enter a corrected value and choose **填写并记住** (Fill and Remember);
   - choose **本次不填** (Skip This Time) for one item; or
   - choose **本次全部不填** (Skip All This Time).

Learned values are isolated by website and field. The next time the same field is found on the same website, Job ApplyMate tries the learned value before normal matching—even if that field is not recognized by the built-in matcher.

### 4. Use AI Page Scan

Configure an AI provider in **AI 设置**, open an application page, and select **AI 扫描填充**. Job ApplyMate groups empty controls by profile section, sends their labels, context, and available options to the configured model, and writes validated results back to the page. Existing non-empty fields are not overwritten.

### 5. Use AI Region Fill

Configure a vision-capable model and select **AI 框选补填**. Click a detected form section or drag a custom rectangle. Only empty writable controls inside that area are considered. Press `Esc` to cancel region selection.

### 6. Use the information panel

Select **打开信息浮窗**, focus an input, textarea, or dropdown on the application page, and then click a value in the panel. If the site rejects direct writing, the value is copied so you can paste it manually.

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
