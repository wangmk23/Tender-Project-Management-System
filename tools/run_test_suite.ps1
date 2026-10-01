[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceExe,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$SourceSha256,

    [Parameter(Mandatory = $true)]
    [string]$Python312,

    [string]$CandidateExe,

    [string]$CandidateSha256,

    [string]$LicenseFixtureDirectory,

    [switch]$ValidateSourceOnly,

    [switch]$InjectFailureAfterEnvironmentSetup,

    [switch]$InjectAfterHashFailure,

    [switch]$InjectCleanupFailure,

    [switch]$InjectRestoreFailure,

    [switch]$InjectFinallyOnly,

    [string]$PythonPath = 'C:\Python314\Lib\site-packages'
)

$resolvedSource = (Resolve-Path -LiteralPath $SourceExe -ErrorAction Stop).Path
$resolvedPython = (Resolve-Path -LiteralPath $Python312 -ErrorAction Stop).Path
if ([System.IO.Path]::GetExtension($resolvedSource) -ne '.exe') {
    throw 'SourceExe must identify an .exe file.'
}
if (-not (Test-Path -LiteralPath $resolvedSource -PathType Leaf)) {
    throw 'SourceExe must identify an existing file.'
}
# Portable fallback for: Get-FileHash -Algorithm SHA256
function Get-PortableSha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
$sourceHashBefore = Get-PortableSha256 $resolvedSource
$expectedSourceHash = $SourceSha256.ToLowerInvariant()
if ($sourceHashBefore -ne $expectedSourceHash) {
    throw "SourceExe SHA-256 mismatch: expected=$expectedSourceHash, actual=$sourceHashBefore"
}
if ($ValidateSourceOnly) {
    return
}

$previousEnvironment = [System.Environment]::GetEnvironmentVariables('Process')
$previousLocation = Get-Location
$candidateInputPath = $CandidateExe
if ($CandidateExe -and -not [System.IO.Path]::IsPathRooted($CandidateExe)) {
    $candidateInputPath = Join-Path $previousLocation.Path $CandidateExe
}
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runnerTempRoot = Join-Path $repositoryRoot 'temp'
$runnerTemp = Join-Path $runnerTempRoot ("task8-runner-" + [guid]::NewGuid().ToString('N'))
$sourceReadHandle = $null
$bodyFailure = $null
$hashFailure = $null
$restorationFailures = [System.Collections.Generic.List[object]]::new()
$cleanupFailures = [System.Collections.Generic.List[object]]::new()

function New-RunnerFailureRecord {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Category,

        [Parameter(Mandatory = $true)]
        [System.Management.Automation.ErrorRecord]$ErrorRecord,

        [Parameter(Mandatory = $true)]
        [string]$DisplayMessage
    )

    return [pscustomobject]@{
        Category = $Category
        ErrorRecord = $ErrorRecord
        Exception = $ErrorRecord.Exception
        DisplayMessage = $DisplayMessage
    }
}
try {
    New-Item -ItemType Directory -Path $runnerTemp -Force | Out-Null
    $sourceReadHandle = [System.IO.File]::Open(
        $resolvedSource,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    $env:PM_SOURCE_EXE = $resolvedSource
    $env:PM_SOURCE_EXE_SHA256 = $sourceHashBefore
    $env:PYTHON312 = $resolvedPython
    $env:PYTHONPATH = $PythonPath
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:TEMP = $runnerTemp
    $env:TMP = $runnerTemp
    Set-Location -LiteralPath $repositoryRoot

    if (-not $InjectFinallyOnly) {
        if ($InjectFailureAfterEnvironmentSetup) {
            throw 'Injected runner failure after environment setup.'
        }

        if ([bool]$CandidateExe -ne [bool]$CandidateSha256) {
            throw 'CandidateExe and CandidateSha256 must be supplied together.'
        }
        if ($CandidateExe) {
            $resolvedCandidate = (Resolve-Path -LiteralPath $candidateInputPath -ErrorAction Stop).Path
            $candidateHash = Get-PortableSha256 $resolvedCandidate
            if ($candidateHash -ne $CandidateSha256.ToLowerInvariant()) {
                throw 'CandidateExe SHA-256 mismatch.'
            }
        }
        else {
            $resolvedCandidate = Join-Path $runnerTemp 'suite-candidate.exe'
            $candidateReport = Join-Path $runnerTemp 'suite-candidate-integrity.json'
            & $resolvedPython tools\build_candidate.py `
                --source-exe $resolvedSource `
                --source-sha256 $sourceHashBefore `
                --destination $resolvedCandidate `
                --report $candidateReport
            if ($LASTEXITCODE -ne 0) { throw "Candidate build failed with exit code $LASTEXITCODE" }
            $candidateHash = Get-PortableSha256 $resolvedCandidate
            $builtIntegrity = Get-Content -LiteralPath $candidateReport -Raw | ConvertFrom-Json
            if ($builtIntegrity.candidate_sha256 -ne $candidateHash) { throw 'Built candidate integrity mismatch.' }
        }
        if ($LicenseFixtureDirectory) {
            $resolvedLicenseFixture = if ([System.IO.Path]::IsPathRooted($LicenseFixtureDirectory)) {
                $LicenseFixtureDirectory
            } else { Join-Path $previousLocation.Path $LicenseFixtureDirectory }
            $env:PM_TEST_LICENSE_DIR = (Resolve-Path -LiteralPath $resolvedLicenseFixture -ErrorAction Stop).Path
            if (-not (Test-Path -LiteralPath (Join-Path $env:PM_TEST_LICENSE_DIR 'license.dat') -PathType Leaf)) {
                throw 'LicenseFixtureDirectory must contain an existing signed license.dat.'
            }
        }
        $env:PM_TEST_CANDIDATE_EXE = $resolvedCandidate
        $env:PM_TEST_CANDIDATE_SHA256 = $candidateHash

        & $resolvedPython -m unittest discover -s tests -v
        if ($LASTEXITCODE -ne 0) {
            throw "Python tests failed with exit code $LASTEXITCODE"
        }

        & $resolvedPython tools\benchmark_system.py
        if ($LASTEXITCODE -ne 0) {
            throw "System benchmark failed with exit code $LASTEXITCODE"
        }

        & $resolvedPython tools\benchmark_system.py `
            --candidate-sqlcipher-smoke `
            --candidate-exe $resolvedCandidate `
            --candidate-sha256 $candidateHash `
            --source-exe $resolvedSource `
            --source-sha256 $sourceHashBefore `
            --python312 $resolvedPython `
            --projects 40 `
            --attachments 120
        if ($LASTEXITCODE -ne 0) {
            throw "Candidate SQLCipher smoke failed with exit code $LASTEXITCODE"
        }

        $functionalNodeTests = @(
            Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'tests') `
                -Filter '*.js' -File |
                Where-Object { $_.Name -ne 'test_chart_board_performance.js' } |
                ForEach-Object { $_.FullName }
        )
        & node --test --test-concurrency=1 @functionalNodeTests
        if ($LASTEXITCODE -ne 0) {
            throw "Node tests failed with exit code $LASTEXITCODE"
        }
    }
}
catch {
    $bodyFailure = New-RunnerFailureRecord `
        -Category 'body' `
        -ErrorRecord $_ `
        -DisplayMessage $_.Exception.Message
}
finally {
    try {
        if ($InjectAfterHashFailure) {
            throw 'Injected source after-hash failure.'
        }
        $sourceHashAfter = Get-PortableSha256 $resolvedSource
        if ($sourceHashAfter -ne $sourceHashBefore) {
            throw 'SourceExe changed during the test suite.'
        }
    }
    catch {
        $hashFailure = New-RunnerFailureRecord `
            -Category 'hash' `
            -ErrorRecord $_ `
            -DisplayMessage $_.Exception.Message
    }
    finally {
        try {
            if ($InjectRestoreFailure) {
                $injectedRestore = [System.IO.IOException]::new(
                    'Injected runner restore failure.'
                )
                $injectedRestore.Data['task8_stage'] = 'restore'
                $global:Task8InjectedFinallyException = $injectedRestore
                throw $injectedRestore
            }
            if ($null -ne $sourceReadHandle) {
                $sourceReadHandle.Dispose()
            }
        }
        catch {
            if ($InjectRestoreFailure) {
                $global:Task8InjectedFinallyErrorRecord = $_
            }
            [void]$restorationFailures.Add(
                (New-RunnerFailureRecord `
                    -Category 'restore' `
                    -ErrorRecord $_ `
                    -DisplayMessage "handle: $($_.Exception.Message)")
            )
        }

        $currentEnvironment = $null
        try {
            $currentEnvironment = [System.Environment]::GetEnvironmentVariables('Process')
        }
        catch {
            [void]$restorationFailures.Add(
                (New-RunnerFailureRecord `
                    -Category 'restore' `
                    -ErrorRecord $_ `
                    -DisplayMessage "environment snapshot: $($_.Exception.Message)")
            )
        }
        if ($null -ne $currentEnvironment) {
            foreach ($name in @($currentEnvironment.Keys)) {
                if (-not $previousEnvironment.Contains($name)) {
                    try {
                        [System.Environment]::SetEnvironmentVariable(
                            [string]$name,
                            $null,
                            'Process'
                        )
                    }
                    catch {
                        [void]$restorationFailures.Add(
                            (New-RunnerFailureRecord `
                                -Category 'restore' `
                                -ErrorRecord $_ `
                                -DisplayMessage "environment unset $name`: $($_.Exception.Message)")
                        )
                    }
                }
            }
        }
        foreach ($entry in $previousEnvironment.GetEnumerator()) {
            try {
                [System.Environment]::SetEnvironmentVariable(
                    [string]$entry.Key,
                    [string]$entry.Value,
                    'Process'
                )
            }
            catch {
                [void]$restorationFailures.Add(
                    (New-RunnerFailureRecord `
                        -Category 'restore' `
                        -ErrorRecord $_ `
                        -DisplayMessage "environment restore $($entry.Key)`: $($_.Exception.Message)")
                )
            }
        }

        try {
            Set-Location -LiteralPath $previousLocation -ErrorAction Stop
        }
        catch {
            [void]$restorationFailures.Add(
                (New-RunnerFailureRecord `
                    -Category 'restore' `
                    -ErrorRecord $_ `
                    -DisplayMessage "location: $($_.Exception.Message)")
            )
        }

        try {
            if ($InjectCleanupFailure) {
                $injectedCleanup = [System.IO.IOException]::new(
                    'Injected runner cleanup failure.'
                )
                $injectedCleanup.Data['task8_stage'] = 'cleanup'
                $global:Task8InjectedFinallyException = $injectedCleanup
                throw $injectedCleanup
            }
            if (Test-Path -LiteralPath $runnerTemp) {
                Remove-Item -LiteralPath $runnerTemp -Recurse -Force -ErrorAction Stop
            }
        }
        catch {
            if ($InjectCleanupFailure) {
                $global:Task8InjectedFinallyErrorRecord = $_
            }
            [void]$cleanupFailures.Add(
                (New-RunnerFailureRecord `
                    -Category 'cleanup' `
                    -ErrorRecord $_ `
                    -DisplayMessage $_.Exception.Message)
            )
        }
        finally {
            if (Test-Path -LiteralPath $runnerTemp) {
                try {
                    Remove-Item -LiteralPath $runnerTemp -Recurse -Force -ErrorAction Stop
                }
                catch {
                    [void]$cleanupFailures.Add(
                        (New-RunnerFailureRecord `
                            -Category 'cleanup' `
                            -ErrorRecord $_ `
                            -DisplayMessage $_.Exception.Message)
                    )
                }
            }
            if (Test-Path -LiteralPath $runnerTempRoot) {
                try {
                    [System.IO.Directory]::Delete($runnerTempRoot, $false)
                }
                catch [System.IO.IOException] {
                    # Preserve a shared repository temp directory when another task is using it.
                }
                catch {
                    [void]$cleanupFailures.Add(
                        (New-RunnerFailureRecord `
                            -Category 'cleanup' `
                            -ErrorRecord $_ `
                            -DisplayMessage $_.Exception.Message)
                    )
                }
            }
        }
    }
}

$failures = [System.Collections.Generic.List[object]]::new()
if ($null -ne $bodyFailure) {
    [void]$failures.Add($bodyFailure)
}
if ($null -ne $hashFailure) {
    [void]$failures.Add($hashFailure)
}
foreach ($failure in $restorationFailures) {
    [void]$failures.Add($failure)
}
foreach ($failure in $cleanupFailures) {
    [void]$failures.Add($failure)
}

if ($failures.Count -eq 1) {
    $PSCmdlet.ThrowTerminatingError($failures[0].ErrorRecord)
}
if ($failures.Count -gt 1) {
    $formattedFailures = @(
        foreach ($failure in $failures) {
            "[$($failure.Category)] $($failure.DisplayMessage)"
        }
    )
    throw ("Runner failures: " + ($formattedFailures -join ' | '))
}
