@echo off

echo.
if not exist ..\..\gearbox\nul goto not_installed
if not exist ..\..\gearbox\liblist.gam goto not_installed

if not exist ..\..\gearbox\old_liblist.gam goto no_HPB_bot

del ..\..\gearbox\liblist.gam

echo Dosyalar Siliniyor
rename ..\..\gearbox\old_liblist.gam liblist.gam

echo.
del ..\..\gearbox\HPB_bot.cfg
del ..\..\gearbox\HPB_bot_names.txt
del ..\..\gearbox\HPB_bot_chat.txt

echo.
del ..\..\gearbox\dlls\HPB_bot.dll

echo.
echo.
echo BASARI ILE SILINDI
goto done

:not_installed
echo Opposing Force Kurulu Degil
echo.
echo Silme Islemi Basarisiz
goto done

:no_HPB_bot
echo e-XPLoDeR & HPB Bot Kurulu Degil
echo.
goto done

:done
echo.
echo.
pause
