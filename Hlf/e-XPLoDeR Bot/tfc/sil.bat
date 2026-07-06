@echo off

echo.
if not exist ..\..\tfc\nul goto not_installed
if not exist ..\..\tfc\liblist.gam goto not_installed

if not exist ..\..\tfc\old_liblist.gam goto no_HPB_bot

del ..\..\tfc\liblist.gam

echo Dosyalar Siliniyor
rename ..\..\tfc\old_liblist.gam liblist.gam

echo.
del ..\..\tfc\HPB_bot.cfg
del ..\..\tfc\HPB_bot_names.txt
del ..\..\tfc\HPB_bot_chat.txt

echo.
del ..\..\tfc\dlls\HPB_bot.dll

echo.
echo.
echo BASARI ILE SILINDI
goto done

:not_installed
echo Team Fortress Kurulu Degil
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
