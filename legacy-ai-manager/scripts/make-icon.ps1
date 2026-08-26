Add-Type -AssemblyName System.Drawing

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # dark rounded background matching the app's --ink token
    $bgColor = [System.Drawing.Color]::FromArgb(255, 19, 22, 26)
    $brush = New-Object System.Drawing.SolidBrush $bgColor
    $radius = [Math]::Max(2, [int]($size * 0.18))
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)

    # accent ring (compass motif) using the app's --speak accent blue
    $ringColor = [System.Drawing.Color]::FromArgb(255, 45, 120, 255)
    $ringPen = New-Object System.Drawing.Pen($ringColor, [float][Math]::Max(1, $size * 0.06))
    $margin = $size * 0.22
    $g.DrawEllipse($ringPen, $margin, $margin, $size - 2 * $margin, $size - 2 * $margin)

    # needle
    $needleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 240, 242, 245))
    $cx = $size / 2.0
    $cy = $size / 2.0
    $len = $size * 0.26
    $pts = @(
        (New-Object System.Drawing.PointF([float]$cx, [float]($cy - $len))),
        (New-Object System.Drawing.PointF([float]($cx + $size * 0.07), [float]$cy)),
        (New-Object System.Drawing.PointF([float]$cx, [float]($cy + $len * 0.35))),
        (New-Object System.Drawing.PointF([float]($cx - $size * 0.07), [float]$cy))
    )
    $g.FillPolygon($needleBrush, $pts)
    $dotBrush = New-Object System.Drawing.SolidBrush $ringColor
    $dotR = $size * 0.05
    $g.FillEllipse($dotBrush, $cx - $dotR, $cy - $dotR, $dotR * 2, $dotR * 2)

    $g.Dispose()
    return $bmp
}

function ConvertTo-IcoBytes([System.Drawing.Bitmap[]] $bitmaps) {
    $ms = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter $ms

    $writer.Write([UInt16]0)      # reserved
    $writer.Write([UInt16]1)      # type: icon
    $writer.Write([UInt16]$bitmaps.Count)

    $imageDatas = @()
    foreach ($bmp in $bitmaps) {
        $pngStream = New-Object System.IO.MemoryStream
        $bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
        $imageDatas += ,($pngStream.ToArray())
    }

    $offset = 6 + (16 * $bitmaps.Count)
    for ($i = 0; $i -lt $bitmaps.Count; $i++) {
        $bmp = $bitmaps[$i]
        $data = $imageDatas[$i]
        $w = if ($bmp.Width -ge 256) { 0 } else { $bmp.Width }
        $h = if ($bmp.Height -ge 256) { 0 } else { $bmp.Height }
        $writer.Write([Byte]$w)
        $writer.Write([Byte]$h)
        $writer.Write([Byte]0)    # color palette
        $writer.Write([Byte]0)    # reserved
        $writer.Write([UInt16]1)  # color planes
        $writer.Write([UInt16]32) # bits per pixel
        $writer.Write([UInt32]$data.Length)
        $writer.Write([UInt32]$offset)
        $offset += $data.Length
    }
    foreach ($data in $imageDatas) {
        $writer.Write($data)
    }
    $writer.Flush()
    return $ms.ToArray()
}

$sizes = @(16, 32, 48, 128, 256)
$bitmaps = $sizes | ForEach-Object { New-IconBitmap $_ }
$bytes = ConvertTo-IcoBytes $bitmaps
[System.IO.File]::WriteAllBytes("C:\Users\cross\Desktop\ai-manager\assets\icon.ico", $bytes)
Write-Output "icon written: $($bytes.Length) bytes"
