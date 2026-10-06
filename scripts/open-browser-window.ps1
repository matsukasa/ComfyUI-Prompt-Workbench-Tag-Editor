param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [switch]$WaitForServer
)

$ErrorActionPreference = 'Stop'

if ($WaitForServer) {
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { exit 1 }
}

$browserPath = $null
try {
    $association = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice'
    $command = (Get-Item "Registry::HKEY_CLASSES_ROOT\$($association.ProgId)\shell\open\command").GetValue('')
    if ($command -match '^"([^"]+\.exe)"|^([^\s]+\.exe)') {
        $browserPath = $Matches[1]
        if (-not $browserPath) { $browserPath = $Matches[2] }
    }
} catch { }

$browserName = if ($browserPath) { [IO.Path]::GetFileName($browserPath) } else { '' }
if ($browserName -notin @('chrome.exe', 'msedge.exe', 'firefox.exe', 'vivaldi.exe', 'brave.exe', 'opera.exe') -or -not (Test-Path -LiteralPath $browserPath)) {
    # Edge provides a new-window fallback for unsupported URL handlers.
    $browserPath = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $browserPath) {
    throw 'No supported browser was found for opening a new window.'
}
$windowOption = if ([IO.Path]::GetFileName($browserPath) -eq 'firefox.exe') { '-new-window' } else { '--new-window' }
Start-Process -FilePath $browserPath -ArgumentList @($windowOption, ('"{0}"' -f $Url))
