# A MONEY PORTFOLIO

A MONEY PORTFOLIO is a local web application for managing personal investments and savings in one place. It supports Korean and international stocks, ETFs, savings products, transactions, dividends, realized returns, portfolio analytics, and rule-based financial planning.

> **Detailed project article:** [A MONEY PORTFOLIO project overview](https://star7sss.tistory.com/1141)

> [!NOTE]
> All accounts, transactions, holdings, savings products, and dividend records in this demo are fictional sample data. They do not represent actual investment performance or real financial-product terms.

## Demo Data

The included sample portfolio demonstrates:

- Purchases, sales, and realized gains for Korean stocks
- Recurring purchases of Korea-listed international index ETFs
- A USD-denominated `VOO` position with USD/KRW conversion
- A diversified portfolio containing gold and interest-rate-sensitive assets
- Dividends from Korean stocks, Korean ETFs, and international ETFs
- Fictional savings products with base rates, bonus rates, and government contributions

Running **Reset Data** in Settings deletes browser-side changes and restores this original sample portfolio.

## Key Features

- Dashboard for total assets, invested capital, profit and loss, returns, and monthly net-worth trends
- Portfolio allocation analysis by security, risk level, asset class, country, account, and currency
- Holdings management for Korean and international stocks and ETFs
- KRW valuation of foreign assets using exchange rates
- CRUD operations for accounts, securities, purchases, sales, and dividends
- Savings-product management for rates, bonus conditions, contributions, payment schedules, and estimated maturity proceeds
- Performance analysis for realized gains and dividends by month and security
- Rule-based split-buy, split-sell, and watch guidance using allocation, returns, and price trends
- Historical price charts, related news, and portfolio comments
- Column filtering and ascending or descending table sorting
- Excel import for transactions and dividends
- Downloadable `.xlsx` templates with instructions and data-entry sheets
- JSON backup and restore, CSV export, data validation, and data reset

## Requirements

- Windows 10 or later
- Windows PowerShell 5.1 or PowerShell 7
- A modern web browser
- Internet access for live prices, exchange rates, news, and dividend history

No package installation or external database is required.

## Running the Application

### Quick Start

Run `start-app.cmd`. The local server starts in the background and opens:

```text
http://localhost:8780/
```

### PowerShell

From the project directory, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\server.ps1 -Port 8780
```

To use a different port, change the `-Port` value:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\server.ps1 -Port 9000
```

## Basic Usage

### Dashboard

The dashboard summarizes total assets, profit and loss, net-worth trends, asset allocation, and risk distribution. Select a summary signal card to inspect the securities behind that signal. Select a holding to open its historical price chart and related news.

### Holdings

Holdings are aggregated by account and security and are displayed by valuation. Select a security name to open the same market-data dialog used in Financial Planning. Double-click a sortable column header to cycle through ascending, descending, and unsorted states.

### Savings

Add or edit a product to manage its institution, product name, contribution amount, maturity date, interest rate, and notes. Select a rate to add, edit, remove, or activate bonus-rate conditions. Government contributions can also be included in estimated maturity proceeds.

### Transactions and Dividends

Use **Add Transaction** to enter the date, account, security, transaction type, quantity, and unit price. Transactions are displayed newest first and can be filtered by account, security, or type. Existing records can be edited or deleted.

For bulk entry, download the transaction template, complete its data-entry sheet, and select **Excel Upload**. Dividend records have a separate Excel template and upload action.

For dividends, enter the payment month, security, and net amount received. The application calculates the eligible quantity and net dividend per share using the security's dividend schedule and transaction history across all accounts.

Before applying an Excel import, the application reports valid rows, duplicates, and rejected rows. Existing matching records are not imported twice.

### Performance

Review realized trading gains, net dividends, and total confirmed income for a selected period. Select a month in the dividend chart or an amount in the security summary to open its supporting transaction or dividend records.

### Financial Planning

Financial Planning lists current holdings by invested amount and evaluates quantity, invested capital, current price, average purchase price, return, allocation, and recent price trend. It provides rule-based split-buy, split-sell, or watch guidance. Select a security to view its price history and news.

> [!IMPORTANT]
> Financial Planning results are rule-based reference information, not investment advice or a forecast of future returns.

### Settings and Data Management

- **Account Master Data:** Manage Korean and international accounts and their default currencies.
- **Security Master Data:** Manage names, symbols, markets, currencies, risk levels, countries, asset classes, and current prices.
- **Full Backup:** Save all `wb-` browser storage data as JSON in the project's `백업파일` directory.
- **Restore Backup:** Restore a backup selected from the project backup list or load a JSON file from another location.
- **CSV Export:** Export transactions and holdings in a format that can be opened in spreadsheet software.
- **Excel Templates and Import:** Download guided `.xlsx` templates and merge completed transaction or dividend data into the portfolio.
- **Validate Data:** Check stored JSON structures and required fields.
- **Reset Data:** Delete browser-side changes and restore the bundled demo portfolio.

## Market Data Sources

`server.ps1` proxies requests to the following external services:

- Korean market prices: Naver Finance
- International market prices: Nasdaq
- Exchange rates: European Central Bank reference rates
- News: Google News RSS
- Dividend history: Stock Analysis

Requests may be delayed or fail because of network conditions, source-service limits, or invalid symbols. Use a six-digit code for Korean securities and a ticker such as `VOO` for US securities.

## Data Storage and Backups

User-entered data is stored in the current browser's `localStorage`, not in a server-side database.

- Clearing browser data or opening the application in a different browser or computer does not transfer the portfolio automatically.
- After important changes, use **Settings → Data and Backup → Full Backup**.
- Backup files are stored as `백업파일\a-money-portfolio-전체백업-YYYY-MM-DD-HHMMSS.json`.
- Restore a project backup from the backup list or use the secondary file picker for JSON files stored elsewhere.
- CSV exports are intended for viewing and analysis; they cannot restore the complete application state.

## Project Structure

```text
.
├─ index.html                    # Main UI, base styles, and core behavior
├─ portfolio-enhancements.js     # Portfolio calculations, CRUD, charts, and extended UI
├─ portfolio-data.js             # Fictional data bundled with the demo
├─ server.ps1                    # Static-file server and proxy API
├─ start-app.cmd                 # Windows quick-start script
├─ 백업파일/                      # Runtime JSON backup directory
├─ tests/                        # Syntax and Excel-template verification scripts
└─ assets/                       # Logo and image assets
```

## Verification

The `tests` directory contains standalone checks for JavaScript syntax and generated Excel workbooks:

```powershell
node .\tests\verify-script-syntax.mjs
node .\tests\verify-excel-upload-templates.mjs
```

## Publishing on GitHub

This demo contains fictional data and is suitable for a public repository. Do not commit personal JSON or CSV exports, actual source workbooks, or backups created from real portfolio data.

GitHub Pages serves static files only and cannot run the PowerShell server. When hosted only on GitHub Pages, the following server-backed endpoints are unavailable:

- `/api/market`
- `/api/news`
- `/api/fx`
- `/api/dividends`
- `/api/backup`
- `/api/backups`

Run the project locally with `server.ps1` for full functionality, or migrate these endpoints to a separately hosted web backend.

## Troubleshooting

- **The page shows an older version:** Perform a hard refresh with `Ctrl+F5`.
- **The page does not open:** Run `server.ps1` in PowerShell and confirm that port `8780` is available.
- **Prices or news do not load:** Open `http://localhost:8780/` instead of opening `index.html` directly.
- **A security has no current price:** Check its symbol, market, and currency in Security Master Data, then refresh prices.
- **Portfolio data must be recovered:** Restore a JSON backup from Settings. Data reset without a backup cannot be undone.

## Disclaimer

This project is intended for feature demonstration and personal record keeping. Its data, calculations, and financial-planning output do not constitute investment advice. Users are solely responsible for their investment decisions and results.

