#requires -Version 7.0
<#
.SYNOPSIS
    Classifies untracked files in the repository root before anything is deleted.

.DESCRIPTION
    The repository has a stray copy of the package tree at the repository root
    (usr/, etc/, usr/share/) next to the real one under
    zapret2-manager/files/. This script compares every untracked file with its
    counterpart in the packaged tree by sha256 and sorts it into:

        DUPLICATE   byte-identical to the packaged file  -> safe to delete
        DIFFERENT   a counterpart exists but differs     -> inspect by hand
        ORPHAN      no counterpart in the packaged tree  -> inspect by hand
        SCRATCH     notes, ad-hoc scripts, tool state    -> move out or ignore

    It deletes nothing unless -Clean is passed, and even then it only removes
    files classified as DUPLICATE. DIFFERENT and ORPHAN are never touched.

.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File tools\triage-untracked.ps1

.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File tools\triage-untracked.ps1 -Clean -WhatIf
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string] $RepoPath = (Get-Location).Path,
    [switch] $Clean,
    [switch] $ShowDiff
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $RepoPath

$PackagedRoots = @{
    'usr/' = 'zapret2-manager/files/usr/'
    'etc/' = 'zapret2-manager/files/etc/'
}

$ScratchPatterns = @(
    '^\.codex/', '\.md$', '^recovery_patch\.diff$', '^test-.*\.mjs$', '\.backup$', '\.orig$', '\.rej$'
)

function Get-Sha { param([string] $Path) (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower() }

$untracked = git ls-files --others --exclude-standard
if (-not $untracked) { Write-Host 'no untracked files; the tree is clean' -ForegroundColor Green; return }

$rows = foreach ($rel in $untracked) {
    $counterpart = $null
    foreach ($prefix in $PackagedRoots.Keys) {
        if ($rel.StartsWith($prefix)) { $counterpart = $PackagedRoots[$prefix] + $rel.Substring($prefix.Length); break }
    }

    $class = 'ORPHAN'
    $note = ''

    if ($ScratchPatterns | Where-Object { $rel -match $_ }) {
        $class = 'SCRATCH'
        $note = 'not part of the package'
    }
    elseif ($counterpart -and (Test-Path -LiteralPath $counterpart)) {
        $a = Get-Sha $rel
        $b = Get-Sha $counterpart
        if ($a -eq $b) { $class = 'DUPLICATE'; $note = $counterpart }
        else { $class = 'DIFFERENT'; $note = $counterpart }
    }
    elseif ($counterpart) {
        $note = "expected counterpart missing: $counterpart"
    }

    [pscustomobject]@{ Class = $class; Path = $rel; Counterpart = $note }
}

foreach ($group in 'DUPLICATE', 'DIFFERENT', 'ORPHAN', 'SCRATCH') {
    $set = @($rows | Where-Object Class -eq $group)
    if (-not $set.Count) { continue }
    $color = switch ($group) { 'DUPLICATE' { 'DarkGray' } 'DIFFERENT' { 'Red' } 'ORPHAN' { 'Yellow' } default { 'Cyan' } }
    Write-Host "`n$group ($($set.Count))" -ForegroundColor $color
    $set | ForEach-Object { Write-Host "  $($_.Path)" -ForegroundColor $color -NoNewline; if ($_.Counterpart) { Write-Host "   <- $($_.Counterpart)" -ForegroundColor DarkGray } else { Write-Host '' } }
}

$different = @($rows | Where-Object Class -eq 'DIFFERENT')
if ($ShowDiff -and $different.Count) {
    foreach ($d in $different) {
        Write-Host "`n--- diff $($d.Path)" -ForegroundColor Red
        git diff --no-index -- $d.Counterpart $d.Path
    }
}

$dupes = @($rows | Where-Object Class -eq 'DUPLICATE')

Write-Host "`nsummary: $($dupes.Count) duplicate, $($different.Count) different, $(@($rows | Where-Object Class -eq 'ORPHAN').Count) orphan, $(@($rows | Where-Object Class -eq 'SCRATCH').Count) scratch" -ForegroundColor White

if (-not $Clean) {
    Write-Host 'nothing was deleted. Review DIFFERENT and ORPHAN above, then rerun with -Clean to remove only the duplicates.' -ForegroundColor Gray
    return
}

if ($different.Count) {
    Write-Host "refusing to clean while $($different.Count) files differ from the packaged tree; resolve them first (-ShowDiff to inspect)" -ForegroundColor Red
    exit 1
}

foreach ($d in $dupes) {
    if ($PSCmdlet.ShouldProcess($d.Path, 'delete duplicate')) {
        Remove-Item -LiteralPath $d.Path -Force
        Write-Host "  deleted $($d.Path)" -ForegroundColor DarkGray
    }
}

Get-ChildItem -Path 'usr', 'etc' -Recurse -Directory -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } -Descending |
    Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; Write-Host "  removed empty $($_.FullName)" -ForegroundColor DarkGray }

Write-Host "`nnext: git status --porcelain (only SCRATCH/ORPHAN entries should remain)" -ForegroundColor Green
