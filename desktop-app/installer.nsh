!macro customInstall
  DetailPrint "Checking for tdai-images.tar in installer directory..."
  IfFileExists "$EXEDIR\tdai-images.tar" 0 +4
    DetailPrint "Found tdai-images.tar, copying to installation resources..."
    CreateDirectory "$INSTDIR\resources"
    CopyFiles "$EXEDIR\tdai-images.tar" "$INSTDIR\resources"
    Goto +2
    DetailPrint "tdai-images.tar not found in installer directory ($EXEDIR). Skipping copy."
!macroend
