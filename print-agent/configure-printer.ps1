param(
    [string]$PrinterName = "G3020 series"
)

# Ensure the script runs with elevated privileges
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Warning "Please run this script as Administrator."
    exit 1
}

# Set paper size to A5, color mode to Grayscale, and copies to 1
try {
    # Paper size
    Set-PrintConfiguration -PrinterName $PrinterName -PageMediaSize A5 -ErrorAction Stop
    Write-Host "✅ Paper size set to A5 for printer '$PrinterName'"

    # Color (Grayscale)
    Set-PrintConfiguration -PrinterName $PrinterName -Color $false -ErrorAction Stop
    Write-Host "✅ Color mode set to Grayscale (Black & White) for printer '$PrinterName'"

    # Copies (default is 1, but we set it explicitly)
    Set-PrintConfiguration -PrinterName $PrinterName -Copies 1 -ErrorAction Stop
    Write-Host "✅ Default number of copies set to 1 for printer '$PrinterName'"
} catch {
    Write-Error "Failed to configure printer '$PrinterName': $_"
    exit 1
}

Write-Host "All printer defaults have been configured successfully."
