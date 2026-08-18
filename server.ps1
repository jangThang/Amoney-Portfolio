param([int]$Port = 8780)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupFolderName = -join ([char[]](0xBC31, 0xC5C5, 0xD30C, 0xC77C))
$fullBackupLabel = -join ([char[]](0xC804, 0xCCB4, 0xBC31, 0xC5C5))
$backupRoot = Join-Path $projectRoot $backupFolderName
if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
}
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Wealthboard running at http://localhost:$Port/"
$dividendHistoryCache = @{}

function Send-Response($response, [byte[]]$bytes, [string]$contentType, [int]$status = 200) {
  $response.StatusCode = $status
  $response.ContentType = $contentType
  $response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}

function Send-Json($response, $value, [int]$status = 200) {
  $json = $value | ConvertTo-Json -Depth 8 -Compress
  Send-Response $response ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8' $status
}

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $path = $request.Url.AbsolutePath

    if ($path -eq '/api/backup' -and $request.HttpMethod -eq 'POST') {
      if ($request.ContentLength64 -gt 10MB) {
        Send-Json $response @{ error = 'backup_too_large' } 413
        continue
      }
      $reader = [IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
      try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
      try {
        $payload = $body | ConvertFrom-Json -ErrorAction Stop
        if ($payload.application -notin @('A_MONEY_PORTFOLIO', 'WEALTHBOARD') -or -not $payload.data) {
          throw 'invalid_backup_payload'
        }
      } catch {
        Send-Json $response @{ error = 'invalid_backup_payload' } 400
        continue
      }
      $stamp = (Get-Date).ToString('yyyy-MM-dd-HHmmss')
      $fileName = "a-money-portfolio-$fullBackupLabel-$stamp.json"
      $backupPath = Join-Path $backupRoot $fileName
      try {
        [IO.File]::WriteAllText($backupPath, $body, [Text.UTF8Encoding]::new($false))
      } catch {
        Send-Json $response @{ error = 'backup_write_failed'; message = $_.Exception.Message; target = [string]$backupPath } 500
        continue
      }
      Send-Json $response @{
        saved = $true
        fileName = $fileName
        relativePath = "$backupFolderName\$fileName"
        savedAt = (Get-Date).ToString('o')
      }
      continue
    }

    if ($path -eq '/api/backups' -and $request.HttpMethod -eq 'GET') {
      $items = @(Get-ChildItem -LiteralPath $backupRoot -File -Filter '*.json' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object {
          @{
            fileName = $_.Name
            size = $_.Length
            modifiedAt = $_.LastWriteTime.ToString('o')
          }
        })
      Send-Json $response @{ folder = $backupFolderName; items = $items }
      continue
    }

    if ($path -eq '/api/backup' -and $request.HttpMethod -eq 'GET') {
      $name64 = [string]$request.QueryString['name64']
      try {
        $fileName = if ($name64) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($name64)) } else { [string]$request.QueryString['name'] }
      } catch {
        Send-Json $response @{ error = 'invalid_backup_name' } 400
        continue
      }
      if ([string]::IsNullOrWhiteSpace($fileName) -or [IO.Path]::GetFileName($fileName) -ne $fileName -or $fileName -notmatch '\.json$') {
        Send-Json $response @{ error = 'invalid_backup_name' } 400
        continue
      }
      $backupPath = Join-Path $backupRoot $fileName
      if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
        Send-Json $response @{ error = 'backup_not_found' } 404
        continue
      }
      Send-Response $response ([IO.File]::ReadAllBytes($backupPath)) 'application/json; charset=utf-8'
      continue
    }

    if ($path -eq '/api/fx') {
      $currency = ([string]$request.QueryString['currency']).Trim().ToUpperInvariant()
      if ($currency -notmatch '^[A-Z]{3}$') {
        Send-Json $response @{ error = 'invalid_currency' } 400
        continue
      }
      if ($currency -eq 'KRW') {
        Send-Json $response @{ source = 'KRW'; currency = 'KRW'; quote = 'KRW'; rate = 1; date = (Get-Date).ToString('yyyy-MM-dd') }
        continue
      }
      [xml]$feed = (Invoke-WebRequest -Uri 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml' -UseBasicParsing -TimeoutSec 20 -Headers @{ 'User-Agent' = 'Mozilla/5.0' }).Content
      $timeCube = $feed.Envelope.Cube.Cube
      $rates = @{}
      foreach ($cube in $timeCube.Cube) {
        $rates[[string]$cube.currency] = [double]$cube.rate
      }
      if (-not $rates.ContainsKey('KRW') -or ($currency -ne 'EUR' -and -not $rates.ContainsKey($currency))) {
        Send-Json $response @{ error = 'currency_not_supported'; currency = $currency } 404
        continue
      }
      $currencyPerEuro = if ($currency -eq 'EUR') { 1.0 } else { [double]$rates[$currency] }
      $krwPerCurrency = [double]$rates['KRW'] / $currencyPerEuro
      Send-Json $response @{
        source = 'ECB reference rate'
        currency = $currency
        quote = 'KRW'
        rate = [math]::Round($krwPerCurrency, 6)
        date = [string]$timeCube.time
      }
      continue
    }

    if ($path -eq '/api/market') {
      $symbol = ([string]$request.QueryString['code']).Trim()
      if ([string]::IsNullOrWhiteSpace($symbol) -or $symbol -notmatch '^[A-Za-z0-9.\-]{1,20}$') {
        Send-Json $response @{ error = 'invalid_code' } 400
        continue
      }
      $range = $request.QueryString['range']
      $days = switch ($range) {
        '1w' { 10 }
        '3m' { 100 }
        '6m' { 190 }
        '1y' { 375 }
        default { 40 }
      }
      $endDate = Get-Date
      $startDate = $endDate.AddDays(-$days)
      if ($symbol -match '^\d{6}$') {
        $url = 'https://m.stock.naver.com/front-api/external/chart/domestic/info?symbol={0}&requestType=1&startTime={1}&endTime={2}&timeframe=day' -f $symbol, $startDate.ToString('yyyyMMdd'), $endDate.ToString('yyyyMMdd')
        $content = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -Headers @{ 'User-Agent' = 'Mozilla/5.0' }).Content
        $matches = [regex]::Matches($content, '\["(?<date>\d{8})",\s*(?<open>[\d.]+),\s*(?<high>[\d.]+),\s*(?<low>[\d.]+),\s*(?<close>[\d.]+),\s*(?<volume>[\d.]+)')
        $items = @($matches | ForEach-Object {
          @{
            date = '{0}-{1}-{2}' -f $_.Groups['date'].Value.Substring(0,4), $_.Groups['date'].Value.Substring(4,2), $_.Groups['date'].Value.Substring(6,2)
            open = [double]$_.Groups['open'].Value
            high = [double]$_.Groups['high'].Value
            low = [double]$_.Groups['low'].Value
            close = [double]$_.Groups['close'].Value
            volume = [double]$_.Groups['volume'].Value
          }
        })
        Send-Json $response @{ source = 'NAVER Finance'; currency = 'KRW'; items = $items }
      } else {
        $normalizedSymbol = $symbol.ToUpperInvariant()
        $headers = @{
          'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          'Accept' = 'application/json'
          'Origin' = 'https://www.nasdaq.com'
        }
        $market = $null
        $assetClass = $null
        foreach ($candidateClass in @('stocks', 'etf')) {
          $url = 'https://api.nasdaq.com/api/quote/{0}/historical?assetclass={1}&fromdate={2}&limit=5000' -f [Uri]::EscapeDataString($normalizedSymbol), $candidateClass, $startDate.ToString('yyyy-MM-dd')
          $candidate = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -Headers $headers).Content | ConvertFrom-Json
          $candidateRows = @($candidate.data.tradesTable.rows | Where-Object { $_ -and $_.date -and $_.close })
          if ($candidate.status.rCode -eq 200 -and $candidateRows.Count -gt 0) {
            $market = $candidate
            $assetClass = $candidateClass
            break
          }
        }
        if (-not $market) {
          Send-Json $response @{ error = 'symbol_not_found'; code = $normalizedSymbol } 404
          continue
        }
        $items = @($market.data.tradesTable.rows | Where-Object { $_ -and $_.date -and $_.close } | ForEach-Object {
          $parsedDate = [datetime]::ParseExact([string]$_.date, 'MM/dd/yyyy', [Globalization.CultureInfo]::InvariantCulture)
          @{
            date = $parsedDate.ToString('yyyy-MM-dd')
            open = [double](($_.open -replace '[$,]', ''))
            high = [double](($_.high -replace '[$,]', ''))
            low = [double](($_.low -replace '[$,]', ''))
            close = [double](($_.close -replace '[$,]', ''))
            volume = [double](($_.volume -replace ',', ''))
          }
        } | Sort-Object { [string]$_['date'] })
        $source = if ($assetClass -eq 'etf') { 'Nasdaq ETF' } else { 'Nasdaq' }
        Send-Json $response @{ source = $source; currency = 'USD'; code = $normalizedSymbol; items = $items }
      }
      continue
    }

    if ($path -eq '/api/news') {
      $query64 = $request.QueryString['q64']
      $query = if ($query64) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($query64)) } else { $request.QueryString['q'] }
      if ([string]::IsNullOrWhiteSpace($query)) {
        Send-Json $response @{ error = 'invalid_query' } 400
        continue
      }
      $url = 'https://news.google.com/rss/search?q={0}&hl=ko&gl=KR&ceid=KR:ko' -f [Uri]::EscapeDataString($query)
      [xml]$feed = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -Headers @{ 'User-Agent' = 'Mozilla/5.0' }).Content
      $items = @($feed.rss.channel.item | Where-Object { $_ -and $_.title } | Select-Object -First 8 | ForEach-Object {
        $published = if ($_.pubDate) { ([datetime]$_.pubDate).ToString('yyyy-MM-dd HH:mm') } else { '' }
        @{
          title = [string]$_.title
          link = [string]$_.link
          publisher = [string]$_.source.'#text'
          publishedAt = $published
        }
      })
      Send-Json $response @{ source = 'Google News'; items = $items }
      continue
    }

    if ($path -eq '/api/dividends') {
      $symbol = ([string]$request.QueryString['code']).Trim()
      $kind = ([string]$request.QueryString['kind']).Trim().ToLowerInvariant()
      if ([string]::IsNullOrWhiteSpace($symbol) -or $symbol -notmatch '^[A-Za-z0-9.\-]{1,20}$') {
        Send-Json $response @{ error = 'invalid_code' } 400
        continue
      }

      $normalizedSymbol = $symbol.ToUpperInvariant()
      $cacheKey = "$normalizedSymbol|$kind"
      $cached = $dividendHistoryCache[$cacheKey]
      if ($cached -and ((Get-Date) - $cached.savedAt).TotalHours -lt 12) {
        Send-Json $response $cached.payload
        continue
      }

      if ($normalizedSymbol -match '^\d{6}$') {
        $candidateUrls = @('https://stockanalysis.com/quote/krx/{0}/dividend/' -f $normalizedSymbol)
      } else {
        $slug = $normalizedSymbol.ToLowerInvariant()
        $candidateUrls = if ($kind -eq 'etf') {
          @(
            ('https://stockanalysis.com/etf/{0}/dividend/' -f $slug),
            ('https://stockanalysis.com/stocks/{0}/dividend/' -f $slug)
          )
        } else {
          @(
            ('https://stockanalysis.com/stocks/{0}/dividend/' -f $slug),
            ('https://stockanalysis.com/etf/{0}/dividend/' -f $slug)
          )
        }
      }

      $items = @()
      $sourceUrl = ''
      foreach ($url in $candidateUrls) {
        try {
          $content = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 12 -Headers @{
            'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            'Accept' = 'text/html,application/xhtml+xml'
          }).Content
          $matches = [regex]::Matches($content, '\{dt:"(?<ex>\d{4}-\d{2}-\d{2})",amt:"(?<amount>[^"]*)",dec:"[^"]*",record:"(?<record>[^"]*)",pay:"(?<pay>[^"]*)"\}')
          $items = @($matches | ForEach-Object {
            @{
              exDividendDate = $_.Groups['ex'].Value
              recordDate = if ($_.Groups['record'].Value -match '^\d{4}-\d{2}-\d{2}$') { $_.Groups['record'].Value } else { '' }
              paymentDate = if ($_.Groups['pay'].Value -match '^\d{4}-\d{2}-\d{2}$') { $_.Groups['pay'].Value } else { '' }
              amount = $_.Groups['amount'].Value
            }
          })
          if ($items.Count -gt 0) {
            $sourceUrl = $url
            break
          }
        } catch {
          continue
        }
      }

      if ($items.Count -eq 0) {
        Send-Json $response @{ error = 'dividend_history_not_found'; code = $normalizedSymbol } 404
        continue
      }

      $payload = @{
        source = 'Stock Analysis dividend history'
        sourceUrl = $sourceUrl
        code = $normalizedSymbol
        items = $items
      }
      $dividendHistoryCache[$cacheKey] = @{ savedAt = Get-Date; payload = $payload }
      Send-Json $response $payload
      continue
    }

    $relativePath = if ($path -eq '/') { 'index.html' } else { $path.TrimStart('/') }
    $candidate = [IO.Path]::GetFullPath((Join-Path $projectRoot $relativePath))
    if (-not $candidate.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      Send-Response $response ([Text.Encoding]::UTF8.GetBytes('Not found')) 'text/plain; charset=utf-8' 404
      continue
    }
    $contentType = switch ([IO.Path]::GetExtension($candidate).ToLowerInvariant()) {
      '.html' { 'text/html; charset=utf-8' }
      '.js' { 'application/javascript; charset=utf-8' }
      '.css' { 'text/css; charset=utf-8' }
      default { 'application/octet-stream' }
    }
    Send-Response $response ([IO.File]::ReadAllBytes($candidate)) $contentType
  } catch {
    try { Add-Content -LiteralPath (Join-Path $projectRoot 'server-errors.log') -Value ("{0:u} {1} {2}" -f (Get-Date), $path, $_.Exception.ToString()) -Encoding UTF8 } catch {}
    try { Send-Json $response @{ error = 'upstream_failure'; message = $_.Exception.Message } 502 } catch {}
  }
}

