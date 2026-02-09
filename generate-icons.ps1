 = [System.Drawing.ColorTranslator]::FromHtml('#0f172a'
 = [System.Drawing.ColorTranslator]::FromHtml('#ffffff') 
function New-Icon([string],[int]) { 
   = New-Object System.Drawing.Bitmap ,  
   = [System.Drawing.Graphics]::FromImage() 
  .SmoothingMode = 'AntiAlias' 
  .Clear() 
   = [int]( * 0.22) 
   = New-Object System.Drawing.Font('Segoe UI', , [System.Drawing.FontStyle]::Bold) 
   = 'to day' 
   = New-Object System.Drawing.StringFormat 
  .Alignment = [System.Drawing.StringAlignment]::Center 
  .LineAlignment = [System.Drawing.StringAlignment]::Center 
   = New-Object System.Drawing.RectangleF 0,0,, 
   = New-Object System.Drawing.SolidBrush  
  .DrawString(, , , , ) 
  .Save(, [System.Drawing.Imaging.ImageFormat]::Png) 
  .Dispose() 
  .Dispose() 
} 
New-Icon 'public\icon-192.png' 192 
New-Icon 'public\icon-512.png' 512 
