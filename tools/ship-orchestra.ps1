#requires -Version 7.0
<#
.SYNOPSIS
    Applies the orchestration-confirmation change, runs the test suite, pushes to
    origin/main and dev-deploys the ucode sources to the OpenWrt router.

.DESCRIPTION
    Stages run in order and each one aborts the whole script on failure:

        preflight  repo/branch/tooling checks, router reachability, /tmp space
        patch      git apply + tools/apply-orchestra-wiring.py (idempotent)
        test       tools/run-all-tests.sh (via WSL) or node --test fallback
        push       commit + push to origin/main, local SHA == remote SHA proof
        deploy     backup + scp the ucode sources, remote syntax check, rollback
        verify     sha256 local vs router for every deployed file

    The deploy stage is a DEVELOPMENT file drop, not a package install. It exists
    so a change can be exercised on the live router before an APK is built. A
    checkpoint is not complete until the same code ships as an installed APK.

    Safety rules honoured by this script:
      - never restarts rpcd (that kills LuCI sessions) unless -RestartRpcd is
        passed explicitly, and then exactly once, at the very end
      - never touches the router root password
      - refuses to deploy when /tmp free space is below -MinTmpKb
      - backs up every replaced file and restores it if the remote syntax check
        or the checksum verification fails
      - --force-broken-world is never used anywhere

.EXAMPLE
    pwsh -File tools/ship-orchestra.ps1 -Patch C:\Users\Kirill\Downloads\orchestra-confirmation.patch -WhatIf

.EXAMPLE
    pwsh -File tools/ship-orchestra.ps1 -Patch .\orchestra-confirmation.patch

.EXAMPLE
    pwsh -File tools/ship-orchestra.ps1 -Stage test,push
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string] $RepoPath = 'G:\zapret2-manager',
    [string] $Patch,
    [string] $Branch = 'main',
    [string] $Remote = 'origin',
    [string] $CommitMessage = 'orchestra: gate PASS on real markers, confirm winners twice, verify Discord targets for real',
    [ValidateSet('key', 'preflight', 'patch', 'test', 'push', 'deploy', 'verify')]
    [string[]] $Stage = @('preflight', 'patch', 'test', 'push', 'deploy', 'verify'),
    [string] $Router = '192.168.1.1',
    [string] $RouterUser = 'root',
    [int] $RouterPort = 22,
    [string] $SshKey,
    [int] $MinTmpKb = 20480,
    [string] $RouterPassword = '',
    [switch] $RestartRpcd,
    [switch] $AllowDirtyTree
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

# --------------------------------------------------------------------------
# plumbing
# --------------------------------------------------------------------------

$script:StartedAt = Get-Date
$script:Deployed = [System.Collections.Generic.List[hashtable]]::new()

function Write-Stage { param([string] $Name) Write-Host "`n=== $Name" -ForegroundColor Cyan }
function Write-Step { param([string] $Text) Write-Host "  -> $Text" -ForegroundColor Gray }
function Write-Good { param([string] $Text) Write-Host "  OK  $Text" -ForegroundColor Green }
function Write-Warn2 { param([string] $Text) Write-Host "  !!  $Text" -ForegroundColor Yellow }
function Fail { param([string] $Text) throw $Text }

function Invoke-Native {
    param(
        [Parameter(Mandatory)] [string] $File,
        [string[]] $Arguments = @(),
        [string] $WorkingDirectory,
        [switch] $AllowFailure
    )
    $prev = $PWD
    if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }
    try {
        $out = & $File @Arguments 2>&1
        $code = $LASTEXITCODE
    }
    finally { Set-Location -LiteralPath $prev }
    $text = ($out | Out-String).TrimEnd()
    if ($code -ne 0 -and -not $AllowFailure) {
        if ($text) { Write-Host $text -ForegroundColor DarkYellow }
        Fail "$File $($Arguments -join ' ') exited with $code"
    }
    [pscustomobject]@{ Output = $text; ExitCode = $code }
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments)] [string[]] $Arguments, [switch] $AllowFailure)
    Invoke-Native -File 'git' -Arguments $Arguments -WorkingDirectory $RepoPath -AllowFailure:$AllowFailure
}

function Get-SshArgs {
    $a = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=8', '-p', "$RouterPort")
    if ($SshKey -and (Test-Path -LiteralPath $SshKey)) { $a += @('-i', $SshKey) }
    $a
}

function Invoke-Router {
    param([Parameter(Mandatory)] [string] $Command, [switch] $AllowFailure)
    $sshArgs = Get-SshArgs
    $sshArgs += @("$RouterUser@$Router", $Command)
    Invoke-Native -File 'ssh' -Arguments $sshArgs -AllowFailure:$AllowFailure
}

function Copy-ToRouter {
    param([Parameter(Mandatory)] [string] $LocalPath, [Parameter(Mandatory)] [string] $RemotePath)
    $scpArgs = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=8', '-P', "$RouterPort")
    if ($SshKey -and (Test-Path -LiteralPath $SshKey)) { $scpArgs += @('-i', $SshKey) }
    $scpArgs += @($LocalPath, "$RouterUser@${Router}:$RemotePath")
    Invoke-Native -File 'scp' -Arguments $scpArgs | Out-Null
}

function Test-Stage { param([string] $Name) $Stage -contains $Name }

function Get-DefaultKeyPath {
    if ($SshKey) { return $SshKey }
    $ed = Join-Path $HOME '.ssh\id_ed25519'
    $rsa = Join-Path $HOME '.ssh\id_rsa'
    if (Test-Path -LiteralPath $ed) { return $ed }
    if (Test-Path -LiteralPath $rsa) { return $rsa }
    $ed
}

function Test-RouterSsh {
    $probe = Invoke-Router 'echo z2m-ok' -AllowFailure
    ($probe.ExitCode -eq 0 -and $probe.Output -match 'z2m-ok')
}

# --------------------------------------------------------------------------
# stage: key
#
# A router with no root password cannot accept an ssh password login: dropbear
# rejects blank-password logins outright. Key authentication is the only way in,
# and this stage installs the key over the LuCI ubus endpoint, which does accept
# the empty root password. No password is ever set on the router.
# --------------------------------------------------------------------------

function Invoke-Ubus {
    param(
        [Parameter(Mandatory)] [string] $Session,
        [Parameter(Mandatory)] [string] $Object,
        [Parameter(Mandatory)] [string] $Method,
        [hashtable] $Arguments = @{}
    )
    $body = @{
        jsonrpc = '2.0'
        id      = 1
        method  = 'call'
        params  = @($Session, $Object, $Method, $Arguments)
    } | ConvertTo-Json -Depth 8 -Compress

    try {
        $resp = Invoke-RestMethod -Uri "http://$Router/ubus" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15
    }
    catch {
        $code = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code -in 401, 403) { Fail "ubus refused the request with HTTP $code; stopping instead of retrying" }
        if ($code -eq 404) { Fail "http://$Router/ubus is not available (HTTP 404). Install the key by hand: LuCI -> System -> Administration -> SSH-Keys, paste your public key, then rerun." }
        Fail "ubus call $Object.$Method failed: $($_.Exception.Message)"
    }

    if ($resp.PSObject.Properties.Name -contains 'error' -and $resp.error) {
        Fail "ubus call $Object.$Method returned error: $($resp.error | ConvertTo-Json -Compress)"
    }
    $status = $resp.result[0]
    if ($status -ne 0) {
        if ($status -in 5, 6) { Fail "ubus denied $Object.$Method (status $status). The empty-password session has no rights for this call; paste the key via LuCI instead." }
        Fail "ubus call $Object.$Method returned status $status"
    }
    if ($resp.result.Count -gt 1) { return $resp.result[1] }
    $null
}

function Invoke-KeyBootstrap {
    Write-Stage 'key (ssh bootstrap for a passwordless router)'

    $keyPath = Get-DefaultKeyPath
    $pubPath = "$keyPath.pub"

    if (-not (Test-Path -LiteralPath $keyPath)) {
        if (-not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) { Fail 'ssh-keygen is not on PATH (install the OpenSSH client feature)' }
        if ($PSCmdlet.ShouldProcess($keyPath, 'generate ssh key')) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $keyPath) | Out-Null
            Invoke-Native -File 'ssh-keygen' -Arguments @('-t', 'ed25519', '-N', '', '-C', "z2m-ship@$env:COMPUTERNAME", '-f', $keyPath) | Out-Null
            Write-Good "generated $keyPath"
        }
    }
    else { Write-Good "using existing key $keyPath" }

    if (-not (Test-Path -LiteralPath $pubPath)) { Fail "public key not found: $pubPath" }
    $pub = (Get-Content -LiteralPath $pubPath -Raw).Trim()
    $script:SshKey = $keyPath
    Set-Variable -Name SshKey -Value $keyPath -Scope 1 -ErrorAction SilentlyContinue

    if (Test-RouterSsh) { Write-Good 'key authentication already works; nothing to bootstrap'; return }

    Write-Step "logging into http://$Router/ubus as $RouterUser with the empty password"
    $nullSession = '00000000000000000000000000000000'
    $login = Invoke-Ubus -Session $nullSession -Object 'session' -Method 'login' -Arguments @{ username = $RouterUser; password = $RouterPassword }
    $sid = $login.ubus_rpc_session
    if (-not $sid) { Fail 'ubus login returned no session id' }
    Write-Good 'ubus session established (no password was set on the router)'

    $authFile = '/etc/dropbear/authorized_keys'
    $existing = ''
    try {
        $read = Invoke-Ubus -Session $sid -Object 'file' -Method 'read' -Arguments @{ path = $authFile }
        if ($read -and $read.data) { $existing = $read.data }
    }
    catch { Write-Step "$authFile does not exist yet; it will be created" }

    if ($existing -match [regex]::Escape(($pub -split '\s+')[1])) {
        Write-Good 'public key is already present in authorized_keys'
    }
    elseif ($PSCmdlet.ShouldProcess("${Router}:$authFile", 'append public key')) {
        $content = if ($existing.Trim()) { $existing.TrimEnd() + "`n" + $pub + "`n" } else { $pub + "`n" }
        Invoke-Ubus -Session $sid -Object 'file' -Method 'write' -Arguments @{ path = $authFile; data = $content; mode = 384 } | Out-Null
        Write-Good "appended the public key to $authFile (mode 0600)"
    }

    Invoke-Ubus -Session $sid -Object 'session' -Method 'destroy' -Arguments @{ ubus_rpc_session = $sid } | Out-Null

    Start-Sleep -Seconds 1
    if (-not (Test-RouterSsh)) {
        Fail "the key was written but ssh still refuses the login. Check LuCI -> System -> Administration -> SSH-Keys, and that dropbear is running on port $RouterPort."
    }
    Write-Good "ssh key authentication to $RouterUser@$Router works"
}

# --------------------------------------------------------------------------
# constants
# --------------------------------------------------------------------------

$PkgDir = 'zapret2-manager/files/usr/libexec/zapret2-manager'
$RemoteDir = '/usr/libexec/zapret2-manager'
$DeadFile = 'usr/libexec/zapret2-manager/orchestra-run.uc'
$DeployFiles = @(
    'orchestra-evidence.uc',
    'orchestra-run.uc',
    'orchestra-worker-control.uc'
)
$BackupDir = '/root/z2m-ship-backup'

# --------------------------------------------------------------------------
# stage: preflight
# --------------------------------------------------------------------------

function Invoke-Preflight {
    Write-Stage 'preflight'

    if (-not (Test-Path -LiteralPath $RepoPath)) { Fail "repository not found: $RepoPath" }
    if (-not (Test-Path -LiteralPath (Join-Path $RepoPath '.git'))) { Fail "$RepoPath is not a git repository" }
    Write-Good "repository $RepoPath"

    foreach ($tool in 'git', 'python3') {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            if ($tool -eq 'python3' -and (Get-Command 'python' -ErrorAction SilentlyContinue)) { continue }
            Fail "$tool is not on PATH"
        }
    }
    Write-Good 'git and python are available'

    $branch = (Invoke-Git rev-parse --abbrev-ref HEAD).Output
    if ($branch -ne $Branch) { Fail "checked out branch is '$branch', expected '$Branch'; all work happens on $Branch" }
    Write-Good "on branch $Branch"

    $status = (Invoke-Git status --porcelain).Output
    if ($status -and -not $AllowDirtyTree) {
        Write-Host $status -ForegroundColor DarkYellow
        Fail 'working tree is dirty; commit, stash, or pass -AllowDirtyTree'
    }

    Invoke-Git fetch $Remote $Branch | Out-Null
    $behind = (Invoke-Git rev-list --count "HEAD..$Remote/$Branch").Output
    if ([int]$behind -gt 0) { Fail "local $Branch is $behind commits behind $Remote/$Branch; pull and rerun" }
    Write-Good "local $Branch is not behind $Remote/$Branch"

    if ((Test-Stage 'deploy') -or (Test-Stage 'verify')) {
        foreach ($tool in 'ssh', 'scp') {
            if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is not on PATH (install OpenSSH client)" }
        }
        if (-not $SshKey) { $SshKey = Get-DefaultKeyPath }
        $probe = Invoke-Router 'echo z2m-ok; . /etc/openwrt_release 2>/dev/null; echo "$DISTRIB_RELEASE $DISTRIB_ARCH"; command -v ucode >/dev/null && echo ucode-present || echo ucode-missing' -AllowFailure
        if ($probe.ExitCode -ne 0 -or $probe.Output -notmatch 'z2m-ok') {
            Fail @"
cannot reach $RouterUser@${Router}:$RouterPort over ssh with key auth.
A router with no root password cannot log in by password at all: dropbear rejects
blank-password logins. Install your key once, then rerun:
    pwsh -File tools/ship-orchestra.ps1 -Stage key
Or paste the contents of $((Get-DefaultKeyPath) + '.pub') into
LuCI -> System -> Administration -> SSH-Keys.
"@
        }
        Write-Good "router reachable: $(($probe.Output -split "`n" | Select-Object -Skip 1) -join ' | ')"
        if ($probe.Output -match 'ucode-missing') { Write-Warn2 'ucode not found on the router; the remote syntax check will be skipped' }

        $dfOut = (Invoke-Router "df -k /tmp | awk 'NR==2{print `$4}'").Output
        $freeLine = $dfOut -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1
        if (-not $freeLine) { Fail "could not read /tmp free space from the router; df returned: $dfOut" }
        $free = [int]$freeLine
        if ($free -lt $MinTmpKb) { Fail "/tmp free space is ${free}K, below the ${MinTmpKb}K floor; clean /tmp before deploying" }
        Write-Good "/tmp free space ${free}K"
    }
}

# --------------------------------------------------------------------------
# stage: patch
# --------------------------------------------------------------------------

function Invoke-Patch {
    Write-Stage 'patch'

    if ($Patch) {
        $patchFull = (Resolve-Path -LiteralPath $Patch).Path
        $already = Test-Path -LiteralPath (Join-Path $RepoPath "$PkgDir/orchestra-evidence.uc")
        if ($already) {
            Write-Good 'evidence module already present; skipping git apply'
        }
        elseif ($PSCmdlet.ShouldProcess($patchFull, 'git apply')) {
            $check = Invoke-Git apply --check $patchFull -AllowFailure
            if ($check.ExitCode -ne 0) { Write-Host $check.Output -ForegroundColor DarkYellow; Fail 'git apply --check failed; do not hand-edit, report the output' }
            Invoke-Git apply $patchFull | Out-Null
            Write-Good "applied $([System.IO.Path]::GetFileName($patchFull))"
        }
    }
    else { Write-Step 'no -Patch given; assuming the new files are already in the tree' }

    $python = if (Get-Command python3 -ErrorAction SilentlyContinue) { 'python3' } else { 'python' }
    $wiring = 'tools/apply-orchestra-wiring.py'
    if (-not (Test-Path -LiteralPath (Join-Path $RepoPath $wiring))) {
        if ($WhatIfPreference) {
            Write-Warn2 "$wiring is not in the tree yet; the patch that delivers it was not really applied under -WhatIf"
            Write-Step 'would run the wiring script in --check mode, then for real'
            Write-Step "would git rm the dead $DeadFile if present"
            return
        }
        Fail "$wiring is missing; apply the patch first"
    }

    $dry = Invoke-Native -File $python -Arguments @($wiring, '--check') -WorkingDirectory $RepoPath -AllowFailure
    Write-Host $dry.Output -ForegroundColor DarkGray
    if ($dry.ExitCode -ne 0) { Fail 'wiring anchors did not resolve; send me the exact anchor name from the output instead of editing by hand' }
    Write-Good 'all wiring anchors resolved'

    if ($PSCmdlet.ShouldProcess('orchestra-run.uc + orchestra-worker-control.uc', 'apply wiring')) {
        $apply = Invoke-Native -File $python -Arguments @($wiring) -WorkingDirectory $RepoPath
        Write-Host $apply.Output -ForegroundColor DarkGray
        Write-Good 'production files wired'
    }

    if (Test-Path -LiteralPath (Join-Path $RepoPath $DeadFile)) {
        if ($PSCmdlet.ShouldProcess($DeadFile, 'git rm')) {
            Invoke-Git rm -f --quiet $DeadFile -AllowFailure | Out-Null
            Write-Good "removed dead wrong-path file $DeadFile"
        }
    }
}

# --------------------------------------------------------------------------
# stage: test
# --------------------------------------------------------------------------

function Invoke-Tests {
    Write-Stage 'test'

    $suite = Join-Path $RepoPath 'tools/run-all-tests.sh'
    $wsl = Get-Command wsl -ErrorAction SilentlyContinue

    if ((Test-Path -LiteralPath $suite) -and $wsl) {
        $wslPath = (Invoke-Native -File 'wsl' -Arguments @('wslpath', '-a', ($RepoPath -replace '\\', '/'))).Output.Trim()
        Write-Step "wsl bash tools/run-all-tests.sh  (cwd $wslPath)"
        $run = Invoke-Native -File 'wsl' -Arguments @('bash', '-lc', "cd '$wslPath' && bash tools/run-all-tests.sh") -AllowFailure
        Write-Host $run.Output
        if ($run.ExitCode -ne 0) { Fail 'test suite failed; fix the failures before pushing' }
        $green = [regex]::Matches($run.Output, '(?m)^#\s*pass\s+(\d+)') | ForEach-Object { $_.Groups[1].Value }
        if ($green) { Write-Good "suite green ($($green -join '+') passing assertions reported)" } else { Write-Good 'suite green' }
    }
    elseif (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Warn2 'run-all-tests.sh or WSL unavailable; falling back to node --test tests/'
        $run = Invoke-Native -File 'node' -Arguments @('--test', 'tests/') -WorkingDirectory $RepoPath -AllowFailure
        Write-Host $run.Output
        if ($run.ExitCode -ne 0) { Fail 'node --test failed; fix the failures before pushing' }
        Write-Good 'node --test green'
    }
    else { Fail 'neither WSL nor node is available; cannot run the suite, refusing to push untested code' }

    if (-not $wsl) { Write-Warn2 'ucode-backed assertions are skipped without WSL; they are structural-only on this run' }
}

# --------------------------------------------------------------------------
# stage: push
# --------------------------------------------------------------------------

function Invoke-Push {
    Write-Stage 'push'

    $status = (Invoke-Git status --porcelain).Output
    if (-not $status) {
        Write-Good 'nothing to commit; tree already matches HEAD'
    }
    elseif ($PSCmdlet.ShouldProcess("$Remote/$Branch", 'commit and push')) {
        Invoke-Git add -A | Out-Null
        Invoke-Git commit -m $CommitMessage | Out-Null
        Write-Good 'committed'
    }

    $local = (Invoke-Git rev-parse HEAD).Output.Trim()

    if ($PSCmdlet.ShouldProcess("$Remote $Branch", 'git push')) {
        Invoke-Git push $Remote "HEAD:$Branch" | Out-Null
        $remoteLine = (Invoke-Git ls-remote $Remote "refs/heads/$Branch").Output.Trim()
        $remoteSha = ($remoteLine -split '\s+')[0]
        if ($remoteSha -ne $local) { Fail "push did not land: local $local != remote $remoteSha" }
        Write-Good "local SHA == remote SHA: $local"
        $script:PushedSha = $local
    }
}

# --------------------------------------------------------------------------
# stage: deploy (development file drop, not an APK install)
# --------------------------------------------------------------------------

function Invoke-Deploy {
    Write-Stage 'deploy (dev file drop)'
    Write-Warn2 'this replaces files inside an installed package; it does NOT count as an APK install for checkpoint purposes'

    $busy = Invoke-Router "ls /tmp/zapret2-manager/orchestra-runs/active.json 2>/dev/null && cat /tmp/zapret2-manager/orchestra-runs/active.json" -AllowFailure
    if ($busy.ExitCode -eq 0 -and $busy.Output.Trim()) {
        Write-Host $busy.Output -ForegroundColor DarkYellow
        Fail 'an orchestration run is active; stop it before swapping the code underneath it'
    }
    Write-Good 'no active orchestration run'

    Invoke-Router "mkdir -p '$BackupDir'" | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

    foreach ($name in $DeployFiles) {
        $local = Join-Path $RepoPath "$PkgDir/$name"
        if (-not (Test-Path -LiteralPath $local)) { Fail "local file missing: $local" }
        $remote = "$RemoteDir/$name"

        if (-not $PSCmdlet.ShouldProcess("$RouterUser@${Router}:$remote", 'deploy')) { continue }

        $backup = "$BackupDir/$name.$stamp"
        Invoke-Router "[ -f '$remote' ] && cp -a '$remote' '$backup' || true" | Out-Null

        $staged = "/tmp/$name.staged"
        Copy-ToRouter -LocalPath $local -RemotePath $staged

        if ((Invoke-Router 'command -v ucode >/dev/null' -AllowFailure).ExitCode -eq 0) {
            $syntax = Invoke-Router "ucode -T '$staged' >/dev/null 2>&1 || ucode -c '$staged' >/dev/null" -AllowFailure
            if ($syntax.ExitCode -ne 0) {
                Write-Host $syntax.Output -ForegroundColor DarkYellow
                Invoke-Router "rm -f '$staged'" -AllowFailure | Out-Null
                Fail "remote syntax check failed for $name; nothing was replaced"
            }
        }

        Invoke-Router "mv '$staged' '$remote' && chmod 0755 '$remote'" | Out-Null
        $script:Deployed.Add(@{ Name = $name; Remote = $remote; Backup = $backup; Local = $local })
        Write-Good "deployed $name"
    }

    Invoke-Router "rm -f /tmp/*.staged 2>/dev/null; true" -AllowFailure | Out-Null

    if ($RestartRpcd) {
        Write-Warn2 'restarting rpcd once; every open LuCI session will be logged out'
        if ($PSCmdlet.ShouldProcess('rpcd', 'restart')) { Invoke-Router '/etc/init.d/rpcd restart' | Out-Null }
    }
    else {
        Write-Step 'rpcd was NOT restarted (LuCI sessions preserved). Pass -RestartRpcd only when the ubus surface changed.'
    }
}

function Restore-Deploy {
    if ($script:Deployed.Count -eq 0) { return }
    Write-Warn2 'rolling back the deployed files'
    foreach ($d in $script:Deployed) {
        Invoke-Router "[ -f '$($d.Backup)' ] && cp -a '$($d.Backup)' '$($d.Remote)' || true" -AllowFailure | Out-Null
        Write-Step "restored $($d.Name)"
    }
}

# --------------------------------------------------------------------------
# stage: verify
# --------------------------------------------------------------------------

function Invoke-Verify {
    Write-Stage 'verify'

    $bad = @()
    foreach ($name in $DeployFiles) {
        $local = Join-Path $RepoPath "$PkgDir/$name"
        if (-not (Test-Path -LiteralPath $local)) { continue }
        $localHash = (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash.ToLower()
        $remoteRaw = (Invoke-Router "sha256sum '$RemoteDir/$name' 2>/dev/null | awk '{print `$1}'" -AllowFailure).Output
        $remoteOut = $remoteRaw -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[0-9a-f]{64}$' } | Select-Object -Last 1
        if ($remoteOut -ne $localHash) {
            $bad += "$name  local=$localHash  router=$($remoteOut ? $remoteOut : '<missing>')"
        }
        else { Write-Good "$name sha256 $localHash" }
    }

    if ($bad.Count) {
        $bad | ForEach-Object { Write-Host "  MISMATCH $_" -ForegroundColor Red }
        Restore-Deploy
        Fail 'router files do not match the repository; deployment rolled back'
    }

    $logs = Invoke-Router "logread -e zapret2-manager 2>/dev/null | tail -n 20" -AllowFailure
    if ($logs.Output.Trim()) {
        Write-Step 'last zapret2-manager log lines:'
        Write-Host $logs.Output -ForegroundColor DarkGray
    }
}

# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

try {
    Write-Host "ship-orchestra  repo=$RepoPath  router=$RouterUser@${Router}:$RouterPort  stages=$($Stage -join ',')" -ForegroundColor White

    if (Test-Stage 'key') { Invoke-KeyBootstrap }
    if (Test-Stage 'preflight') { Invoke-Preflight }
    if (Test-Stage 'patch') { Invoke-Patch }
    if (Test-Stage 'test') { Invoke-Tests }
    if (Test-Stage 'push') { Invoke-Push }
    if (Test-Stage 'deploy') { Invoke-Deploy }
    if (Test-Stage 'verify') { Invoke-Verify }

    Write-Host "`n=== done in $([int]((Get-Date) - $script:StartedAt).TotalSeconds)s" -ForegroundColor Cyan
    if (Get-Variable -Name PushedSha -Scope Script -ErrorAction SilentlyContinue) {
        Write-Host "pushed commit: $($script:PushedSha)" -ForegroundColor Green
    }
    Write-Host @'

Still owed before this counts as a completed checkpoint:
  1. build the APK and record version, size, sha256 and file list
  2. install it exactly once, with no install or restart loops
  3. live Blockcheck smoke run
  4. a fresh dynamic run reaching confirmed winners for web, gateway and cdn,
     or a proven candidate exhaustion, with the run id written down
  5. Preview -> transactional Apply -> router and LAN verification,
     with rollback exercised on failure
  6. cleanup and /tmp free space check
This script proves none of those. It only proves push and file parity.
'@ -ForegroundColor DarkGray
}
catch {
    Write-Host "`nFAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($script:Deployed.Count -gt 0) { Restore-Deploy }
    exit 1
}
