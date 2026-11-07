$ErrorActionPreference = "Stop"

function U($codes) {
    return -join ($codes -split " " | ForEach-Object {
        [char][Convert]::ToInt32($_, 16)
    })
}

$files = @(
    "client/src/admin/pages/Orders.tsx",
    "client/src/admin/pages/Content.tsx",
    "client/src/admin/pages/Products.tsx",
    "client/src/admin/pages/Settings.tsx",
    "client/src/admin/pages/System.tsx"
)

$rules = @(
    @("00E2 20AC 201D", "2014"),
    @("00E2 20AC 201C", "2013"),
    @("00E2 20AC 00A6", "2026"),
    @("00E2 86 92", "2192"),
    @("00E2 86 90", "2190"),
    @("00E2 88 92", "2212"),
    @("00C2 00B7", "00B7"),
    @("00E2 20AC 0153", "201C"),
    @("00E2 20AC 2122", "2019")
)

foreach ($file in $files) {
    $path = Join-Path $PSScriptRoot $file
    $content = [IO.File]::ReadAllText($path)

    foreach ($rule in $rules) {
        $old = U $rule[0]
        $new = U $rule[1]
        $content = $content.Replace($old, $new)
    }

    [IO.File]::WriteAllText(
        $path,
        $content,
        [Text.UTF8Encoding]::new($true)
    )

    Write-Host "Fixed: $file" -ForegroundColor Green
}

Write-Host "Text repair completed." -ForegroundColor Cyan