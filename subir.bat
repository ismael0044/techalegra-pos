@echo off
echo Guardando y subiendo cambios a GitHub...
git add .
git commit -m "Actualizacion automatica: %date% %time%"
git push origin main
echo ¡Listo! Cambios subidos con exito.
pause